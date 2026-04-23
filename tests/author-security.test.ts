import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
});
