import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { compileClaude } from '../compiler/claude';
import { loadHarnessProject } from '../core/project';
import type { SandboxRunResult, TraceEvent } from '../core/types';
import { renderTraceHtml } from '../web/report';

const SAMPLE_PAYLOADS: Record<string, string> = {
  SessionStart: JSON.stringify({ session: 'sandbox-start' }),
  UserPromptSubmit: JSON.stringify({ prompt: 'sandbox prompt' }),
  PreToolUse: JSON.stringify({ tool: 'Write' }),
  PostToolUse: JSON.stringify({ tool: 'Write', ok: true }),
  Stop: JSON.stringify({ reason: 'done' })
};

interface ValidateOptions {
  outDir?: string;
  failHook?: string;
}

interface HookCommandEntry {
  type: string;
  command: string;
  timeout: number;
}
interface HookConfigFile {
  hooks?: Record<string, Array<{ matcher: string; hooks: HookCommandEntry[] }>>;
}
interface PluginManifest { mcpServers?: string; }
interface McpConfigFile { mcpServers?: Record<string, { command: string; args?: string[] }>; }

async function appendTraceEvent(traceFile: string, event: Record<string, unknown> | TraceEvent) {
  await mkdir(dirname(traceFile), { recursive: true });
  await appendFile(traceFile, JSON.stringify(event) + '\n');
}

async function readTraceEvents(traceFile: string): Promise<TraceEvent[]> {
  try {
    const raw = await readFile(traceFile, 'utf8');
    return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as TraceEvent);
  } catch {
    return [];
  }
}

async function buildSandboxEnv(sandboxDir: string, pluginRoot: string, traceFile: string) {
  const homeDir = join(sandboxDir, 'home');
  const configDir = join(sandboxDir, 'config');
  const dataDir = join(sandboxDir, 'data');
  const cacheDir = join(sandboxDir, 'cache');
  const claudeConfigDir = join(sandboxDir, 'claude-config');
  await Promise.all([mkdir(homeDir, { recursive: true }), mkdir(configDir, { recursive: true }), mkdir(dataDir, { recursive: true }), mkdir(cacheDir, { recursive: true }), mkdir(claudeConfigDir, { recursive: true })]);
  return { ...process.env, HOME: homeDir, XDG_CONFIG_HOME: configDir, XDG_DATA_HOME: dataDir, XDG_CACHE_HOME: cacheDir, CLAUDE_CONFIG_DIR: claudeConfigDir, CLAUDE_PLUGIN_ROOT: pluginRoot, HARNESS_EDITOR_SANDBOX_DIR: sandboxDir, HARNESS_EDITOR_TRACE_FILE: traceFile };
}

function formatFailureOutput(stdout: string, stderr: string): string {
  return [stderr.trim(), stdout.trim()].filter(Boolean).join(' | ');
}

export async function validateProject(projectDir: string, options: ValidateOptions | string = {}): Promise<SandboxRunResult> {
  const resolvedOptions = typeof options === 'string' ? { outDir: options } : options;
  const sandboxDir = await mkdtemp(join(tmpdir(), 'harness-editor-'));
  const compileDir = resolvedOptions.outDir ?? join(sandboxDir, 'compiled');
  const traceFile = join(sandboxDir, 'trace.jsonl');
  const htmlReport = join(sandboxDir, 'trace-report.html');
  await mkdir(compileDir, { recursive: true });
  await writeFile(traceFile, '');

  const project = await loadHarnessProject(resolve(projectDir));
  const compileResult = await compileClaude(project, compileDir);
  const sandboxEnv = await buildSandboxEnv(sandboxDir, compileResult.pluginRoot, traceFile);

  let failure: TraceEvent | undefined;

  try {
    const hooksPath = join(compileResult.pluginRoot, 'hooks', 'hooks.json');
    const hookConfig = JSON.parse(await readFile(hooksPath, 'utf8')) as HookConfigFile;
    for (const [hook, payload] of Object.entries(SAMPLE_PAYLOADS)) {
      const commands = hookConfig.hooks?.[hook]?.flatMap((entry) => entry.hooks) ?? [];
      for (const commandEntry of commands) {
        const forcePayload = resolvedOptions.failHook === hook ? JSON.stringify({ ...JSON.parse(payload), forceFailure: true }) : payload;
        const result = spawnSync('sh', ['-lc', commandEntry.command], { cwd: compileResult.pluginRoot, env: sandboxEnv, input: forcePayload, encoding: 'utf8' });
        if (result.status !== 0) {
          const event: TraceEvent = {
            timestamp: new Date().toISOString(),
            eventType: 'failure',
            hook,
            nodeId: hook,
            status: 'error',
            message: `Hook command failed for ${hook}`,
            metadata: { details: formatFailureOutput(result.stdout, result.stderr) }
          };
          failure = event;
          await appendTraceEvent(traceFile, event);
          throw new Error(`Forced sandbox failure for ${hook}`);
        }
      }
    }

    const pluginManifest = JSON.parse(await readFile(join(compileResult.pluginRoot, 'plugin.json'), 'utf8')) as PluginManifest;
    if (pluginManifest.mcpServers) {
      const mcpConfigPath = resolve(compileResult.pluginRoot, pluginManifest.mcpServers);
      const mcpConfig = JSON.parse(await readFile(mcpConfigPath, 'utf8')) as McpConfigFile;
      for (const [name, server] of Object.entries(mcpConfig.mcpServers ?? {})) {
        const result = spawnSync(server.command, server.args ?? [], { cwd: compileResult.pluginRoot, env: sandboxEnv, encoding: 'utf8' });
        if (result.status !== 0) {
          const event: TraceEvent = { timestamp: new Date().toISOString(), eventType: 'failure', hook: 'MCPServer', nodeId: name, status: 'error', message: `Sandbox MCP server failed for ${name}`, metadata: { details: formatFailureOutput(result.stdout, result.stderr) } };
          failure = event;
          await appendTraceEvent(traceFile, event);
          throw new Error(`Sandbox MCP server failed for ${name}`);
        }
      }
    }
  } catch {
    // failure captured in trace
  }

  let events = await readTraceEvents(traceFile);
  if (events.length === 0) {
    const emptyTraceFailure: TraceEvent = { timestamp: new Date().toISOString(), eventType: 'failure', hook: 'Sandbox', nodeId: 'sandbox', status: 'error', message: 'Sandbox validation produced no trace events' };
    await appendTraceEvent(traceFile, emptyTraceFailure);
    events = await readTraceEvents(traceFile);
    failure ??= emptyTraceFailure;
  }

  await writeFile(htmlReport, renderTraceHtml(project.manifest.name, events));

  return {
    sandboxDir,
    installDir: compileDir,
    traceFile,
    htmlReport,
    events,
    success: !events.some((event) => event.status === 'error'),
    failure
  };
}
