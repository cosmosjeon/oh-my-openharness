import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bun', ['run', 'src/index.ts', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

async function createFakeBinary(dir: string, name: string) {
  const path = join(dir, name);
  await writeFile(path, '#!/usr/bin/env sh\nexit 0\n');
  await chmod(path, 0o755);
  return path;
}

describe('CLI entrypoint', () => {
  test('starts the OMOH setup flow without requiring a subcommand in non-interactive mode', () => {
    const result = runCli([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('oh-my-openharness setup is ready');
  });

  test('blocks risky generation unless confirmation is provided', () => {
    const result = runCli(['new', '--name', 'risky-cli', '--prompt', 'Create a harness with full access and bypass safety']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Generation requires confirmation before proceeding');
    expect(result.stderr).toContain('confirm-risk-permissions');
  });

  test('new persists the selected runtime target before writing the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-cli-runtime-target-'));
    const result = runCli(['new', '--name', 'runtime-target', '--prompt', 'Create a harness with state memory', '--runtime', 'codex', '--dir', root, '--confirm-risk']);
    expect(result.status).toBe(0);
    const manifest = JSON.parse(await readFile(join(root, 'runtime-target', 'harness.json'), 'utf8')) as { targetRuntime: string; supportedRuntimes: string[] };
    expect(manifest.targetRuntime).toBe('codex');
    expect(manifest.supportedRuntimes).toEqual(['codex']);
  });

  test('export aliases compile and writes a runtime-specific export manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-cli-export-'));
    const createResult = runCli(['new', '--name', 'export-target', '--prompt', 'Create a harness with MCP server', '--runtime', 'opencode', '--dir', root, '--confirm-risk']);
    expect(createResult.status).toBe(0);
    const projectDir = join(root, 'export-target');
    const exportResult = runCli(['export', '--project', projectDir], {});
    expect(exportResult.status).toBe(0);
    const payload = JSON.parse(exportResult.stdout) as { exportManifestPath: string; runtime: string };
    expect(payload.runtime).toBe('opencode');
    const exportManifest = JSON.parse(await readFile(payload.exportManifestPath, 'utf8')) as { runtime: string };
    expect(exportManifest.runtime).toBe('opencode');
  });

  test('import seeds a canonical project from a runtime bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-cli-import-'));
    const createResult = runCli(['new', '--name', 'import-source', '--prompt', 'Create a harness with MCP server', '--runtime', 'codex', '--dir', root, '--confirm-risk']);
    expect(createResult.status).toBe(0);
    const projectDir = join(root, 'import-source');
    const exportResult = runCli(['export', '--project', projectDir], {});
    expect(exportResult.status).toBe(0);
    const exportPayload = JSON.parse(exportResult.stdout) as { outDir: string };
    const importDir = join(root, 'imports');
    const importResult = runCli(['import', '--from', exportPayload.outDir, '--name', 'imported-project', '--dir', importDir], {});
    expect(importResult.status).toBe(0);
    const importedManifest = JSON.parse(await readFile(join(importDir, 'imported-project', 'harness.json'), 'utf8')) as { targetRuntime: string; description: string };
    expect(importedManifest.targetRuntime).toBe('codex');
    expect(importedManifest.description).toContain('Imported seed harness');
  });

  test('setup applies the Claude runtime through one approval gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-cli-setup-'));
    const binDir = join(root, 'bin');
    const claudeConfigDir = join(root, 'claude');
    await mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir, 'claude');

    const result = runCli(['setup', '--runtimes', 'claude', '--yes', '--json'], {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      CLAUDE_CONFIG_DIR: claudeConfigDir
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      selectedRuntimes: string[];
      approvalMode: string;
      capabilityMatrix: Array<{ runtime: string; installStatus: string }>;
    };
    expect(payload.selectedRuntimes).toEqual(['claude']);
    expect(payload.approvalMode).toBe('summary');
    expect(payload.capabilityMatrix[0]?.installStatus).toBe('configured');

    const pluginJson = JSON.parse(await readFile(join(claudeConfigDir, 'plugins', 'oh-my-openharness', 'plugin.json'), 'utf8')) as { name: string; hooks: string; skills: string };
    expect(pluginJson.name).toBe('oh-my-openharness');
    expect(pluginJson.hooks).toBe('./hooks/hooks.json');
    expect(pluginJson.skills).toBe('./skills');
  });

  test('setup supports multi-select planning with one summary approval gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-cli-plan-'));
    const binDir = join(root, 'bin');
    await mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir, 'claude');
    await createFakeBinary(binDir, 'codex');

    const result = runCli(['setup', '--runtimes', 'claude,codex', '--dry-run', '--json'], {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      CLAUDE_CONFIG_DIR: join(root, 'claude'),
      CODEX_HOME: join(root, 'codex')
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      selectedRuntimes: string[];
      approvalMode: string;
      riskyWrites: Array<{ runtime: string }>;
      capabilityMatrix: Array<{ runtime: string }>;
    };
    expect(payload.selectedRuntimes).toEqual(['claude', 'codex']);
    expect(payload.approvalMode).toBe('summary');
    expect(payload.riskyWrites.length).toBeGreaterThan(1);
    expect(payload.capabilityMatrix.map((entry) => entry.runtime)).toEqual(['claude', 'codex']);
  });

  test('doctor separates install-shape from host-readiness', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-cli-doctor-'));
    const binDir = join(root, 'bin');
    const claudeConfigDir = join(root, 'claude');
    await mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir, 'claude');

    const setupResult = runCli(['setup', '--runtimes', 'claude', '--yes', '--json'], {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      CLAUDE_CONFIG_DIR: claudeConfigDir
    });
    expect(setupResult.status).toBe(0);

    const result = runCli(['doctor', '--runtimes', 'claude', '--json'], {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      CLAUDE_CONFIG_DIR: claudeConfigDir
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      runtimes: Array<{
        runtime: string;
        installShape: { status: string };
        hostReadiness: { status: string; details: string[] };
        suggestedNextCommand: string;
      }>;
    };
    expect(payload.runtimes[0]?.runtime).toBe('claude');
    expect(payload.runtimes[0]?.installShape.status).toBe('ok');
    expect(payload.runtimes[0]?.hostReadiness.status).toBe('warning');
    expect(payload.runtimes[0]?.suggestedNextCommand).toBe('claude');
    expect(payload.runtimes[0]?.hostReadiness.details[0]).toContain('Verify host readiness separately');
  });

  test('OpenCode setup installs a host-native authoring bridge and doctor reports host verification guidance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-cli-opencode-'));
    const binDir = join(root, 'bin');
    const opencodeConfigDir = join(root, 'opencode');
    await mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir, 'opencode');

    const setupResult = runCli(['setup', '--runtimes', 'opencode', '--yes', '--json'], {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      OPENCODE_CONFIG_DIR: opencodeConfigDir
    });
    expect(setupResult.status).toBe(0);
    const setupPayload = JSON.parse(setupResult.stdout) as {
      capabilityMatrix: Array<{ runtime: string; supportLevel: string; installStatus: string }>;
      summary: string;
    };
    expect(setupPayload.capabilityMatrix[0]).toMatchObject({
      runtime: 'opencode',
      supportLevel: 'supported',
      installStatus: 'configured'
    });
    expect(await readFile(join(opencodeConfigDir, 'skills', 'oh-my-openharness', 'SKILL.md'), 'utf8')).toContain('host-native authoring');

    const doctorResult = runCli(['doctor', '--runtimes', 'opencode', '--json'], {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      OPENCODE_CONFIG_DIR: opencodeConfigDir
    });
    expect(doctorResult.status).toBe(0);
    const doctorPayload = JSON.parse(doctorResult.stdout) as {
      runtimes: Array<{ installShape: { status: string; details: string[] }; hostReadiness: { status: string; details: string[] } }>;
    };
    expect(doctorPayload.runtimes[0]?.installShape.status).toBe('ok');
    expect(doctorPayload.runtimes[0]?.hostReadiness.status).toBe('warning');
    expect(doctorPayload.runtimes[0]?.hostReadiness.details[0]).toContain('Verify host readiness separately');
  });

  test('Codex setup installs a host-native authoring bridge and doctor reports host verification guidance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-cli-codex-'));
    const binDir = join(root, 'bin');
    const codexHome = join(root, 'codex');
    await mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir, 'codex');

    const setupResult = runCli(['setup', '--runtimes', 'codex', '--yes', '--json'], {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      CODEX_HOME: codexHome
    });
    expect(setupResult.status).toBe(0);
    const setupPayload = JSON.parse(setupResult.stdout) as {
      capabilityMatrix: Array<{ runtime: string; supportLevel: string; installStatus: string }>;
      summary: string;
    };
    expect(setupPayload.capabilityMatrix[0]).toMatchObject({
      runtime: 'codex',
      supportLevel: 'supported',
      installStatus: 'configured'
    });
    expect(await readFile(join(codexHome, 'skills', 'oh-my-openharness', 'SKILL.md'), 'utf8')).toContain('host-native authoring');

    const doctorResult = runCli(['doctor', '--runtimes', 'codex', '--json'], {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      CODEX_HOME: codexHome
    });
    expect(doctorResult.status).toBe(0);
    const doctorPayload = JSON.parse(doctorResult.stdout) as {
      runtimes: Array<{ installShape: { status: string; details: string[] }; hostReadiness: { status: string; details: string[] } }>;
    };
    expect(doctorPayload.runtimes[0]?.installShape.status).toBe('ok');
    expect(doctorPayload.runtimes[0]?.hostReadiness.status).toBe('warning');
    expect(doctorPayload.runtimes[0]?.hostReadiness.details[0]).toContain('Verify host readiness separately');
  });
});
