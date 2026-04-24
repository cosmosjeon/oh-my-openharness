import { describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { applySetupPlan, buildSetupPlan } from '../src/core/runtime-setup';

async function createFakeBinary(dir: string, name: string) {
  const path = join(dir, name);
  await writeFile(path, '#!/usr/bin/env sh\nexit 0\n');
  await chmod(path, 0o755);
  return path;
}

describe('runtime setup core', () => {
  test('applySetupPlan enforces summary approval before writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-runtime-setup-'));
    const binDir = join(root, 'bin');
    const claudeConfigDir = join(root, 'claude');
    await mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir, 'claude');

    const previousPath = process.env.PATH;
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

    process.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ''}`;
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

    try {
      const plan = buildSetupPlan(['claude']);
      expect(plan.capabilityMatrix[0]).toMatchObject({
        runtime: 'claude',
        packageName: 'harness-maker',
        packageKind: 'claude-native-harness-maker'
      });
      expect(plan.riskyWrites.some((write) => write.path.endsWith('state-contract.json'))).toBe(true);
      expect(plan.riskyWrites.some((write) => write.path.endsWith('skills/harness-factory/SKILL.md'))).toBe(true);
      expect(plan.capabilityMatrix[0]?.installSurface.every((path) => path.startsWith(join(claudeConfigDir, 'plugins', 'oh-my-openharness')))).toBe(true);
      await expect(applySetupPlan(plan, '0.1.0')).rejects.toThrow('Summary approval is required');
      const applied = await applySetupPlan(plan, '0.1.0', true);
      expect(applied.appliedWrites.every((write) => write.path.startsWith(claudeConfigDir))).toBe(true);
      expect(applied.capabilityMatrix[0]?.installStatus).toBe('configured');
      const plugin = JSON.parse(await readFile(join(claudeConfigDir, 'plugins', 'oh-my-openharness', 'plugin.json'), 'utf8')) as { packageName: string; stateContract: string };
      expect(plugin.packageName).toBe('harness-maker');
      expect(plugin.stateContract).toBe('./state-contract.json');
    } finally {
      process.env.PATH = previousPath;
      if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
    }
  });
});
