import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompileResult, HarnessProject } from '../core/types';
import { buildValidationManifest, DEFAULT_HOOK_EVENTS, mcpServerScript, scriptForHook, traceSchema } from './runtime-common';

function buildHooksConfig(project: HarnessProject) {
  const hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string; timeout: number }> }>> = {};
  for (const hook of DEFAULT_HOOK_EVENTS) {
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
  const validationManifestPath = join(pluginRoot, 'validation.json');
  const exportManifestPath = join(pluginRoot, 'export-manifest.json');
  await mkdir(pluginRoot, { recursive: true });
  await mkdir(skillsDir, { recursive: true });
  await mkdir(hooksDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });

  const pluginJsonPath = join(pluginRoot, 'plugin.json');
  const hookJsonPath = join(hooksDir, 'hooks.json');
  const mcpConfigPath = join(pluginRoot, '.mcp.json');
  const traceSchemaPath = join(pluginRoot, 'trace-schema.json');
  const generatedFiles = [pluginJsonPath, hookJsonPath, traceSchemaPath, validationManifestPath, exportManifestPath];
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

  for (const hook of DEFAULT_HOOK_EVENTS) {
    if (project.nodes.some((node) => node.kind === hook)) {
      const scriptPath = join(scriptsDir, `${hook}.mjs`);
      await writeFile(scriptPath, scriptForHook(hook, project, 'claude-code'));
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
      mcpServerScript(project, 'claude-code')
    );
    generatedFiles.push(mcpConfigPath, join(scriptsDir, 'mcp-server.mjs'));
  }

  await writeFile(
    validationManifestPath,
    JSON.stringify(buildValidationManifest('claude-code', pluginRoot, traceSchemaPath, DEFAULT_HOOK_EVENTS, project, 'node'), null, 2)
  );
  await writeFile(
    exportManifestPath,
    JSON.stringify(
      {
        runtime: 'claude-code',
        runtimeRoot: pluginRoot,
        canonicalSource: ['harness.json', 'graph/nodes.json', 'graph/edges.json', 'layout.json', 'runtime.json'],
        runtimeAdapter: ['plugin.json', 'hooks/hooks.json', 'skills/', 'scripts/'],
        validationArtifacts: ['trace-schema.json', 'validation.json', ...(hasMcpServer ? ['.mcp.json'] : [])]
      },
      null,
      2
    )
  );

  return { outDir, pluginRoot, runtime: 'claude-code', validationManifestPath, exportManifestPath, generatedFiles };
}
