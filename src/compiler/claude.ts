import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompileResult, HarnessProject, HookEvent, TraceEvent } from '../core/types';

const HOOK_EVENTS: HookEvent[] = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];

function traceEventTemplate(
  hook: HookEvent,
  projectName: string,
  status: 'ok' | 'error',
  eventType: TraceEvent['eventType'],
  message: string,
  metadata: Record<string, unknown> = {}
) {
  return `JSON.stringify({ timestamp: new Date().toISOString(), hook: '${hook}', nodeId: '${hook}', status: '${status}', eventType: '${eventType}', message: ${JSON.stringify(
    message
  )}, metadata: ${JSON.stringify(metadata)} })`;
}

function scriptForHook(hook: HookEvent, projectName: string): string {
  const successEvent = traceEventTemplate(hook, projectName, 'ok', 'hook-activation', `${projectName}:${hook}`, {
    source: 'generated-hook'
  });
  const failureEvent = traceEventTemplate(hook, projectName, 'error', 'failure', `${projectName}:${hook}:failed`, {
    source: 'generated-hook'
  });

  return `import { appendFile, mkdir } from 'node:fs/promises';\nimport { dirname } from 'node:path';\n\nconst hook = '${hook}';\nconst traceFile = process.env.HARNESS_EDITOR_TRACE_FILE;\nconst failHook = process.env.HARNESS_EDITOR_FAIL_HOOK;\nconst chunks = [];\nfor await (const chunk of process.stdin) {\n  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));\n}\nconst payload = Buffer.concat(chunks).toString('utf8');\nif (traceFile) {\n  await mkdir(dirname(traceFile), { recursive: true });\n  if (failHook === hook) {\n    await appendFile(traceFile, ${failureEvent} + '\\n');\n    console.error(JSON.stringify({ continue: false, hook, error: 'Injected failure for sandbox validation' }));\n    process.exit(1);\n  }\n  await appendFile(traceFile, ${successEvent} + '\\n');\n}\nconsole.log(JSON.stringify({ continue: true, hook, payloadLength: payload.length }));\n`;
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
  const mcpConfigPath = join(outDir, '.mcp.json');
  const traceSchemaPath = join(outDir, 'trace-schema.json');
  const generatedFiles = [pluginJsonPath, hookJsonPath, traceSchemaPath];
  const hasMcpServer = project.nodes.some((node) => node.kind === 'MCPServer');

  await writeFile(
    pluginJsonPath,
    JSON.stringify(
      {
        name: project.manifest.name,
        version: project.manifest.version,
        description: project.manifest.description,
        license: 'MIT',
        skills: './skills/',
        hooks: './hooks/hooks.json',
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
    await writeFile(
      join(scriptsDir, 'mcp-server.mjs'),
      `import { appendFile, mkdir } from 'node:fs/promises';\nimport { dirname } from 'node:path';\nconst traceFile = process.env.HARNESS_EDITOR_TRACE_FILE;\nif (traceFile) {\n  await mkdir(dirname(traceFile), { recursive: true });\n  await appendFile(traceFile, JSON.stringify({ timestamp: new Date().toISOString(), hook: 'MCPServer', nodeId: 'MCPServer', status: 'ok', eventType: 'mcp-server', message: '${project.manifest.name}:MCPServer', metadata: { source: 'generated-mcp' } }) + '\\n');\n}\nconsole.log(JSON.stringify({ name: '${project.manifest.name}-generated', status: 'ready', mode: 'stdio' }));`
    );
    generatedFiles.push(mcpConfigPath, join(scriptsDir, 'mcp-server.mjs'));
  }

  return { outDir, pluginRoot, generatedFiles };
}
