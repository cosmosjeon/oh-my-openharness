import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompileResult, HarnessProject } from '../core/types';
import { runtimeCompatibilityReport } from '../core/runtime-compatibility';
import { buildValidationManifest, DEFAULT_HOOK_EVENTS, mcpServerScript, scriptForHook, traceSchema } from './runtime-common';

export async function compileOpenCode(project: HarnessProject, outDir: string): Promise<CompileResult> {
  const pluginRoot = join(outDir, '.opencode');
  const skillsDir = join(pluginRoot, 'skills');
  const scriptsDir = join(pluginRoot, 'scripts');
  const validationManifestPath = join(pluginRoot, 'validation.json');
  const traceSchemaPath = join(pluginRoot, 'trace-schema.json');
  const bridgeConfigPath = join(pluginRoot, 'oh-my-openharness.jsonc');
  const exportManifestPath = join(pluginRoot, 'export-manifest.json');
  const hasMcpServer = project.nodes.some((node) => node.kind === 'MCPServer');
  const generatedFiles = [validationManifestPath, traceSchemaPath, bridgeConfigPath, exportManifestPath];
  const compatibility = runtimeCompatibilityReport(project, 'opencode');

  await mkdir(skillsDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });

  await writeFile(traceSchemaPath, JSON.stringify(traceSchema(project), null, 2));
  await writeFile(
    bridgeConfigPath,
    JSON.stringify(
      {
        product: project.manifest.name,
        version: project.manifest.version,
        targetRuntime: 'opencode',
        graphHash: project.manifest.graphHash,
        skills: project.skills.map((skill) => `skills/${skill.name}/SKILL.md`),
        hostCommand: 'opencode run',
        contract: 'host-native-authoring'
      },
      null,
      2
    )
  );

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
      await writeFile(scriptPath, scriptForHook(hook, project, 'opencode'));
      generatedFiles.push(scriptPath);
    }
  }

  if (hasMcpServer) {
    const mcpConfigPath = join(pluginRoot, 'mcp-bridge.json');
    await writeFile(
      mcpConfigPath,
      JSON.stringify({ mcpServers: { [`${project.manifest.name}-generated`]: { command: 'node', args: ['./scripts/mcp-server.mjs'] } } }, null, 2)
    );
    await writeFile(join(scriptsDir, 'mcp-server.mjs'), mcpServerScript(project, 'opencode'));
    generatedFiles.push(mcpConfigPath, join(scriptsDir, 'mcp-server.mjs'));
  }

  await writeFile(
    validationManifestPath,
    JSON.stringify(buildValidationManifest('opencode', pluginRoot, traceSchemaPath, DEFAULT_HOOK_EVENTS, project, 'node'), null, 2)
  );
  await writeFile(
    exportManifestPath,
    JSON.stringify(
      {
        runtime: 'opencode',
        runtimeRoot: '.',
        canonicalSource: ['harness.json', 'graph/nodes.json', 'graph/edges.json', 'layout.json', 'runtime.json'],
        runtimeAdapter: ['oh-my-openharness.jsonc', 'skills/', 'scripts/'],
        validationArtifacts: ['trace-schema.json', 'validation.json', ...(hasMcpServer ? ['mcp-bridge.json'] : [])],
        compatibility,
        warnings: compatibility.warnings
      },
      null,
      2
    )
  );

  return { outDir, pluginRoot, runtime: 'opencode', traceSchemaPath, validationManifestPath, exportManifestPath, generatedFiles, warnings: compatibility.warnings };
}
