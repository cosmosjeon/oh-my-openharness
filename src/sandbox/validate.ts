import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { compileProjectForRuntime } from '../compiler';
import { loadHarnessProject } from '../core/project';
import type { RuntimeValidationManifest, SandboxRunResult, TraceEvent } from '../core/types';
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

interface TraceSchemaDocument {
  version: number;
  eventTypes: ReadonlyArray<TraceEvent['eventType']>;
  requiredFields: ReadonlyArray<keyof TraceEvent>;
  requiredMetadata: ReadonlyArray<string>;
  expectedEventTypes?: ReadonlyArray<TraceEvent['eventType']>;
}

interface TraceValidationAudit {
  eventTypeCounts: Partial<Record<TraceEvent['eventType'], number>>;
  missingEventTypes: TraceEvent['eventType'][];
  violations: string[];
}

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
  const codexHome = join(sandboxDir, 'codex-home');
  const opencodeConfigDir = join(sandboxDir, 'opencode-config');
  await Promise.all([
    mkdir(homeDir, { recursive: true }),
    mkdir(configDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
    mkdir(claudeConfigDir, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
    mkdir(opencodeConfigDir, { recursive: true })
  ]);
  return {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: dataDir,
    XDG_CACHE_HOME: cacheDir,
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    OPENCODE_CONFIG_DIR: opencodeConfigDir,
    CODEX_HOME: codexHome,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    OMOH_SANDBOX_DIR: sandboxDir,
    OMOH_TRACE_FILE: traceFile
  };
}

function formatFailureOutput(stdout: string, stderr: string): string {
  return [stderr.trim(), stdout.trim()].filter(Boolean).join(' | ');
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function auditTraceEvents(events: TraceEvent[], traceSchema: TraceSchemaDocument): TraceValidationAudit {
  const eventTypeCounts: Partial<Record<TraceEvent['eventType'], number>> = {};
  const allowedEventTypes = new Set(traceSchema.eventTypes);
  const violations: string[] = [];

  for (const [index, event] of events.entries()) {
    if (!allowedEventTypes.has(event.eventType)) {
      violations.push(`events[${index}].eventType is not allowed by trace schema: ${String(event.eventType)}`);
    }

    for (const field of traceSchema.requiredFields) {
      if (!hasValue(event[field])) violations.push(`events[${index}].${String(field)} is required by trace schema`);
    }

    for (const key of traceSchema.requiredMetadata) {
      if (!hasValue(event.metadata?.[key])) violations.push(`events[${index}].metadata.${key} is required by trace schema`);
    }

    eventTypeCounts[event.eventType] = (eventTypeCounts[event.eventType] ?? 0) + 1;
  }

  const missingEventTypes = (traceSchema.expectedEventTypes ?? []).filter((eventType) => !eventTypeCounts[eventType]);
  return { eventTypeCounts, missingEventTypes, violations };
}

export async function validateProject(projectDir: string, options: ValidateOptions | string = {}): Promise<SandboxRunResult> {
  const resolvedOptions = typeof options === 'string' ? { outDir: options } : options;
  const resolvedProjectDir = resolve(projectDir);
  const sandboxDir = await mkdtemp(join(tmpdir(), 'oh-my-openharness-'));
  const compileDir = resolvedOptions.outDir ?? join(resolvedProjectDir, 'compiler');
  const traceFile = join(resolvedProjectDir, 'sandbox', 'trace.jsonl');
  const htmlReport = join(resolvedProjectDir, 'sandbox', 'trace-report.html');
  await mkdir(compileDir, { recursive: true });
  await mkdir(dirname(traceFile), { recursive: true });
  await writeFile(traceFile, '');

  const project = await loadHarnessProject(resolvedProjectDir);
  const compileResult = await compileProjectForRuntime(project, compileDir);
  const sandboxEnv = await buildSandboxEnv(sandboxDir, compileResult.pluginRoot, traceFile);
  const validationManifest = JSON.parse(await readFile(compileResult.validationManifestPath, 'utf8')) as RuntimeValidationManifest;
  const traceSchema = JSON.parse(await readFile(compileResult.traceSchemaPath, 'utf8')) as TraceSchemaDocument;

  let failure: TraceEvent | undefined;

  try {
    for (const [hook, payload] of Object.entries(SAMPLE_PAYLOADS)) {
      const commands = validationManifest.steps.filter((step) => step.hook === hook);
      for (const commandEntry of commands) {
        const forcePayload = resolvedOptions.failHook === hook ? JSON.stringify({ ...JSON.parse(payload), forceFailure: true }) : payload;
        const result = spawnSync(commandEntry.command, commandEntry.args ?? [], { cwd: validationManifest.runtimeRoot, env: sandboxEnv, input: forcePayload, encoding: 'utf8' });
        if (result.status !== 0) {
          const event: TraceEvent = {
            timestamp: new Date().toISOString(),
            eventType: 'failure',
            hook,
            nodeId: commandEntry.nodeId,
            status: 'error',
            message: `Hook command failed for ${hook}`,
            metadata: { details: formatFailureOutput(result.stdout, result.stderr), runtime: validationManifest.runtime, graphHash: project.manifest.graphHash }
          };
          failure = event;
          await appendTraceEvent(traceFile, event);
          throw new Error(`Forced sandbox failure for ${hook}`);
        }
      }
    }

    for (const server of validationManifest.mcpServers ?? []) {
      const result = spawnSync(server.command, server.args ?? [], { cwd: validationManifest.runtimeRoot, env: sandboxEnv, encoding: 'utf8' });
        if (result.status !== 0) {
          const event: TraceEvent = {
            timestamp: new Date().toISOString(),
            eventType: 'failure',
            hook: 'MCPServer',
            nodeId: server.nodeId,
            status: 'error',
            message: `Sandbox MCP server failed for ${server.name}`,
            metadata: { details: formatFailureOutput(result.stdout, result.stderr), runtime: validationManifest.runtime, graphHash: project.manifest.graphHash }
          };
          failure = event;
          await appendTraceEvent(traceFile, event);
          throw new Error(`Sandbox MCP server failed for ${server.name}`);
        }
      }
  } catch {
    // failure captured in trace
  }

  let events = await readTraceEvents(traceFile);
  if (events.length === 0) {
    const emptyTraceFailure: TraceEvent = {
      timestamp: new Date().toISOString(),
      eventType: 'failure',
      hook: 'Sandbox',
      nodeId: 'sandbox',
      status: 'error',
      message: 'Sandbox validation produced no trace events',
      metadata: { runtime: validationManifest.runtime, graphHash: project.manifest.graphHash }
    };
    await appendTraceEvent(traceFile, emptyTraceFailure);
    events = await readTraceEvents(traceFile);
    failure ??= emptyTraceFailure;
  }

  const validation = auditTraceEvents(events, traceSchema);
  if (validation.missingEventTypes.length > 0 || validation.violations.length > 0) {
    const details = [
      validation.missingEventTypes.length > 0 ? `missing event types: ${validation.missingEventTypes.join(', ')}` : null,
      validation.violations.length > 0 ? validation.violations.slice(0, 3).join(' | ') : null
    ].filter(Boolean).join(' | ');
    const validationFailure: TraceEvent = {
      timestamp: new Date().toISOString(),
      eventType: 'failure',
      hook: 'Sandbox',
      nodeId: 'trace-validation',
      status: 'error',
      message: 'Sandbox trace validation failed',
      metadata: { runtime: validationManifest.runtime, graphHash: project.manifest.graphHash, details }
    };
    await appendTraceEvent(traceFile, validationFailure);
    events = await readTraceEvents(traceFile);
    failure ??= validationFailure;
  }

  await writeFile(htmlReport, renderTraceHtml(project.manifest.name, events));

  return {
    sandboxDir,
    installDir: compileDir,
    traceFile,
    htmlReport,
    events,
    success: !events.some((event) => event.status === 'error'),
    failure,
    validation: {
      manifest: validationManifest,
      traceSchema,
      eventTypeCounts: validation.eventTypeCounts,
      missingEventTypes: validation.missingEventTypes,
      violations: validation.violations
    }
  };
}
