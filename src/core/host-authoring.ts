import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeRuntimeTarget } from './runtime-targets';
import { resolveRuntimeAuthoringConfigRoot } from './runtime-setup';
import type {
  GraphEdge,
  GraphNode,
  HarnessProject,
  HostAuthoringGraphDelta,
  HostAuthoringPayload,
  HostAuthoringSkillUpdate,
  RuntimeIntent,
  RuntimeTarget,
  SkillFile
} from './types';

export interface HostAuthoringResult extends HostAuthoringPayload {
  runtime: RuntimeTarget;
  rawOutput: string;
  command: string;
}

function hostPrompt(prompt: string, runtime: RuntimeTarget): string {
  const runtimeName = describeRuntimeTarget(runtime).authoringNoun;
  return [
    `You are authoring inside ${runtimeName} for oh-my-openharness.`,
    'Do not inspect the workspace or use tools. Respond from the user request only.',
    'Return ONLY valid JSON with this exact shape:',
    '{"summary":"string","emphasis":["string"],"warnings":["string"],"graphDelta":{"manifest":{"description":"string"},"nodes":{"add":[{"id":"string","kind":"SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Stop|Skill|Agent|Condition|Loop|StateRead|StateWrite|MCPServer|SystemPrompt|Permission|Merge|Sequence|CustomBlock","label":"string","config":{"key":"value"}}],"update":[{"id":"string","label":"string","config":{"key":"value"}}],"remove":["string"]},"edges":{"add":[{"id":"string","from":"string","to":"string","label":"string"}],"update":[{"id":"string","label":"string"}],"remove":["string"]},"runtimeIntents":{"add":[{"id":"string","kind":"hook|mcp-server|state|custom-runtime","label":"string","targetRuntime":"claude-code|opencode|codex","sourceNodeIds":["string"],"transport":"stdio|in-memory","safety":"safe|confirm"}],"update":[{"id":"string","label":"string","sourceNodeIds":["string"]}],"remove":["string"]},"skills":{"add":[{"id":"string","name":"string","description":"string","content":"string","path":"string"}],"update":[{"id":"string","name":"string","description":"string","content":"string","appendContent":"string"}],"remove":["string"]}}}',
    'Use graphDelta only when you need to change canonical project structure or runtime intent/skill content.',
    'Do not include markdown fences or extra commentary.',
    `User request: ${prompt}`
  ].join(' ');
}

function commandForRuntime(runtime: RuntimeTarget, prompt: string): { command: string; args: string[] } {
  const compiledPrompt = hostPrompt(prompt, runtime);
  switch (runtime) {
    case 'claude-code':
      return { command: 'claude', args: ['-p', compiledPrompt] };
    case 'opencode':
      return { command: 'opencode', args: ['--pure', 'run', compiledPrompt] };
    case 'codex':
      return { command: 'codex', args: ['exec', compiledPrompt] };
  }
}

function parseJsonLine(text: string): HostAuthoringPayload {
  const trimmed = text.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<HostAuthoringPayload>;
      if (typeof parsed.summary === 'string') {
        return {
          summary: parsed.summary,
          emphasis: Array.isArray(parsed.emphasis) ? parsed.emphasis.filter((item): item is string => typeof item === 'string') : [],
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === 'string') : [],
          ...(parsed.graphDelta ? { graphDelta: parsed.graphDelta } : {})
        };
      }
    } catch {}
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of [...lines].reverse()) {
    try {
      const parsed = JSON.parse(line) as Partial<HostAuthoringPayload>;
      if (typeof parsed.summary === 'string') {
        return {
          summary: parsed.summary,
          emphasis: Array.isArray(parsed.emphasis) ? parsed.emphasis.filter((item): item is string => typeof item === 'string') : [],
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === 'string') : [],
          ...(parsed.graphDelta ? { graphDelta: parsed.graphDelta } : {})
        };
      }
    } catch {}
  }
  throw new Error('Host authoring output did not contain a valid JSON payload.');
}

function upsertById<T extends { id: string }>(items: T[], additions: T[] = []): T[] {
  const byId = new Map(items.map((item) => [item.id, item] satisfies [string, T]));
  for (const item of additions) byId.set(item.id, item);
  return [...byId.values()];
}

function applyNodeDelta(nodes: GraphNode[], delta: HostAuthoringGraphDelta['nodes']): GraphNode[] {
  if (!delta) return nodes;
  const removed = new Set(delta.remove ?? []);
  const byId = new Map(nodes.filter((node) => !removed.has(node.id)).map((node) => [node.id, node] satisfies [string, GraphNode]));
  for (const update of delta.update ?? []) {
    const existing = byId.get(update.id);
    if (!existing) continue;
    byId.set(update.id, {
      ...existing,
      ...(update.kind ? { kind: update.kind } : {}),
      ...(update.label ? { label: update.label } : {}),
      ...(update.config ? { config: update.config } : {})
    });
  }
  for (const node of delta.add ?? []) byId.set(node.id, node);
  return [...byId.values()];
}

function applyEdgeDelta(edges: GraphEdge[], delta: HostAuthoringGraphDelta['edges'], liveNodeIds: Set<string>): GraphEdge[] {
  if (!delta) return edges.filter((edge) => liveNodeIds.has(edge.from) && liveNodeIds.has(edge.to));
  const removed = new Set(delta.remove ?? []);
  const byId = new Map(
    edges
      .filter((edge) => !removed.has(edge.id))
      .filter((edge) => liveNodeIds.has(edge.from) && liveNodeIds.has(edge.to))
      .map((edge) => [edge.id, edge] satisfies [string, GraphEdge])
  );
  for (const update of delta.update ?? []) {
    const existing = byId.get(update.id);
    if (!existing) continue;
    const next = {
      ...existing,
      ...(update.from ? { from: update.from } : {}),
      ...(update.to ? { to: update.to } : {}),
      ...(update.label !== undefined ? { label: update.label } : {})
    };
    if (liveNodeIds.has(next.from) && liveNodeIds.has(next.to)) byId.set(update.id, next);
  }
  for (const edge of delta.add ?? []) {
    if (liveNodeIds.has(edge.from) && liveNodeIds.has(edge.to)) byId.set(edge.id, edge);
  }
  return [...byId.values()];
}

function applyRuntimeIntentDelta(
  intents: RuntimeIntent[] | undefined,
  delta: HostAuthoringGraphDelta['runtimeIntents'],
  liveNodeIds: Set<string>
): RuntimeIntent[] | undefined {
  if (!delta && !intents) return undefined;
  const removed = new Set(delta?.remove ?? []);
  const byId = new Map(
    (intents ?? [])
      .filter((intent) => !removed.has(intent.id))
      .map((intent) => [intent.id, intent] satisfies [string, RuntimeIntent])
  );
  for (const update of delta?.update ?? []) {
    const existing = byId.get(update.id);
    if (!existing) continue;
    const next = {
      ...existing,
      ...(update.kind ? { kind: update.kind } : {}),
      ...(update.label ? { label: update.label } : {}),
      ...(update.targetRuntime ? { targetRuntime: update.targetRuntime } : {}),
      ...(update.sourceNodeIds ? { sourceNodeIds: update.sourceNodeIds.filter((id) => liveNodeIds.has(id)) } : {}),
      ...(update.transport ? { transport: update.transport } : {}),
      ...(update.safety ? { safety: update.safety } : {})
    };
    if (next.sourceNodeIds.length > 0) byId.set(update.id, next);
    else byId.delete(update.id);
  }
  for (const intent of delta?.add ?? []) {
    const sourceNodeIds = intent.sourceNodeIds.filter((id) => liveNodeIds.has(id));
    if (sourceNodeIds.length === 0) continue;
    byId.set(intent.id, { ...intent, sourceNodeIds });
  }
  return [...byId.values()];
}

function matchSkill(skill: SkillFile, update: HostAuthoringSkillUpdate): boolean {
  if (update.id) return skill.id === update.id;
  if (update.name) return skill.name === update.name;
  return false;
}

function applySkillDelta(skills: SkillFile[], delta: HostAuthoringGraphDelta['skills'], authoring: HostAuthoringResult): SkillFile[] {
  let nextSkills = [...skills];
  if (!delta) {
    const primary = nextSkills[0];
    if (!primary) return nextSkills;
    nextSkills[0] = {
      ...primary,
      content: `${primary.content}\n## Host-native authoring guidance\n- Runtime: ${describeRuntimeTarget(authoring.runtime).authoringNoun}\n- Summary: ${authoring.summary}\n- Emphasis: ${authoring.emphasis.join(', ') || 'none'}\n`
    };
    return nextSkills;
  }

  const removed = new Set(delta.remove ?? []);
  nextSkills = nextSkills.filter((skill) => !removed.has(skill.id) && !removed.has(skill.name));
  nextSkills = nextSkills.map((skill) => {
    const update = (delta.update ?? []).find((item) => matchSkill(skill, item));
    if (!update) return skill;
    return {
      ...skill,
      ...(update.name ? { name: update.name } : {}),
      ...(update.description ? { description: update.description } : {}),
      ...(update.content !== undefined ? { content: update.content } : {}),
      ...(update.appendContent ? { content: `${update.content ?? skill.content}${update.appendContent}` } : {})
    };
  });
  nextSkills = upsertById(nextSkills, delta.add ?? []);
  const primary = nextSkills[0];
  if (!primary) return nextSkills;
  nextSkills[0] = {
    ...primary,
    content: `${primary.content}\n## Host-native authoring guidance\n- Runtime: ${describeRuntimeTarget(authoring.runtime).authoringNoun}\n- Summary: ${authoring.summary}\n- Emphasis: ${authoring.emphasis.join(', ') || 'none'}\n`
  };
  return nextSkills;
}

export async function invokeHostAuthoring(runtime: RuntimeTarget, prompt: string): Promise<HostAuthoringResult> {
  const compiledPrompt = hostPrompt(prompt, runtime);
  const spec = commandForRuntime(runtime, prompt);
  const env = { ...process.env };
  const configRoot = await resolveRuntimeAuthoringConfigRoot(runtime);
  if (runtime === 'claude-code' && configRoot) env.CLAUDE_CONFIG_DIR = configRoot;
  if (runtime === 'opencode' && configRoot) env.OPENCODE_CONFIG_DIR = configRoot;
  if (runtime === 'codex' && configRoot) env.CODEX_HOME = configRoot;
  let rawOutputFromFile: string | undefined;
  let codexTempDir: string | undefined;
  if (runtime === 'codex') {
    codexTempDir = await mkdtemp(join(tmpdir(), 'omoh-codex-authoring-'));
    const outputPath = join(codexTempDir, 'host-authoring-output.json');
    spec.args = ['exec', '--output-last-message', outputPath, compiledPrompt];
    rawOutputFromFile = outputPath;
  }
  const result = spawnSync(spec.command, spec.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    maxBuffer: 10 * 1024 * 1024
  });
  const transcriptOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
  let rawOutput = transcriptOutput;
  if (rawOutputFromFile && existsSync(rawOutputFromFile)) {
    const fileOutput = (await readFile(rawOutputFromFile, 'utf8')).trim();
    if (fileOutput) rawOutput = fileOutput;
  }
  if (codexTempDir) await rm(codexTempDir, { recursive: true, force: true });
  if (result.status !== 0) throw new Error(`Host authoring command failed: ${spec.command} ${spec.args.join(' ')}\n${transcriptOutput}`);
  const parsed = parseJsonLine(rawOutput);
  return {
    runtime,
    ...parsed,
    rawOutput,
    command: `${spec.command} ${spec.args.join(' ')}`
  };
}

export function applyHostAuthoring(project: HarnessProject, authoring: HostAuthoringResult): HarnessProject {
  const graphDelta = authoring.graphDelta;
  const nodes = applyNodeDelta(project.nodes, graphDelta?.nodes);
  const liveNodeIds = new Set(nodes.map((node) => node.id));
  const edges = applyEdgeDelta(project.edges, graphDelta?.edges, liveNodeIds);
  const runtimeIntents = applyRuntimeIntentDelta(project.runtimeIntents, graphDelta?.runtimeIntents, liveNodeIds);
  const skills = applySkillDelta(project.skills, graphDelta?.skills, authoring);

  return {
    ...project,
    manifest: {
      ...project.manifest,
      ...(graphDelta?.manifest?.description ? { description: graphDelta.manifest.description } : {})
    },
    nodes,
    edges,
    skills,
    ...(runtimeIntents ? { runtimeIntents } : {}),
    authoring: {
      ...project.authoring,
      summary: authoring.summary,
      warnings: [...new Set([`Host authoring runtime: ${describeRuntimeTarget(authoring.runtime).authoringNoun}`, ...authoring.warnings, ...project.authoring.warnings])]
    }
  };
}
