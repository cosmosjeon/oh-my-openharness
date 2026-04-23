import { join } from 'node:path';
import type { GraphNode, HarnessProject, HookEvent, RuntimeTarget, RuntimeValidationManifest, RuntimeValidationStep, TraceEvent } from '../core/types';

export const DEFAULT_HOOK_EVENTS: HookEvent[] = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
export const TRACE_EVENT_TYPES: TraceEvent['eventType'][] = [
  'hook-activation',
  'branch-selection',
  'state-transition',
  'loop-iteration',
  'custom-block',
  'failure',
  'mcp-server'
];
export const TRACE_REQUIRED_FIELDS = ['timestamp', 'eventType', 'hook', 'nodeId', 'status', 'message'] as const;
export const TRACE_REQUIRED_METADATA = ['graphHash', 'runtime'] as const;

function inferHookEventType(hook: HookEvent): TraceEvent['eventType'] {
  if (hook === 'PreToolUse' || hook === 'PostToolUse') return 'state-transition';
  return 'hook-activation';
}

function summarize(node: GraphNode) {
  return { id: node.id, kind: node.kind, label: node.label };
}

function hookNodeId(project: HarnessProject, hook: HookEvent): string {
  return project.nodes.find((node) => node.kind === hook)?.id ?? hook;
}

function mcpNodeId(project: HarnessProject): string {
  return project.nodes.find((node) => node.kind === 'MCPServer')?.id ?? 'mcp-server';
}

export function expectedTraceEventTypes(project: HarnessProject): TraceEvent['eventType'][] {
  const expected = new Set<TraceEvent['eventType']>(['hook-activation']);
  if (project.nodes.some((node) => node.kind === 'Permission')) expected.add('branch-selection');
  if (project.nodes.some((node) => node.kind === 'Loop')) expected.add('loop-iteration');
  if (project.nodes.some((node) => node.kind === 'StateWrite')) expected.add('state-transition');
  if (project.nodes.some((node) => node.kind === 'CustomBlock')) expected.add('custom-block');
  if (project.nodes.some((node) => node.kind === 'MCPServer')) expected.add('mcp-server');
  return TRACE_EVENT_TYPES.filter((eventType) => expected.has(eventType));
}

export function traceSchema(_project: HarnessProject) {
  return {
    version: 1,
    eventTypes: TRACE_EVENT_TYPES,
    requiredFields: TRACE_REQUIRED_FIELDS,
    requiredMetadata: TRACE_REQUIRED_METADATA,
    expectedEventTypes: expectedTraceEventTypes(_project)
  };
}

export function scriptForHook(hook: HookEvent, project: HarnessProject, targetRuntime: RuntimeTarget): string {
  const compiledProject = JSON.stringify({
    name: project.manifest.name,
    prompt: project.manifest.prompt,
    graphHash: project.manifest.graphHash,
    runtime: targetRuntime,
    nodes: project.nodes.map(summarize)
  });
  const eventType = inferHookEventType(hook);
  const hookNode = hookNodeId(project, hook);

  return `import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const traceFile = process.env.OMOH_TRACE_FILE;
const project = ${compiledProject};

async function emitEvents(events) {
  if (!traceFile || events.length === 0) return;
  await mkdir(dirname(traceFile), { recursive: true });
  await appendFile(traceFile, events.map((event) => JSON.stringify(event)).join('\\n') + '\\n');
}

function summarizePayload(payload) {
  return payload.length > 180 ? payload.slice(0, 177) + '...' : payload;
}

function baseMetadata(payload) {
  return { graphHash: project.graphHash, runtime: project.runtime, payloadPreview: summarizePayload(payload) };
}

function buildTraceEvents(payload, parsedPayload) {
  const timestamp = new Date().toISOString();
  const events = [{ timestamp, eventType: '${eventType}', hook: '${hook}', nodeId: '${hookNode}', status: 'ok', message: project.name + ':${hook}', metadata: baseMetadata(payload) }];
  for (const node of project.nodes) {
    if (node.kind === 'Skill' && '${hook}' === 'UserPromptSubmit') events.push({ timestamp, eventType: 'hook-activation', hook: '${hook}', nodeId: node.id, status: 'ok', message: 'Skill activated: ' + node.label, metadata: { ...baseMetadata(payload), nodeKind: node.kind } });
    if (node.kind === 'Permission' && '${hook}' === 'UserPromptSubmit') events.push({ timestamp, eventType: 'branch-selection', hook: '${hook}', nodeId: node.id, status: 'ok', message: 'Permission gate requires approval before risky changes', metadata: { ...baseMetadata(payload), branch: 'approval_required', nodeKind: node.kind } });
    if (node.kind === 'Loop' && '${hook}' === 'UserPromptSubmit') events.push({ timestamp, eventType: 'loop-iteration', hook: '${hook}', nodeId: node.id, status: 'ok', message: 'Loop entered for representative sandbox replay', metadata: { ...baseMetadata(payload), iteration: 1, nodeKind: node.kind } });
    if (node.kind === 'StateWrite' && '${hook}' === 'Stop') events.push({ timestamp, eventType: 'state-transition', hook: '${hook}', nodeId: node.id, status: 'ok', message: 'State persisted for future GUI inspection', metadata: { ...baseMetadata(payload), stateKey: 'project.prompt', valuePreview: summarizePayload(String(parsedPayload?.prompt ?? parsedPayload?.reason ?? payload)), nodeKind: node.kind } });
    if (node.kind === 'CustomBlock' && '${hook}' === 'UserPromptSubmit') events.push({ timestamp, eventType: 'custom-block', hook: '${hook}', nodeId: node.id, status: 'ok', message: 'Custom runtime block ready for downstream compilers', metadata: { ...baseMetadata(payload), nodeKind: node.kind } });
  }
  return events;
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
const payload = Buffer.concat(chunks).toString('utf8');
let parsedPayload = null;
try { parsedPayload = payload ? JSON.parse(payload) : null; } catch { parsedPayload = { raw: payload }; }
const events = buildTraceEvents(payload, parsedPayload);
const shouldFail = Boolean(parsedPayload && typeof parsedPayload === 'object' && parsedPayload.forceFailure === true) || project.prompt.includes('__FORCE_SANDBOX_FAILURE__');
if (shouldFail) {
  events.push({ timestamp: new Date().toISOString(), eventType: 'failure', hook: '${hook}', nodeId: '${hookNode}', status: 'error', message: 'Forced sandbox failure for trace/error surfacing', metadata: baseMetadata(payload) });
  await emitEvents(events);
  console.error('Forced sandbox failure for trace/error surfacing');
  process.exit(1);
}
await emitEvents(events);
console.log(JSON.stringify({ continue: true, hook: '${hook}', traceCount: events.length, runtime: project.runtime }));
`;
}

export function buildValidationManifest(
  runtime: RuntimeTarget,
  runtimeRoot: string,
  traceSchemaPath: string,
  hookEvents: HookEvent[],
  project: HarnessProject,
  commandPrefix: string
): RuntimeValidationManifest {
  const steps: RuntimeValidationStep[] = hookEvents
    .filter((hook) => project.nodes.some((node) => node.kind === hook))
    .map((hook) => ({
      hook,
      nodeId: hookNodeId(project, hook),
      command: commandPrefix,
      args: [join('scripts', `${hook}.mjs`)]
    }));
  return {
    runtime,
    runtimeRoot,
    traceSchemaPath,
    steps,
    ...(project.nodes.some((node) => node.kind === 'MCPServer')
      ? {
          mcpServers: [
            {
              name: `${project.manifest.name}-generated`,
              nodeId: mcpNodeId(project),
              command: 'node',
              args: ['./scripts/mcp-server.mjs']
            }
          ]
        }
      : {})
  };
}

export function mcpServerScript(project: HarnessProject, targetRuntime: RuntimeTarget): string {
  return `import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
const traceFile = process.env.OMOH_TRACE_FILE;
if (traceFile) {
  await mkdir(dirname(traceFile), { recursive: true });
  await appendFile(traceFile, JSON.stringify({ timestamp: new Date().toISOString(), hook: 'MCPServer', nodeId: '${mcpNodeId(project)}', status: 'ok', eventType: 'mcp-server', message: '${project.manifest.name}:MCPServer', metadata: { graphHash: '${project.manifest.graphHash}', runtime: '${targetRuntime}' } }) + '\\n');
}
console.log(JSON.stringify({ name: '${project.manifest.name}-generated', status: 'ready', mode: 'stdio', runtime: '${targetRuntime}' }));
`;
}
