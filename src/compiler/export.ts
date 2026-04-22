import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { HarnessProject, RuntimeTarget } from '../core/types';
import { compileProjectForRuntime } from './index';

export interface ExportResult {
  outDir: string;
  runtime: RuntimeTarget;
  runtimeBundleRoot: string;
  runtimeBundleManifestPath: string;
  exportManifestPath: string;
}

export async function exportProjectBundle(projectDir: string, project: HarnessProject, outDir: string): Promise<ExportResult> {
  const exportRoot = resolve(outDir);
  const canonicalDir = join(exportRoot, 'canonical');
  const runtimeDir = join(exportRoot, 'runtime');
  const canonicalEntries = ['harness.json', 'graph', 'layout.json', 'runtime.json', 'authoring', 'registry', 'skills', 'custom-blocks'];

  await mkdir(canonicalDir, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });

  for (const entry of canonicalEntries) {
    await cp(join(projectDir, entry), join(canonicalDir, entry), { recursive: true });
  }

  const compileResult = await compileProjectForRuntime(project, runtimeDir);
  const exportManifestPath = join(exportRoot, 'export-manifest.json');
  await writeFile(
    exportManifestPath,
    JSON.stringify(
      {
        runtime: project.manifest.targetRuntime,
        exportRoot,
        canonicalRoot: canonicalDir,
        runtimeRoot: compileResult.pluginRoot,
        canonicalSource: canonicalEntries,
        runtimeBundleManifestPath: compileResult.exportManifestPath,
        validationManifestPath: compileResult.validationManifestPath
      },
      null,
      2
    )
  );

  return {
    outDir: exportRoot,
    runtime: project.manifest.targetRuntime,
    runtimeBundleRoot: compileResult.pluginRoot,
    runtimeBundleManifestPath: compileResult.exportManifestPath,
    exportManifestPath
  };
}
