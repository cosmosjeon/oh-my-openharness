import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateHarnessProject } from '../src/core/generator';
import { loadHarnessProject, writeHarnessProject } from '../src/core/project';

describe('authoring security guards', () => {
  test('writeHarnessProject rejects skill paths that escape the project skills directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-author-security-write-'));
    const project = generateHarnessProject('secure-write', 'Create a safe harness', 'codex');
    project.skills[0] = {
      ...project.skills[0]!,
      path: '../escape.md'
    };

    await expect(writeHarnessProject(root, project)).rejects.toThrow(/must stay within/i);
    await rm(root, { recursive: true, force: true });
  });

  test('loadHarnessProject rejects skill index entries that escape the project skills directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-author-security-load-'));
    const project = generateHarnessProject('secure-load', 'Create a safe harness', 'codex');

    await writeHarnessProject(root, project);
    await writeFile(
      join(root, 'skills', 'index.json'),
      JSON.stringify(
        [
          {
            id: project.skills[0]!.id,
            name: project.skills[0]!.name,
            description: project.skills[0]!.description,
            path: '../escape.md'
          }
        ],
        null,
        2
      )
    );

    await expect(loadHarnessProject(root)).rejects.toThrow(/must stay within/i);
    await rm(root, { recursive: true, force: true });
  });

  test('writeHarnessProject rejects skill paths that escape through a symlinked directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-author-security-symlink-write-'));
    const externalRoot = await mkdtemp(join(tmpdir(), 'oh-my-openharness-author-security-external-'));
    await mkdir(join(root, 'skills'), { recursive: true });
    await symlink(externalRoot, join(root, 'skills', 'linked'));

    const project = generateHarnessProject('secure-symlink-write', 'Create a safe harness', 'codex');
    project.skills[0] = {
      ...project.skills[0]!,
      path: 'linked/escape.md'
    };

    await expect(writeHarnessProject(root, project)).rejects.toThrow(/symlink/i);
    await rm(root, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  });

  test('loadHarnessProject rejects skill index entries that traverse a symlinked directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-author-security-symlink-load-'));
    const externalRoot = await mkdtemp(join(tmpdir(), 'oh-my-openharness-author-security-external-load-'));
    const project = generateHarnessProject('secure-symlink-load', 'Create a safe harness', 'codex');

    await writeHarnessProject(root, project);
    await mkdir(join(root, 'skills', 'linked-parent'), { recursive: true });
    await rm(join(root, 'skills', 'linked-parent'), { recursive: true, force: true });
    await symlink(externalRoot, join(root, 'skills', 'linked-parent'));
    await writeFile(join(root, 'skills', 'index.json'), JSON.stringify([
      {
        id: project.skills[0]!.id,
        name: project.skills[0]!.name,
        description: project.skills[0]!.description,
        path: 'linked-parent/escape.md'
      }
    ], null, 2));

    await expect(loadHarnessProject(root)).rejects.toThrow(/symlink/i);
    await rm(root, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  });
});
