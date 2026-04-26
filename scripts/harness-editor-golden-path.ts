import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, relative } from 'node:path';
import {
  applyAnswer,
  createHarnessFactoryStore,
  isReadyToDraft,
  orchestrateFactoryAction,
  queueNextQuestion,
  type HarnessFactoryQuestion
} from '../src/factory';
import { startHarnessEditorServer } from '../src/web/server';
import { validateProject } from '../src/sandbox/validate';
import { proveClaudeHostSandbox } from '../src/sandbox/claude-proof';

const REPO_ROOT = resolve(import.meta.dir, '..');
const PROOF_ROOT = resolve(REPO_ROOT, 'proofs', 'harness-editor-golden-path');
const ARTIFACT_ROOT = join(PROOF_ROOT, 'artifacts');
const API_TOKEN = 'proof-token';
const SESSION_ID = 'golden-path-build';
const SECOND_SESSION_ID = 'golden-path-second-build';

interface CommandResult {
  command: string[];
  cwd: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

function repoPath(...parts: string[]) {
  return resolve(REPO_ROOT, ...parts);
}

async function ensureCleanArtifacts() {
  await rm(ARTIFACT_ROOT, { recursive: true, force: true });
  await mkdir(ARTIFACT_ROOT, { recursive: true });
}

function runCommand(command: string[], cwd = REPO_ROOT, extraEnv: Record<string, string> = {}): CommandResult {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
  return {
    command,
    cwd,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

async function writeCommandArtifact(name: string, result: CommandResult) {
  const lines = [
    `$ cwd: ${result.cwd}`,
    `$ ${result.command.join(' ')}`,
    `exit: ${result.status}`,
    '',
    '--- stdout ---',
    result.stdout.trimEnd(),
    '',
    '--- stderr ---',
    result.stderr.trimEnd(),
    ''
  ];
  await writeFile(join(ARTIFACT_ROOT, name), lines.join('\n'));
  if (result.status !== 0) throw new Error(`${name} failed with exit ${result.status}`);
}

function isoAt(offset: number) {
  return new Date(Date.UTC(2026, 3, 26, 2, offset, 0)).toISOString();
}

function answerFor(question: HarnessFactoryQuestion) {
  if (question.id === 'runtime.target') return 'Claude Code';
  if (question.id === 'capabilities.requested') return 'approval, MCP, state persistence, review, retry, and subagent delegation';
  if (question.id.includes('approval')) return 'Require approval before destructive filesystem writes, external execution, and credential-changing actions.';
  if (question.id.includes('mcp')) return 'Expose MCP access for project files, reference search, and runtime diagnostics needed by the harness.';
  if (question.id.includes('memory') || question.id.includes('state')) return 'Persist working memory, build state, verification status, and export metadata under the project-local state path.';
  if (question.id.includes('review')) return 'Run a review loop that checks sandbox success, compatibility warnings, and completion evidence before finishing.';
  if (question.id.includes('retry')) return 'Retry transient failures up to 2 times, then stop with a localized failure summary and next action.';
  if (question.id.includes('delegation') || question.id.includes('subagent')) return 'Delegate independent research or verification work to bounded subagents with explicit ownership.';
  return 'Use approval, MCP, memory, review, retry, and bounded delegation with explicit ownership.';
}

async function completeInterview(stateRoot: string, sessionId: string, userIntent: string) {
  const store = createHarnessFactoryStore(stateRoot);
  let state = await store.create({ sessionId, userIntent });
  const transcript: Array<{ questionId: string; question: string; reason: string; answer: string }> = [];

  for (let index = 0; index < 12 && !isReadyToDraft(state); index += 1) {
    const queued = queueNextQuestion(state, isoAt(index));
    const question = queued.question;
    if (!question) break;
    const answer = answerFor(question);
    transcript.push({ questionId: question.id, question: question.question, reason: question.reason, answer });
    state = applyAnswer(queued.state, { questionId: question.id, answer, now: isoAt(index) });
    state = await store.save(state);
  }

  if (!isReadyToDraft(state)) throw new Error(`Factory interview for ${sessionId} did not reach ready-to-draft state.`);
  return { store, state, transcript };
}

async function listTree(root: string, current = root, depth = 0): Promise<string[]> {
  const entries = (await readdir(current, { withFileTypes: true }))
    .filter((entry) => entry.name !== 'node_modules')
    .sort((left, right) => left.name.localeCompare(right.name));
  const lines: string[] = [];
  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    const prefix = `${'  '.repeat(depth)}- ${entry.name}`;
    lines.push(prefix);
    if (entry.isDirectory()) lines.push(...await listTree(root, fullPath, depth + 1));
  }
  return lines;
}

async function writeTreeArtifact(name: string, root: string) {
  const lines = [`# ${basename(root)}`, ...await listTree(root)];
  await writeFile(join(ARTIFACT_ROOT, name), lines.join('\n'));
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() };
}

async function readFirstSseFrame(url: string) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`SSE request failed: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const split = buffer.indexOf('\n\n');
    if (split >= 0) {
      const frame = buffer.slice(0, split);
      controller.abort();
      await reader.cancel();
      const event = frame.match(/^event: (.+)$/m)?.[1] ?? 'message';
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      return { event, data: JSON.parse(data) };
    }
  }
  controller.abort();
  throw new Error('No SSE frame received');
}

function authInit(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers ?? {});
  headers.set('x-omoh-api-token', API_TOKEN);
  if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json');
  return { ...init, headers };
}

async function main() {
  await ensureCleanArtifacts();

  const buildWeb = runCommand(['bun', 'run', 'build:web']);
  await writeCommandArtifact('build-web.log', buildWeb);

  const startup = runCommand(['./bin/harness-editor']);
  await writeCommandArtifact('startup.log', startup);

  const workspaceRoot = await mkdtemp(join(tmpdir(), 'harness-editor-golden-path-'));
  const stateRoot = join(workspaceRoot, 'factory-state');
  await mkdir(stateRoot, { recursive: true });

  const intent = 'I want a Claude harness with approval, MCP, memory, review, and retry.';
  const first = await completeInterview(stateRoot, SESSION_ID, intent);
  await writeFile(join(ARTIFACT_ROOT, 'factory-interview-transcript.json'), JSON.stringify(first.transcript, null, 2));
  await writeFile(join(ARTIFACT_ROOT, 'factory-state-before-build.json'), JSON.stringify(first.state, null, 2));

  const draft = await orchestrateFactoryAction({
    store: first.store,
    sessionId: SESSION_ID,
    action: 'draft',
    workspaceDir: workspaceRoot,
    projectName: 'golden-path-project',
    now: isoAt(20)
  });
  if (!draft.ok) throw new Error(`Draft action failed: ${draft.failure?.message ?? 'unknown error'}`);
  await writeFile(join(ARTIFACT_ROOT, 'factory-draft.json'), JSON.stringify(draft, null, 2));

  const build = await orchestrateFactoryAction({
    store: first.store,
    sessionId: SESSION_ID,
    action: 'build',
    workspaceDir: workspaceRoot,
    projectName: 'golden-path-project',
    confirmRisk: true,
    now: isoAt(21)
  });
  if (!build.ok || !build.build) throw new Error(`Build action failed: ${build.failure?.message ?? 'unknown error'}`);
  await writeFile(join(ARTIFACT_ROOT, 'factory-build.json'), JSON.stringify(build, null, 2));
  await writeFile(join(ARTIFACT_ROOT, 'factory-state-after-build.json'), JSON.stringify(build.state, null, 2));
  await writeTreeArtifact('canonical-project-tree.txt', build.build.projectPath);

  const handle = await startHarnessEditorServer({
    projectDir: build.build.projectPath,
    host: '127.0.0.1',
    apiToken: API_TOKEN,
    staticRoot: repoPath('dist', 'web-client'),
    factoryStateRoot: stateRoot
  });

  try {
    const indexHtml = await fetch(`${handle.url}/`).then((response) => response.text());
    await writeFile(join(ARTIFACT_ROOT, 'gui-shell.html'), indexHtml);

    const project = await fetchJson(`${handle.url}/api/project`);
    const catalog = await fetchJson(`${handle.url}/api/catalog`);
    const compatibility = await fetchJson(`${handle.url}/api/compatibility`);
    const factoryState = await fetchJson(`${handle.url}/api/factory/state?sessionId=${encodeURIComponent(SESSION_ID)}`);
    const guiChat = await fetchJson(
      `${handle.url}/api/factory/chat`,
      authInit({
        method: 'POST',
        body: JSON.stringify({ sessionId: 'golden-path-gui-chat', text: intent })
      })
    );
    await writeFile(join(ARTIFACT_ROOT, 'gui-api-snapshot.json'), JSON.stringify({ project, catalog, compatibility, factoryState, guiChat }, null, 2));

    const projectBody = project.body as { skills: Array<{ id: string; name: string; content: string; path?: string }>; nodes: Array<{ id: string }>; edges: Array<{ id: string }> };
    const firstSkill = projectBody.skills[0];
    if (!firstSkill) throw new Error('Expected at least one skill in the generated project.');
    const updatedContent = `${firstSkill.content}\n\n## Golden path proof\nEdited through the inspector proof flow.`;
    const skillUpdate = await fetchJson(
      `${handle.url}/api/project/skill`,
      authInit({ method: 'POST', body: JSON.stringify({ skillId: firstSkill.id, content: updatedContent }) })
    );
    await writeFile(join(ARTIFACT_ROOT, 'inspector-skill-update.json'), JSON.stringify(skillUpdate, null, 2));

    const addNode = await fetchJson(
      `${handle.url}/api/project/mutate`,
      authInit({ method: 'POST', body: JSON.stringify({ action: 'add-node', kind: 'Condition', label: 'Golden path condition', x: 480, y: 220 }) })
    );
    const addedNode = (addNode.body as { nodes: Array<{ id: string; label: string }> }).nodes.find((node) => node.label === 'Golden path condition');
    if (!addedNode) throw new Error('Expected add-node mutation to create the proof condition node.');
    const addEdge = await fetchJson(
      `${handle.url}/api/project/mutate`,
      authInit({ method: 'POST', body: JSON.stringify({ action: 'add-edge', source: projectBody.nodes[0]?.id, target: addedNode.id, label: 'golden-path-link' }) })
    );
    await writeFile(join(ARTIFACT_ROOT, 'graph-mutations.json'), JSON.stringify({ addNode, addEdge }, null, 2));

    const claudeExport = runCommand(['bun', 'run', 'src/index.ts', 'export', '--project', build.build.projectPath]);
    await writeCommandArtifact('claude-export.log', claudeExport);
    const exportPayload = JSON.parse(claudeExport.stdout) as { outDir: string; runtimeBundleRoot: string };
    await writeTreeArtifact('claude-export-tree.txt', exportPayload.runtimeBundleRoot);

    const sandboxPass = await validateProject(build.build.projectPath);
    await writeFile(join(ARTIFACT_ROOT, 'sandbox-pass.json'), JSON.stringify(sandboxPass, null, 2));
    const traceStream = await readFirstSseFrame(`${handle.url}/api/trace/stream`);
    await writeFile(join(ARTIFACT_ROOT, 'trace-stream-frame.json'), JSON.stringify(traceStream, null, 2));

    const sandboxFailure = await validateProject(build.build.projectPath, { failHook: 'UserPromptSubmit' });
    await writeFile(join(ARTIFACT_ROOT, 'sandbox-failure.json'), JSON.stringify(sandboxFailure, null, 2));
    const traceAfterFailure = await fetchJson(`${handle.url}/api/trace`);
    await writeFile(join(ARTIFACT_ROOT, 'trace-after-failure.json'), JSON.stringify(traceAfterFailure, null, 2));

    const staleBeforeRerun = await fetchJson(`${handle.url}/api/trace`);
    const rerunValidation = await validateProject(build.build.projectPath);
    const staleAfterRerun = await fetchJson(`${handle.url}/api/trace`);
    await writeFile(join(ARTIFACT_ROOT, 'rerun-proof.json'), JSON.stringify({ staleBeforeRerun, rerunValidation, staleAfterRerun }, null, 2));

    const claudeProof = await proveClaudeHostSandbox(build.build.projectPath);
    await writeFile(join(ARTIFACT_ROOT, 'claude-host-proof.json'), JSON.stringify(claudeProof, null, 2));
  } finally {
    await handle.close();
  }

  const second = await completeInterview(stateRoot, SECOND_SESSION_ID, 'Build a second Claude harness focused on review and bounded retries.');
  const secondBuild = await orchestrateFactoryAction({
    store: second.store,
    sessionId: SECOND_SESSION_ID,
    action: 'build',
    workspaceDir: workspaceRoot,
    projectName: 'golden-path-second-project',
    confirmRisk: true,
    now: isoAt(40)
  });
  if (!secondBuild.ok || !secondBuild.build) throw new Error(`Second build failed: ${secondBuild.failure?.message ?? 'unknown error'}`);
  await writeFile(join(ARTIFACT_ROOT, 'second-harness-build.json'), JSON.stringify(secondBuild, null, 2));
  await writeTreeArtifact('second-harness-tree.txt', secondBuild.build.projectPath);

  const roundtrip = runCommand(['bun', 'test', 'tests/multi-runtime-roundtrip.test.ts']);
  await writeCommandArtifact('multi-runtime-roundtrip.log', roundtrip);

  const summary = {
    workspaceRoot,
    artifactRoot: ARTIFACT_ROOT,
    builtProject: relative(REPO_ROOT, join(workspaceRoot, 'golden-path-project')),
    secondProject: relative(REPO_ROOT, join(workspaceRoot, 'golden-path-second-project')),
    proofNotes: [
      'The automated lane captures an explicit Claude host proof blocker unless HARNESS_REAL_CLAUDE_PROOF=1 is enabled on an authenticated host.',
      'GUI evidence is captured through the built server HTML plus API snapshots, skill-edit persistence, graph mutation proofs, SSE trace output, and rerun/stale-trace state.'
    ]
  };
  await writeFile(join(ARTIFACT_ROOT, 'summary.json'), JSON.stringify(summary, null, 2));
}

await main();
