import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompileResult, HarnessProject, HookEvent, TraceEvent } from '../core/types';

const HOOK_EVENTS: HookEvent[] = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];

function inferHookEventType(hook: HookEvent): TraceEvent['eventType'] {
  if (hook === 'PreToolUse' || hook === 'PostToolUse') return 'state-transition';
  return 'hook-activation';
}

function traceSchema(_project: HarnessProject) {
  return {
    version: 1,
    eventTypes: ['hook-activation', 'branch-selection', 'state-transition', 'loop-iteration', 'custom-block', 'failure', 'mcp-server'],
    requiredFields: ['timestamp', 'eventType', 'hook', 'nodeId', 'status', 'message']
  };
}

function scriptForHook(hook: HookEvent, project: HarnessProject): string {
  const compiledProject = JSON.stringify({
    name: project.manifest.name,
    prompt: project.manifest.prompt,
    nodes: project.nodes.map(({ id, kind, label }) => ({ id, kind, label }))
  });
  const eventType = inferHookEventType(hook);

  return `import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const traceFile = process.env.HARNESS_EDITOR_TRACE_FILE;
const project = ${compiledProject};

async function emitEvents(events) {
  if (!traceFile || events.length === 0) return;
  await mkdir(dirname(traceFile), { recursive: true });
  await appendFile(traceFile, events.map((event) => JSON.stringify(event)).join('\\n') + '\\n');
}

function summarizePayload(payload) {
  return payload.length > 180 ? payload.slice(0, 177) + '...' : payload;
}

function buildTraceEvents(payload, parsedPayload) {
  const timestamp = new Date().toISOString();
  const events = [{ timestamp, eventType: '${eventType}', hook: '${hook}', nodeId: '${hook}', status: 'ok', message: project.name + ':${hook}', metadata: { payloadPreview: summarizePayload(payload) } }];
  for (const node of project.nodes) {
    if (node.kind === 'Skill' && '${hook}' === 'UserPromptSubmit') events.push({ timestamp, eventType: 'hook-activation', hook: '${hook}', nodeId: node.id, status: 'ok', message: 'Skill activated: ' + node.label, metadata: { nodeKind: node.kind } });
    if (node.kind === 'Permission' && '${hook}' === 'UserPromptSubmit') events.push({ timestamp, eventType: 'branch-selection', hook: '${hook}', nodeId: node.id, status: 'ok', message: 'Permission gate requires approval before risky changes', metadata: { branch: 'approval_required', nodeKind: node.kind } });
    if (node.kind === 'Loop' && '${hook}' === 'UserPromptSubmit') events.push({ timestamp, eventType: 'loop-iteration', hook: '${hook}', nodeId: node.id, status: 'ok', message: 'Loop entered for representative sandbox replay', metadata: { iteration: 1, nodeKind: node.kind } });
    if (node.kind === 'StateWrite' && '${hook}' === 'Stop') events.push({ timestamp, eventType: 'state-transition', hook: '${hook}', nodeId: node.id, status: 'ok', message: 'State persisted for future GUI inspection', metadata: { stateKey: 'project.prompt', valuePreview: summarizePayload(String(parsedPayload?.prompt ?? parsedPayload?.reason ?? payload)), nodeKind: node.kind } });
    if (node.kind === 'CustomBlock' && '${hook}' === 'UserPromptSubmit') events.push({ timestamp, eventType: 'custom-block', hook: '${hook}', nodeId: node.id, status: 'ok', message: 'Custom runtime block ready for downstream compilers', metadata: { nodeKind: node.kind } });
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
  events.push({ timestamp: new Date().toISOString(), eventType: 'failure', hook: '${hook}', nodeId: '${hook}', status: 'error', message: 'Forced sandbox failure for trace/error surfacing', metadata: { payloadPreview: summarizePayload(payload) } });
  await emitEvents(events);
  console.error('Forced sandbox failure for trace/error surfacing');
  process.exit(1);
}
await emitEvents(events);
console.log(JSON.stringify({ continue: true, hook: '${hook}', traceCount: events.length }));
`;
}

function buildHooksConfig(project: HarnessProject) {
  const hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string; timeout: number }> }>> = {};
  for (const hook of HOOK_EVENTS) {
    if (project.nodes.some((node) => node.kind === hook)) {
      hooks[hook] = [{ matcher: '*', hooks: [{ type: 'command', command: `node \"$CLAUDE_PLUGIN_ROOT\"/scripts/${hook}.mjs`, timeout: 5 }] }];
    }
  }
  return { description: `Generated hooks for ${project.manifest.name}`, hooks };
}

export async function compileClaude(project: HarnessProject, outDir: string): Promise<CompileResult> {
  const pluginRoot = join(outDir, '.claude-plugin');
  const skillsDir = join(pluginRoot, 'skills');
  const hooksDir = join(pluginRoot, 'hooks');
  const scriptsDir = join(pluginRoot, 'scripts');
  await mkdir(pluginRoot, { recursive: true });
  await mkdir(skillsDir, { recursive: true });
  await mkdir(hooksDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });

  const pluginJsonPath = join(pluginRoot, 'plugin.json');
  const hookJsonPath = join(hooksDir, 'hooks.json');
  const mcpConfigPath = join(pluginRoot, '.mcp.json');
  const traceSchemaPath = join(pluginRoot, 'trace-schema.json');
  const generatedFiles = [pluginJsonPath, hookJsonPath, traceSchemaPath];
  const hasMcpServer = project.nodes.some((node) => node.kind === 'MCPServer');

  await writeFile(pluginJsonPath, JSON.stringify({ name: project.manifest.name, version: project.manifest.version, description: project.manifest.description, license: 'MIT', skills: './skills', hooks: './hooks/hooks.json', ...(hasMcpServer ? { mcpServers: './.mcp.json' } : {}) }, null, 2));
  await writeFile(hookJsonPath, JSON.stringify(buildHooksConfig(project), null, 2));
  await writeFile(traceSchemaPath, JSON.stringify(traceSchema(project), null, 2));

  for (const skill of project.skills) {
    const skillDir = join(skillsDir, skill.name);
    await mkdir(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    await writeFile(skillPath, skill.content);
    generatedFiles.push(skillPath);
  }

  for (const hook of HOOK_EVENTS) {
    if (project.nodes.some((node) => node.kind === hook)) {
      const scriptPath = join(scriptsDir, `${hook}.mjs`);
      await writeFile(scriptPath, scriptForHook(hook, project));
      generatedFiles.push(scriptPath);
    }
  }

  if (project.customBlocks.length > 0) {
    const customBlockPath = join(pluginRoot, 'custom-blocks.json');
    await writeFile(customBlockPath, JSON.stringify(project.customBlocks, null, 2));
    generatedFiles.push(customBlockPath);
  }

  if (hasMcpServer) {
    await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: { [`${project.manifest.name}-generated`]: { command: 'node', args: ['./scripts/mcp-server.mjs'] } } }, null, 2));
    await writeFile(
      join(scriptsDir, 'mcp-server.mjs'),
      `import { appendFile, mkdir } from 'node:fs/promises';\nimport { dirname } from 'node:path';\nconst traceFile = process.env.HARNESS_EDITOR_TRACE_FILE;\nif (traceFile) {\n  await mkdir(dirname(traceFile), { recursive: true });\n  await appendFile(traceFile, JSON.stringify({ timestamp: new Date().toISOString(), hook: 'MCPServer', nodeId: 'MCPServer', status: 'ok', eventType: 'mcp-server', message: '${project.manifest.name}:MCPServer' }) + '\\n');\n}\nconsole.log(JSON.stringify({ name: '${project.manifest.name}-generated', status: 'ready', mode: 'stdio' }));`
    );
    generatedFiles.push(mcpConfigPath, join(scriptsDir, 'mcp-server.mjs'));
  }

  return { outDir, pluginRoot, generatedFiles };
}
