import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompileResult, HarnessProject } from '../core/types';
import { buildValidationManifest, DEFAULT_HOOK_EVENTS, mcpServerScript, scriptForHook, traceSchema } from './runtime-common';

export async function compileCodex(project: HarnessProject, outDir: string): Promise<CompileResult> {
  const pluginRoot = join(outDir, '.codex');
  const skillsDir = join(pluginRoot, 'skills');
  const promptsDir = join(pluginRoot, 'prompts');
  const scriptsDir = join(pluginRoot, 'scripts');
  const validationManifestPath = join(pluginRoot, 'validation.json');
  const traceSchemaPath = join(pluginRoot, 'trace-schema.json');
  const catalogManifestPath = join(pluginRoot, 'catalog-manifest.json');
  const bridgeConfigPath = join(pluginRoot, 'oh-my-openharness.json');
  const exportManifestPath = join(pluginRoot, 'export-manifest.json');
  const hasMcpServer = project.nodes.some((node) => node.kind === 'MCPServer');
  const generatedFiles = [validationManifestPath, traceSchemaPath, catalogManifestPath, bridgeConfigPath, exportManifestPath];

  await mkdir(skillsDir, { recursive: true });
  await mkdir(promptsDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });

  await writeFile(traceSchemaPath, JSON.stringify(traceSchema(project), null, 2));
  await writeFile(
    catalogManifestPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        catalogVersion: project.manifest.version,
        runtime: 'codex',
        skills: project.skills.map((skill) => ({ name: skill.name, category: 'authoring', status: 'active', core: true }))
      },
      null,
      2
    )
  );
  await writeFile(
    bridgeConfigPath,
    JSON.stringify(
      {
        product: project.manifest.name,
        version: project.manifest.version,
        targetRuntime: 'codex',
        graphHash: project.manifest.graphHash,
        skills: project.skills.map((skill) => `skills/${skill.name}/SKILL.md`),
        prompt: `prompts/${project.manifest.name}.md`,
        hostCommand: 'codex exec',
        contract: 'host-native-authoring'
      },
      null,
      2
    )
  );
  await writeFile(join(promptsDir, `${project.manifest.name}.md`), `Use ${project.manifest.name} as the active Codex authoring bridge for this canonical project.\\n`);
  generatedFiles.push(join(promptsDir, `${project.manifest.name}.md`));

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
      await writeFile(scriptPath, scriptForHook(hook, project, 'codex'));
      generatedFiles.push(scriptPath);
    }
  }

  if (hasMcpServer) {
    const mcpConfigPath = join(pluginRoot, 'mcp-bridge.json');
    await writeFile(
      mcpConfigPath,
      JSON.stringify({ mcpServers: { [`${project.manifest.name}-generated`]: { command: 'node', args: ['./scripts/mcp-server.mjs'] } } }, null, 2)
    );
    await writeFile(join(scriptsDir, 'mcp-server.mjs'), mcpServerScript(project, 'codex'));
    generatedFiles.push(mcpConfigPath, join(scriptsDir, 'mcp-server.mjs'));
  }

  await writeFile(
    validationManifestPath,
    JSON.stringify(buildValidationManifest('codex', pluginRoot, traceSchemaPath, DEFAULT_HOOK_EVENTS, project, 'node'), null, 2)
  );
  await writeFile(
    exportManifestPath,
    JSON.stringify(
      {
        runtime: 'codex',
        runtimeRoot: pluginRoot,
        canonicalSource: ['harness.json', 'graph/nodes.json', 'graph/edges.json', 'layout.json', 'runtime.json'],
        runtimeAdapter: ['catalog-manifest.json', 'oh-my-openharness.json', 'prompts/', 'skills/', 'scripts/'],
        validationArtifacts: ['trace-schema.json', 'validation.json', ...(hasMcpServer ? ['mcp-bridge.json'] : [])]
      },
      null,
      2
    )
  );

  return { outDir, pluginRoot, runtime: 'codex', validationManifestPath, exportManifestPath, generatedFiles };
}
