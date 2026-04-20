import { access, appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

interface HookCommandEntry {
  type: string;
  command: string;
  timeout: number;
}

interface HookConfigFile {
  hooks?: Record<string, Array<{ matcher: string; hooks: HookCommandEntry[] }>>;
}

interface PluginManifest {
  mcpServers?: string;
}

interface McpConfigFile {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
}

async function appendTraceEvent(traceFile: string, event: Record<string, unknown>) {
  await mkdir(dirname(traceFile), { recursive: true });
  await appendFile(traceFile, JSON.stringify(event) + '\n');
}

async function readTraceEvents(traceFile: string): Promise<TraceEvent[]> {
  try {
    const rawTrace = await readFile(traceFile, 'utf8');
    return rawTrace
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TraceEvent);
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
  await Promise.all([
    mkdir(homeDir, { recursive: true }),
    mkdir(configDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
    mkdir(claudeConfigDir, { recursive: true })
  ]);

  return {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: dataDir,
    XDG_CACHE_HOME: cacheDir,
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    HARNESS_EDITOR_SANDBOX_DIR: sandboxDir,
    HARNESS_EDITOR_TRACE_FILE: traceFile
  };
}

function formatFailureOutput(stdout: string, stderr: string): string {
  return [stderr.trim(), stdout.trim()].filter(Boolean).join(' | ');
}

export async function validateProject(projectDir: string, outDir?: string): Promise<SandboxRunResult> {
  const sandboxDir = await mkdtemp(join(tmpdir(), 'harness-editor-'));
  const compileDir = outDir ?? join(sandboxDir, 'compiled');
  await mkdir(compileDir, { recursive: true });

  const project = await loadHarnessProject(projectDir);
  const compileResult = await compileClaude(project, compileDir);
  const traceFile = join(sandboxDir, 'trace.jsonl');
  const htmlReport = join(sandboxDir, 'trace-report.html');
  const sandboxEnv = await buildSandboxEnv(sandboxDir, compileResult.pluginRoot, traceFile);

  let failure: Error | null = null;
  let failureContext = 'sandbox-bootstrap';

  try {
    const hooksPath = join(compileResult.pluginRoot, 'hooks', 'hooks.json');
    const hookConfig = JSON.parse(await readFile(hooksPath, 'utf8')) as HookConfigFile;
    for (const [hook, payload] of Object.entries(SAMPLE_PAYLOADS)) {
      const commands = hookConfig.hooks?.[hook]?.flatMap((entry) => entry.hooks) ?? [];
      for (const commandEntry of commands) {
        failureContext = `hook:${hook}`;
        const result = spawnSync('sh', ['-lc', commandEntry.command], {
          cwd: compileResult.pluginRoot,
          env: sandboxEnv,
          input: payload,
          encoding: 'utf8'
        });
        if (result.status !== 0) {
          await appendTraceEvent(traceFile, {
            timestamp: new Date().toISOString(),
            eventType: 'failure',
            hook,
            nodeId: hook,
            status: 'error',
            message: `Hook command failed for ${hook}`,
            details: formatFailureOutput(result.stdout, result.stderr)
          });
          throw new Error(`Sandbox hook failed for ${hook}: ${formatFailureOutput(result.stdout, result.stderr)}`);
        }
      }
    }

    const pluginManifestPath = join(compileResult.pluginRoot, 'plugin.json');
    const pluginManifest = JSON.parse(await readFile(pluginManifestPath, 'utf8')) as PluginManifest;
    if (pluginManifest.mcpServers) {
      const mcpConfigPath = resolve(compileResult.pluginRoot, pluginManifest.mcpServers);
      const mcpConfig = JSON.parse(await readFile(mcpConfigPath, 'utf8')) as McpConfigFile;
      for (const [name, server] of Object.entries(mcpConfig.mcpServers ?? {})) {
        failureContext = `mcp:${name}`;
        const result = spawnSync(server.command, server.args ?? [], {
          cwd: compileResult.pluginRoot,
          env: sandboxEnv,
          encoding: 'utf8'
        });
        if (result.status !== 0) {
          await appendTraceEvent(traceFile, {
            timestamp: new Date().toISOString(),
            eventType: 'failure',
            hook: 'MCPServer',
            nodeId: name,
            status: 'error',
            message: `Sandbox MCP server failed for ${name}`,
            details: formatFailureOutput(result.stdout, result.stderr)
          });
          throw new Error(`Sandbox MCP server failed for ${name}: ${formatFailureOutput(result.stdout, result.stderr)}`);
        }
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    await appendTraceEvent(traceFile, {
      timestamp: new Date().toISOString(),
      eventType: 'failure',
      hook: 'Sandbox',
      nodeId: failureContext,
      status: 'error',
      message: failure.message
    });
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

  const failureEvent = events.find((event) => event.status === 'error');
  return {
    sandboxDir,
    installDir: compileDir,
    traceFile,
    htmlReport,
    events,
    success: !failureEvent,
    failure: failureEvent
  };
}
