import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('published-style bin entrypoints', () => {
  test('bunx resolves the linked oh-my-openharness bin through symlinks', async () => {
    const installRoot = await mkdtemp(join(tmpdir(), 'omoh-bun-install-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'omoh-linked-project-'));
    await writeFile(join(projectRoot, 'package.json'), JSON.stringify({ name: 'omoh-linked-project', private: true }));

    const baseEnv = { ...process.env, BUN_INSTALL: installRoot };

    const register = spawnSync('bun', ['link'], {
      cwd: process.cwd(),
      env: baseEnv,
      encoding: 'utf8'
    });
    expect(register.status).toBe(0);

    const linkIntoProject = spawnSync('bun', ['link', 'oh-my-openharness'], {
      cwd: projectRoot,
      env: baseEnv,
      encoding: 'utf8'
    });
    expect(linkIntoProject.status).toBe(0);

    const run = spawnSync('bunx', ['oh-my-openharness'], {
      cwd: projectRoot,
      env: baseEnv,
      encoding: 'utf8'
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('oh-my-openharness setup is ready');
  });
});
