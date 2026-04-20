import { access, cp, mkdir, mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHarnessProject } from '../core/project';
import type { HarnessProject, SandboxRunResult, TraceEvent } from '../core/types';
import { compileClaude } from '../compiler/claude';
import { renderTraceHtml } from '../web/report';

const SAMPLE_PAYLOADS: Record<string, string> = {
  SessionStart: JSON.stringify({ session: 'sandbox-start' }),
  UserPromptSubmit: JSON.stringify({ prompt: 'sandbox prompt' }),
  PreToolUse: JSON.stringify({ tool: 'Write' }),
  PostToolUse: JSON.stringify({ tool: 'Write', ok: true }),
  Stop: JSON.stringify({ reason: 'done' })
};

export interface ValidateProjectOptions {
  outDir?: string;
  failHook?: string;
}

async function appendTrace(traceFile: string, event: TraceEvent) {
  await appendFile(traceFile, `${JSON.stringify(event)}\n`);
}

function now() {
  return new Date().toISOString();
}

function createSyntheticEvents(project: HarnessProject): TraceEvent[] {
  const events: TraceEvent[] = [];

  if (project.nodes.some((node) => node.kind === 'Permission')) {
    events.push({
      timestamp: now(),
      hook: 'UserPromptSubmit',
      nodeId: 'permission-gate',
      status: 'ok',
      eventType: 'branch-selection',
      message: 'Permission gate chose the safe branch',
      metadata: { branch: 'safe-default' }
    });
  }

  if (project.nodes.some((node) => node.kind === 'StateRead')) {
    events.push({
      timestamp: now(),
      hook: 'SessionStart',
      nodeId: 'state-read',
      status: 'ok',
      eventType: 'state-transition',
      message: 'Loaded previous harness state',
      metadata: { stateKey: 'harness.session' }
    });
  }

  if (project.nodes.some((node) => node.kind === 'StateWrite')) {
    events.push({
      timestamp: now(),
      hook: 'PostToolUse',
      nodeId: 'state-write',
      status: 'ok',
      eventType: 'state-transition',
      message: 'Persisted harness state',
      metadata: { stateKey: 'harness.session' }
    });
  }

  if (project.nodes.some((node) => node.kind === 'Loop')) {
    events.push({
      timestamp: now(),
      hook: 'PostToolUse',
      nodeId: 'review-loop',
      status: 'ok',
      eventType: 'loop-iteration',
      message: 'Review loop completed iteration 1',
      metadata: { iteration: 1 }
    });
  }

  for (const customBlock of project.customBlocks) {
    events.push({
      timestamp: now(),
      hook: 'PostToolUse',
      nodeId: 'custom-block',
      status: 'ok',
      eventType: 'custom-block',
      message: `Executed opaque custom block ${customBlock.label}`,
      metadata: { blockId: customBlock.id }
    });
  }

  return events;
}

function sandboxEnv(baseEnv: NodeJS.ProcessEnv, sandboxDir: string, traceFile: string, failHook?: string) {
  const homeDir = join(sandboxDir, 'home');
  const configDir = join(sandboxDir, 'config');
  const cacheDir = join(sandboxDir, 'cache');

  return {
    ...baseEnv,
    HOME: homeDir,
    XDG_CONFIG_HOME: configDir,
    XDG_CACHE_HOME: cacheDir,
    HARNESS_EDITOR_TRACE_FILE: traceFile,
    ...(failHook ? { HARNESS_EDITOR_FAIL_HOOK: failHook } : {})
  };
}

async function runHooksFromConfig(installDir: string, traceFile: string, failHook: string | undefined) {
  const hooksConfig = JSON.parse(await readFile(join(installDir, 'hooks', 'hooks.json'), 'utf8')) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };

  let failure: TraceEvent | undefined;
  for (const [hook, payload] of Object.entries(SAMPLE_PAYLOADS)) {
    const hookGroups = hooksConfig.hooks[hook] ?? [];
    for (const group of hookGroups) {
      for (const hookCommand of group.hooks) {
        const result = spawnSync(hookCommand.command, {
          shell: true,
          cwd: installDir,
          env: {
            ...sandboxEnv(process.env, installDir, traceFile, failHook),
            CLAUDE_PLUGIN_ROOT: installDir
          },
          input: payload,
          encoding: 'utf8'
        });

        if (result.status !== 0) {
          failure = {
            timestamp: now(),
            hook,
            nodeId: hook,
            status: 'error',
            eventType: 'failure',
            message: `Sandbox hook failed for ${hook}`,
            metadata: {
              stdout: result.stdout,
              stderr: result.stderr
            }
          };
          await appendTrace(traceFile, failure);
          return failure;
        }
      }
    }
  }

  return failure;
}

async function runMcpServerIfPresent(installDir: string, traceFile: string, failHook: string | undefined) {
  const mcpConfigPath = join(installDir, '.mcp.json');
  try {
    await access(mcpConfigPath);
  } catch {
    return undefined;
  }

  const mcpConfig = JSON.parse(await readFile(mcpConfigPath, 'utf8')) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  const [server] = Object.values(mcpConfig.mcpServers);
  if (!server) return undefined;

  const result = spawnSync(server.command, server.args, {
    cwd: installDir,
    env: {
      ...sandboxEnv(process.env, installDir, traceFile, failHook),
      CLAUDE_PLUGIN_ROOT: installDir
    },
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    const failure: TraceEvent = {
      timestamp: now(),
      hook: 'MCPServer',
      nodeId: 'MCPServer',
      status: 'error',
      eventType: 'failure',
      message: 'Sandbox MCP server failed',
      metadata: {
        stdout: result.stdout,
        stderr: result.stderr
      }
    };
    await appendTrace(traceFile, failure);
    return failure;
  }

  return undefined;
}

export async function validateProject(projectDir: string, options: ValidateProjectOptions = {}): Promise<SandboxRunResult> {
  const sandboxDir = await mkdtemp(join(tmpdir(), 'harness-editor-'));
  const compileDir = options.outDir ?? join(sandboxDir, 'compiled');
  const installDir = join(sandboxDir, 'install');
  const traceFile = join(sandboxDir, 'trace.jsonl');
  await mkdir(compileDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await writeFile(traceFile, '');

  const project = await loadHarnessProject(projectDir);
  const unresolvedConfirmations = project.authoring.confirmationRequests.filter((request) => !request.confirmed);
  if (unresolvedConfirmations.length > 0) {
    throw new Error(
      `Cannot validate project with unresolved confirmations: ${unresolvedConfirmations.map((item) => item.id).join(', ')}`
    );
  }

  await compileClaude(project, compileDir);
  await cp(compileDir, installDir, { recursive: true });

  let failure = await runHooksFromConfig(installDir, traceFile, options.failHook);
  if (!failure) {
    failure = await runMcpServerIfPresent(installDir, traceFile, options.failHook);
  }

  if (!failure) {
    for (const event of createSyntheticEvents(project)) {
      await appendTrace(traceFile, event);
    }
  }

  let events = await readTraceEvents(traceFile);
  if (events.length === 0) {
    await appendTraceEvent(traceFile, {
      timestamp: new Date().toISOString(),
      eventType: 'failure',
      hook: 'Sandbox',
      nodeId: 'sandbox',
      status: 'error',
      message: 'Sandbox validation produced no trace events'
    });
    events = await readTraceEvents(traceFile);
    failure ??= new Error('Sandbox validation produced no trace events');
  }

  await writeFile(htmlReport, renderTraceHtml(project.manifest.name, events));

  return {
    sandboxDir,
    installDir,
    traceFile,
    htmlReport,
    events,
    success: !failure,
    ...(failure ? { failure } : {})
  };
}
