import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
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

  test('rejects a symlinked runtimeRoot that points outside the bundle root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-import-seed-symlink-runtime-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'omoh-import-seed-symlink-outside-'));
    await writeFile(join(outside, 'oh-my-openharness.json'), JSON.stringify({ contract: 'outside' }, null, 2));
    await writeFile(join(outside, 'export-manifest.json'), JSON.stringify({ runtime: 'codex' }, null, 2));
    await symlink(outside, join(root, 'runtime-link'));
    await writeExportManifest(root, {
      runtimeRoot: 'runtime-link',
      runtimeBundleManifestPath: 'runtime/export-manifest.json'
    });

    await expect(importSeedProject({ sourceDir: root })).rejects.toThrow(/symlink/i);
  });

  test('rejects a symlinked runtimeBundleManifestPath that points outside the bundle root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-import-seed-symlink-manifest-'));
    const outside = await mkdtemp(join(tmpdir(), 'omoh-import-seed-symlink-manifest-outside-'));
    await mkdir(join(root, 'runtime'), { recursive: true });
    await writeFile(join(root, 'runtime', 'oh-my-openharness.json'), JSON.stringify({ contract: 'inside' }, null, 2));
    await writeFile(join(outside, 'bundle-export-manifest.json'), JSON.stringify({ runtime: 'codex' }, null, 2));
    await symlink(join(outside, 'bundle-export-manifest.json'), join(root, 'runtime', 'manifest-link.json'));
    await writeExportManifest(root, {
      runtimeRoot: 'runtime',
      runtimeBundleManifestPath: 'runtime/manifest-link.json'
    });

    await expect(importSeedProject({ sourceDir: root })).rejects.toThrow(/symlink/i);
  });
});
