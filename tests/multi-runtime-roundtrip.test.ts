import { describe, expect, test as bunTest } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { compileProjectForRuntime } from '../src/compiler';
import { exportProjectBundle } from '../src/compiler/export';
import { applyRiskConfirmations, generateHarnessProject } from '../src/core/generator';
import { importSeedProject } from '../src/core/import-seed';
import { writeHarnessProject } from '../src/core/project';
import { runtimeCompatibilityReport } from '../src/core/runtime-compatibility';
import type { HarnessProject, RuntimeTarget } from '../src/core/types';

const test = (name: string, fn: Parameters<typeof bunTest>[1]) => bunTest(name, fn, 120_000);
const RUNTIMES: RuntimeTarget[] = ['claude-code', 'opencode', 'codex'];

function richProject(name: string, runtime: RuntimeTarget): HarnessProject {
  return applyRiskConfirmations(
    generateHarnessProject(name, 'Create a harness with approval flow, mcp server, state memory, review loop, and custom novel runtime block', runtime),
    true
  );
}

async function writeProjectFixture(name: string, runtime: RuntimeTarget) {
  const root = await mkdtemp(join(tmpdir(), `omoh-multi-runtime-${runtime}-`));
  const projectDir = join(root, name);
  const project = richProject(name, runtime);
  await writeHarnessProject(projectDir, project);
  return { root, projectDir, project };
}

function runtimeManifestAssertions(runtime: RuntimeTarget, pluginRoot: string): string[] {
  if (runtime === 'claude-code') return [join(pluginRoot, 'plugin.json'), join(pluginRoot, 'export-manifest.json')];
  if (runtime === 'opencode') return [join(pluginRoot, 'oh-my-openharness.jsonc'), join(pluginRoot, 'export-manifest.json')];
  return [join(pluginRoot, 'oh-my-openharness.json'), join(pluginRoot, 'catalog-manifest.json'), join(pluginRoot, 'export-manifest.json')];
}

describe('multi-runtime compatibility and roundtrip proof', () => {
  test('compatibility matrix reports supported entries for each runtime and built-in block kind', () => {
    const project = richProject('compatibility-matrix', 'claude-code');

    for (const runtime of RUNTIMES) {
      const report = runtimeCompatibilityReport(project, runtime);
      expect(report.runtime.targetRuntime).toBe(runtime);
      expect(report.nodes.length).toBe(project.nodes.length);
      expect(['supported', 'warn']).toContain(report.status);
      for (const node of report.nodes) {
        expect(node.status).toBe('supported');
        expect(node.compatibleRuntimes).toEqual(expect.arrayContaining(RUNTIMES));
        expect(node.message).toContain(runtime);
      }
    }
  });

  test('export refuses runtime-incompatible CustomBlock nodes before writing bundle artifacts', async () => {
    const { root, projectDir, project } = await writeProjectFixture('incompatible-custom-block', 'codex');
    const incompatibleProject: HarnessProject = {
      ...project,
      customBlocks: project.customBlocks.map((block) => ({ ...block, runtimeTargets: ['claude-code'] }))
    };
    await writeHarnessProject(projectDir, incompatibleProject);
    const outDir = join(root, 'exported');

    await expect(exportProjectBundle(projectDir, incompatibleProject, outDir)).rejects.toThrow('Runtime compatibility check failed for codex');
    expect(existsSync(join(outDir, 'runtime'))).toBe(false);
  });

  for (const runtime of RUNTIMES) {
    test(`roundtrips ${runtime} through compile export and import with supported semantics`, async () => {
      const { root, projectDir, project } = await writeProjectFixture(`roundtrip-${runtime}`, runtime);
      const compileResult = await compileProjectForRuntime(project, join(root, 'compile'));
      expect(compileResult.runtime).toBe(runtime);
      expect(compileResult.warnings).toEqual([]);
      for (const path of runtimeManifestAssertions(runtime, compileResult.pluginRoot)) expect(existsSync(path)).toBe(true);

      const runtimeManifest = JSON.parse(await readFile(compileResult.exportManifestPath, 'utf8')) as {
        runtime: RuntimeTarget;
        runtimeRoot: string;
        compatibility: { status: string; runtime: { proofLevel: string } };
        warnings: string[];
      };
      expect(runtimeManifest.runtime).toBe(runtime);
      expect(isAbsolute(runtimeManifest.runtimeRoot)).toBe(false);
      expect(runtimeManifest.compatibility.status).toBe('supported');
      expect(runtimeManifest.compatibility.runtime.proofLevel).toBe(runtime === 'claude-code' ? 'host-installable' : 'fixture-roundtrip');
      expect(runtimeManifest.warnings).toEqual([]);

      const exported = await exportProjectBundle(projectDir, project, join(root, 'export'));
      const exportManifest = JSON.parse(await readFile(exported.exportManifestPath, 'utf8')) as {
        runtime: RuntimeTarget;
        runtimeRoot: string;
        runtimeBundleManifestPath: string;
        validationManifestPath: string;
        compatibility: { status: string };
      };
      expect(exportManifest.runtime).toBe(runtime);
      expect(isAbsolute(exportManifest.runtimeRoot)).toBe(false);
      expect(isAbsolute(exportManifest.runtimeBundleManifestPath)).toBe(false);
      expect(isAbsolute(exportManifest.validationManifestPath)).toBe(false);
      expect(exportManifest.compatibility.status).toBe('supported');

      const imported = await importSeedProject({ sourceDir: exported.outDir, name: `imported-${runtime}` });
      expect(imported.manifest.targetRuntime).toBe(runtime);
      expect(imported.manifest.supportedRuntimes).toEqual([runtime]);
      expect(imported.registry.blocks.length).toBeGreaterThan(0);
      expect(imported.registry.blocks.every((block) => block.compatibleRuntimes.length > 0)).toBe(true);
      expect((imported.runtimeIntents ?? []).every((intent) => intent.targetRuntime === runtime)).toBe(true);
      expect(imported.authoring.warnings.join('\n')).toContain('supported = exported runtime bridge metadata');
    });
  }
});
