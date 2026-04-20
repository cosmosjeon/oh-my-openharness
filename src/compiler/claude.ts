import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompileResult, HarnessProject, HookEvent, TraceEvent } from '../core/types';

const HOOK_EVENTS: HookEvent[] = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];

function scriptForHook(hook: HookEvent, project: HarnessProject): string {
  const compiledProject = JSON.stringify({
    name: project.manifest.name,
    prompt: project.manifest.prompt,
    nodes: project.nodes.map(({ id, kind, label }) => ({ id, kind, label }))
  });

  return `import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const traceFile = process.env.HARNESS_EDITOR_TRACE_FILE;
const project = ${compiledProject};

async function emitEvents(events) {
  if (!traceFile || events.length === 0) {
    return;
  }
  await mkdir(dirname(traceFile), { recursive: true });
  await appendFile(traceFile, events.map((event) => JSON.stringify(event)).join('\\n') + '\\n');
}

function summarizePayload(payload) {
  return payload.length > 180 ? payload.slice(0, 177) + '...' : payload;
}

function buildTraceEvents(payload, parsedPayload) {
  const timestamp = new Date().toISOString();
  const events = [
    {
      timestamp,
      eventType: 'hook',
      hook: '${hook}',
      nodeId: '${hook}',
      status: 'ok',
      message: project.name + ':${hook}',
      payloadPreview: summarizePayload(payload)
    }
  ];

  for (const node of project.nodes) {
    if (node.kind === 'Skill' && '${hook}' === 'UserPromptSubmit') {
      events.push({
        timestamp,
        eventType: 'node_activation',
        hook: '${hook}',
        nodeId: node.id,
        status: 'ok',
        message: 'Skill activated: ' + node.label,
        nodeKind: node.kind
      });
    }

    if (node.kind === 'Permission' && '${hook}' === 'UserPromptSubmit') {
      events.push({
        timestamp,
        eventType: 'branch',
        hook: '${hook}',
        nodeId: node.id,
        status: 'ok',
        message: 'Permission gate requires approval before risky changes',
        branch: 'approval_required',
        nodeKind: node.kind
      });
    }

    if (node.kind === 'Loop' && '${hook}' === 'UserPromptSubmit') {
      events.push({
        timestamp,
        eventType: 'loop_iteration',
        hook: '${hook}',
        nodeId: node.id,
        status: 'ok',
        message: 'Loop entered for representative sandbox replay',
        iteration: 1,
        nodeKind: node.kind
      });
    }

    if (node.kind === 'StateWrite' && '${hook}' === 'Stop') {
      events.push({
        timestamp,
        eventType: 'state_mutation',
        hook: '${hook}',
        nodeId: node.id,
        status: 'ok',
        message: 'State persisted for future GUI inspection',
        stateKey: 'project.prompt',
        valuePreview: summarizePayload(String(parsedPayload?.prompt ?? parsedPayload?.reason ?? payload)),
        nodeKind: node.kind
      });
    }

    if (node.kind === 'Sequence' && '${hook}' === 'SessionStart') {
      events.push({
        timestamp,
        eventType: 'node_activation',
        hook: '${hook}',
        nodeId: node.id,
        status: 'ok',
        message: 'Primary flow prepared',
        nodeKind: node.kind
      });
    }

    if (node.kind === 'CustomBlock' && '${hook}' === 'UserPromptSubmit') {
      events.push({
        timestamp,
        eventType: 'node_activation',
        hook: '${hook}',
        nodeId: node.id,
        status: 'ok',
        message: 'Custom runtime block ready for downstream compilers',
        nodeKind: node.kind
      });
    }
  }

  return events;
}

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}
const payload = Buffer.concat(chunks).toString('utf8');
let parsedPayload = null;
try {
  parsedPayload = payload ? JSON.parse(payload) : null;
} catch {
  parsedPayload = { raw: payload };
}
const events = buildTraceEvents(payload, parsedPayload);
const shouldFail = Boolean(parsedPayload && typeof parsedPayload === 'object' && parsedPayload.forceFailure === true) || project.prompt.includes('__FORCE_SANDBOX_FAILURE__');
if (shouldFail) {
  events.push({
    timestamp: new Date().toISOString(),
    eventType: 'failure',
    hook: '${hook}',
    nodeId: '${hook}',
    status: 'error',
    message: 'Forced sandbox failure for trace/error surfacing',
    payloadPreview: summarizePayload(payload)
  });
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
      hooks[hook] = [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: `node "$CLAUDE_PLUGIN_ROOT/scripts/${hook}.mjs"`,
              timeout: 5
            }
          ]
        }
      ];
    }
  }
  return { description: `Generated hooks for ${project.manifest.name}`, hooks };
}

function traceSchema(project: HarnessProject) {
  return {
    version: 'phase0',
    project: project.manifest.name,
    events: [
      {
        eventType: 'hook-activation',
        required: true,
        fields: ['timestamp', 'hook', 'nodeId', 'status', 'message']
      },
      {
        eventType: 'branch-selection',
        required: project.nodes.some((node) => node.kind === 'Permission'),
        fields: ['timestamp', 'hook', 'nodeId', 'status', 'message', 'metadata.branch']
      },
      {
        eventType: 'state-transition',
        required: project.nodes.some((node) => node.kind === 'StateRead' || node.kind === 'StateWrite'),
        fields: ['timestamp', 'hook', 'nodeId', 'status', 'message', 'metadata.stateKey']
      },
      {
        eventType: 'loop-iteration',
        required: project.nodes.some((node) => node.kind === 'Loop'),
        fields: ['timestamp', 'hook', 'nodeId', 'status', 'message', 'metadata.iteration']
      },
      {
        eventType: 'custom-block',
        required: project.customBlocks.length > 0,
        fields: ['timestamp', 'hook', 'nodeId', 'status', 'message', 'metadata.blockId']
      },
      {
        eventType: 'failure',
        required: true,
        fields: ['timestamp', 'hook', 'nodeId', 'status', 'message', 'metadata.stderr']
      }
    ]
  };
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
  const generatedFiles = [pluginJsonPath, hookJsonPath];
  const hasMcpServer = project.nodes.some((node) => node.kind === 'MCPServer');

  await writeFile(
    pluginJsonPath,
    JSON.stringify(
      {
        name: project.manifest.name,
        version: project.manifest.version,
        description: project.manifest.description,
        license: 'MIT',
        skills: './skills',
        ...(hasMcpServer ? { mcpServers: './.mcp.json' } : {})
      },
      null,
      2
    )
  );

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
    const customBlockPath = join(outDir, 'custom-blocks.json');
    await writeFile(customBlockPath, JSON.stringify(project.customBlocks, null, 2));
    generatedFiles.push(customBlockPath);
  }

  if (hasMcpServer) {
    await writeFile(
      mcpConfigPath,
      JSON.stringify(
        {
          mcpServers: {
            [`${project.manifest.name}-generated`]: {
              command: 'node',
              args: ['./scripts/mcp-server.mjs']
            }
          }
        },
        null,
        2
      )
    );
    const mcpServerPath = join(scriptsDir, 'mcp-server.mjs');
    await writeFile(
      mcpServerPath,
      `import { appendFile, mkdir } from 'node:fs/promises';\nimport { dirname } from 'node:path';\nconst traceFile = process.env.HARNESS_EDITOR_TRACE_FILE;\nconst event = { timestamp: new Date().toISOString(), eventType: 'runtime_ready', hook: 'MCPServer', nodeId: 'mcp-server', status: 'ok', message: '${project.manifest.name}:MCPServer', serverName: '${project.manifest.name}-generated', sandboxDir: process.env.HARNESS_EDITOR_SANDBOX_DIR ?? null };\nif (traceFile) {\n  await mkdir(dirname(traceFile), { recursive: true });\n  await appendFile(traceFile, JSON.stringify(event) + '\\n');\n}\nconsole.log(JSON.stringify({ name: '${project.manifest.name}-generated', status: 'ready', mode: 'stdio' }));`
    );
    generatedFiles.push(mcpConfigPath, mcpServerPath);
  }

  return { outDir, pluginRoot, generatedFiles };
}
