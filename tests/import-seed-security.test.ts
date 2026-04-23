import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importSeedProject } from '../src/core/import-seed';

describe('import seed manifest path security', () => {
  async function writeExportManifest(root: string, manifest: { runtimeRoot: string; runtimeBundleManifestPath: string }) {
    await writeFile(
      join(root, 'export-manifest.json'),
      JSON.stringify(
        {
          runtime: 'codex',
          ...manifest
        },
        null,
        2
      )
    );
  }

  test('rejects an absolute runtimeRoot path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-import-seed-absolute-runtime-root-'));
    await writeExportManifest(root, {
      runtimeRoot: '/tmp/escaped-runtime-root',
      runtimeBundleManifestPath: 'runtime/export-manifest.json'
    });

    await expect(importSeedProject({ sourceDir: root })).rejects.toThrow('unsafe runtimeRoot');
  });

  test('rejects a parent-escaping runtimeRoot path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-import-seed-parent-runtime-root-'));
    await writeExportManifest(root, {
      runtimeRoot: '../escaped-runtime-root',
      runtimeBundleManifestPath: 'runtime/export-manifest.json'
    });

    await expect(importSeedProject({ sourceDir: root })).rejects.toThrow('unsafe runtimeRoot');
  });

  test('rejects an absolute runtimeBundleManifestPath path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-import-seed-absolute-bundle-manifest-'));
    await writeExportManifest(root, {
      runtimeRoot: '.',
      runtimeBundleManifestPath: '/tmp/escaped-runtime-bundle-manifest.json'
    });

    await expect(importSeedProject({ sourceDir: root })).rejects.toThrow('unsafe runtimeBundleManifestPath');
  });

  test('rejects a parent-escaping runtimeBundleManifestPath path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-import-seed-parent-bundle-manifest-'));
    await writeExportManifest(root, {
      runtimeRoot: '.',
      runtimeBundleManifestPath: '../escaped-runtime-bundle-manifest.json'
    });

    await expect(importSeedProject({ sourceDir: root })).rejects.toThrow('unsafe runtimeBundleManifestPath');
  });
});
