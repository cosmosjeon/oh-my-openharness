import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompileResult, HarnessProject, HookEvent } from '../core/types';

const HOOK_EVENTS: HookEvent[] = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];

function scriptForHook(hook: HookEvent, projectName: string): string {
  return `import { appendFile, mkdir } from 'node:fs/promises';\nimport { dirname } from 'node:path';\n\nconst traceFile = process.env.HARNESS_EDITOR_TRACE_FILE;\nconst chunks = [];\nfor await (const chunk of process.stdin) {\n  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));\n}\nconst payload = Buffer.concat(chunks).toString('utf8');\nif (traceFile) {\n  await mkdir(dirname(traceFile), { recursive: true });\n  await appendFile(traceFile, JSON.stringify({ timestamp: new Date().toISOString(), hook: '${hook}', nodeId: '${hook}', status: 'ok', message: '${projectName}:${hook}', payloadLength: payload.length }) + '\\n');\n}\nconsole.log(JSON.stringify({ continue: true, hook: '${hook}' }));\n`;
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
              command: `node \"$CLAUDE_PLUGIN_ROOT\"/scripts/${hook}.mjs`,
              timeout: 5
            }
          ]
        }
      ];
    }
  }
  return { description: `Generated hooks for ${project.manifest.name}`, hooks };
}

export async function compileClaude(project: HarnessProject, outDir: string): Promise<CompileResult> {
  const pluginRoot = join(outDir, '.claude-plugin');
  const skillsDir = join(outDir, 'skills');
  const hooksDir = join(outDir, 'hooks');
  const scriptsDir = join(outDir, 'scripts');
  await mkdir(pluginRoot, { recursive: true });
  await mkdir(skillsDir, { recursive: true });
  await mkdir(hooksDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });

  const pluginJsonPath = join(pluginRoot, 'plugin.json');
  const hookJsonPath = join(hooksDir, 'hooks.json');
  const mcpConfigPath = join(outDir, '.mcp.json');
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
        skills: './skills/',
        ...(hasMcpServer ? { mcpServers: './.mcp.json' } : {})
      },
      null,
      2
    )
  );

  await writeFile(hookJsonPath, JSON.stringify(buildHooksConfig(project), null, 2));

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
      await writeFile(scriptPath, scriptForHook(hook, project.manifest.name));
      generatedFiles.push(scriptPath);
    }
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
      `import { appendFile, mkdir } from 'node:fs/promises';\nimport { dirname } from 'node:path';\nconst traceFile = process.env.HARNESS_EDITOR_TRACE_FILE;\nif (traceFile) {\n  await mkdir(dirname(traceFile), { recursive: true });\n  await appendFile(traceFile, JSON.stringify({ timestamp: new Date().toISOString(), hook: 'MCPServer', nodeId: 'MCPServer', status: 'ok', message: '${project.manifest.name}:MCPServer' }) + '\\n');\n}\nconsole.log(JSON.stringify({ name: '${project.manifest.name}-generated', status: 'ready', mode: 'stdio' }));`
    );
    generatedFiles.push(mcpConfigPath, join(scriptsDir, 'mcp-server.mjs'));
  }

  return { outDir, pluginRoot, generatedFiles };
}
