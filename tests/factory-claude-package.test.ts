import { describe, expect, test as bunTest } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  CLAUDE_FACTORY_HOOK_EVENTS,
  CLAUDE_HARNESS_MAKER_REQUIRED_SKILLS,
  writeClaudeHarnessMakerPackage
} from '../src/factory/package';

const test = (name: string, fn: Parameters<typeof bunTest>[1]) => bunTest(name, fn, 60000);
const FIXTURE_DIR = join(import.meta.dir, 'fixtures', 'factory-hooks');
const FIXTURE_BY_HOOK: Record<string, string> = {
  SessionStart: 'session-start.json',
  UserPromptSubmit: 'user-prompt-submit.ask.json',
  PreToolUse: 'pre-tool-use.block.json',
  PostToolUse: 'post-tool-use.project-update.json'
};

async function makePackage() {
  const root = await mkdtemp(join(tmpdir(), 'omoh-claude-maker-package-'));
  const packageRoot = join(root, 'plugins', 'oh-my-openharness');
  const result = await writeClaudeHarnessMakerPackage({
    packageRoot,
    version: '0.1.0-test',
    configRoot: join(root, 'claude'),
    installRoot: packageRoot,
    runtimeCommand: 'bun',
    runtimeArgs: ['run', resolve('src', 'factory', 'hooks', 'cli.ts')]
  });
  return { root, packageRoot, result };
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function expectRelativeFile(packageRoot: string, value: unknown) {
  expect(typeof value).toBe('string');
  const relative = value as string;
  expect(relative.startsWith('./')).toBe(true);
  expect(existsSync(join(packageRoot, relative))).toBe(true);
}

describe('Claude harness-maker package generation', () => {
  test('generated Claude package includes plugin.json, skills, hooks, scripts, and state contract', async () => {
    const { packageRoot, result } = await makePackage();

    expect(existsSync(result.pluginJsonPath)).toBe(true);
    expect(existsSync(result.hooksConfigPath)).toBe(true);
    expect(existsSync(result.stateContractPath)).toBe(true);
    expect(existsSync(result.setupMetadataPath)).toBe(true);
    for (const skill of CLAUDE_HARNESS_MAKER_REQUIRED_SKILLS) {
      expect(existsSync(join(packageRoot, 'skills', skill, 'SKILL.md'))).toBe(true);
    }
    for (const hook of CLAUDE_FACTORY_HOOK_EVENTS) {
      expect(existsSync(result.hookScriptPaths[hook])).toBe(true);
    }
    for (const path of result.manifestPaths) {
      const packageRelative = relative(packageRoot, path);
      expect(packageRelative.startsWith('..')).toBe(false);
      expect(isAbsolute(packageRelative)).toBe(false);
      expect(existsSync(path)).toBe(true);
    }

    const plugin = await readJson(result.pluginJsonPath);
    const stateContract = await readJson(result.stateContractPath);
    const setupMetadata = await readJson(result.setupMetadataPath);
    expect(plugin).toMatchObject({
      name: 'oh-my-openharness',
      packageName: 'harness-maker',
      packageKind: 'claude-native-harness-maker',
      skills: './skills',
      hooks: './hooks/hooks.json',
      stateContract: './state-contract.json',
      setupMetadata: './install.json'
    });
    expect(stateContract).toMatchObject({
      packageName: 'harness-maker',
      stateRootEnv: 'HARNESS_FACTORY_STATE_DIR',
      factoryInputField: 'factory'
    });
    expect(setupMetadata).toMatchObject({
      packageName: 'harness-maker',
      contract: 'claude-native-harness-maker',
      hooks: [...CLAUDE_FACTORY_HOOK_EVENTS]
    });
  });

  test('plugin manifest references only files that exist inside package root', async () => {
    const { packageRoot, result } = await makePackage();
    const plugin = await readJson(result.pluginJsonPath);
    expectRelativeFile(packageRoot, plugin.skills);
    expectRelativeFile(packageRoot, plugin.hooks);
    expectRelativeFile(packageRoot, plugin.stateContract);
    expectRelativeFile(packageRoot, plugin.setupMetadata);

    const scripts = plugin.scripts as Record<string, string>;
    for (const hook of CLAUDE_FACTORY_HOOK_EVENTS) expectRelativeFile(packageRoot, scripts[hook]);

    const hooksConfig = await readJson(result.hooksConfigPath) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    for (const hook of CLAUDE_FACTORY_HOOK_EVENTS) {
      const command = hooksConfig.hooks[hook]?.[0]?.hooks[0]?.command ?? '';
      const match = command.match(/scripts\/[^"\s]+\.mjs/);
      expect(match, `expected script path in ${command}`).toBeTruthy();
      expect(existsSync(join(packageRoot, match![0]))).toBe(true);
    }
  });

  test('all generated hook scripts can run with Phase D fixture stdin in a temp install root', async () => {
    const { root, packageRoot, result } = await makePackage();
    const stateRoot = join(root, 'factory-state');
    await mkdir(stateRoot, { recursive: true });

    for (const hook of CLAUDE_FACTORY_HOOK_EVENTS) {
      const fixture = await readFile(join(FIXTURE_DIR, FIXTURE_BY_HOOK[hook]), 'utf8');
      const stdin = fixture.replaceAll('__TEMP__', stateRoot).replaceAll('__CWD__', root);
      const run = spawnSync('node', [result.hookScriptPaths[hook]], {
        cwd: packageRoot,
        input: stdin,
        encoding: 'utf8',
        env: { ...process.env, HARNESS_FACTORY_CWD: process.cwd() }
      });

      expect(run.status, `${hook} stderr=${run.stderr}`).toBe(0);
      const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
      expect(parsed).toHaveProperty('harnessFactory');
    }
  });

  test('skills contain required frontmatter and top-level orchestration instructions', async () => {
    const { packageRoot } = await makePackage();
    for (const skill of CLAUDE_HARNESS_MAKER_REQUIRED_SKILLS) {
      const content = await readFile(join(packageRoot, 'skills', skill, 'SKILL.md'), 'utf8');
      expect(content).toStartWith(`---\nname: ${skill}\n`);
      expect(content).toContain('description:');
      expect(content).toContain(`# ${skill.split('-').map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' ')}`);
      expect(content).toContain('## Orchestration instructions');
      expect(content).toContain('canonical harness project on disk');
    }
  });
});
