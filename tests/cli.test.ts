import { describe, expect, test as bunTest } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

const test = (name: string, fn: Parameters<typeof bunTest>[1]) => bunTest(name, fn, 60000);

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

async function createHostAuthoringBinary(dir: string, name: string, runtimeEnvVar: string, payload: unknown) {
  const path = join(dir, name);
  await writeFile(
    path,
    `#!/usr/bin/env sh
if [ -n "$OMOH_CAPTURE_FILE" ]; then
  printf '%s' "$${runtimeEnvVar}" > "$OMOH_CAPTURE_FILE"
fi
cat <<'JSON'
${JSON.stringify(payload, null, 2)}
JSON
`
  );
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

  test('export rejects unresolved confirmations the same way compile does', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-cli-export-risk-'));
    const createResult = runCli(['new', '--name', 'risk-target', '--prompt', 'Create a harness with full access and MCP server', '--runtime', 'codex', '--dir', root, '--confirm-risk']);
    expect(createResult.status).toBe(0);
    const projectDir = join(root, 'risk-target');
    const authoringPath = join(projectDir, 'authoring', 'decision.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8')) as { confirmationRequests: Array<{ confirmed: boolean }> };
    authoring.confirmationRequests[0]!.confirmed = false;
    await writeFile(authoringPath, JSON.stringify(authoring, null, 2));

    const compileResult = runCli(['compile', '--project', projectDir]);
    const exportResult = runCli(['export', '--project', projectDir]);

    expect(compileResult.status).toBe(1);
    expect(exportResult.status).toBe(1);
    expect(compileResult.stderr).toContain('Generation requires confirmation before proceeding');
    expect(exportResult.stderr).toContain('Generation requires confirmation before proceeding');
  });

  test('export manifests stay relative and relocated bundles still import successfully', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-cli-export-relocate-'));
    const createResult = runCli(['new', '--name', 'relocate-source', '--prompt', 'Create a harness with MCP server and state memory', '--runtime', 'codex', '--dir', root, '--confirm-risk']);
    expect(createResult.status).toBe(0);
    const projectDir = join(root, 'relocate-source');
    const exportResult = runCli(['export', '--project', projectDir]);
    expect(exportResult.status).toBe(0);

    const exportPayload = JSON.parse(exportResult.stdout) as { outDir: string; exportManifestPath: string; runtimeBundleManifestPath: string };
    const exportManifest = JSON.parse(await readFile(exportPayload.exportManifestPath, 'utf8')) as {
      exportRoot: string;
      canonicalRoot: string;
      runtimeRoot: string;
      runtimeBundleManifestPath: string;
      validationManifestPath: string;
    };
    expect(isAbsolute(exportManifest.exportRoot)).toBe(false);
    expect(isAbsolute(exportManifest.canonicalRoot)).toBe(false);
    expect(isAbsolute(exportManifest.runtimeRoot)).toBe(false);
    expect(isAbsolute(exportManifest.runtimeBundleManifestPath)).toBe(false);
    expect(isAbsolute(exportManifest.validationManifestPath)).toBe(false);

    const runtimeManifest = JSON.parse(await readFile(exportPayload.runtimeBundleManifestPath, 'utf8')) as { runtimeRoot: string };
    expect(isAbsolute(runtimeManifest.runtimeRoot)).toBe(false);

    const relocatedRoot = join(root, 'relocated-bundle');
    await cp(exportPayload.outDir, relocatedRoot, { recursive: true });
    const importDir = join(root, 'relocated-imports');
    const importResult = runCli(['import', '--from', relocatedRoot, '--name', 'relocated-project', '--dir', importDir]);
    expect(importResult.status).toBe(0);
    const importedManifest = JSON.parse(await readFile(join(importDir, 'relocated-project', 'harness.json'), 'utf8')) as { targetRuntime: string; description: string };
    expect(importedManifest.targetRuntime).toBe('codex');
    expect(importedManifest.description).toContain('Imported seed harness');
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

    const pluginJson = JSON.parse(await readFile(join(claudeConfigDir, 'plugins', 'oh-my-openharness', 'plugin.json'), 'utf8')) as { name: string; hooks: string; skills: string; packageName: string; stateContract: string };
    expect(pluginJson.name).toBe('oh-my-openharness');
    expect(pluginJson.packageName).toBe('harness-maker');
    expect(pluginJson.hooks).toBe('./hooks/hooks.json');
    expect(pluginJson.skills).toBe('./skills');
    expect(pluginJson.stateContract).toBe('./state-contract.json');
    expect(await readFile(join(claudeConfigDir, 'plugins', 'oh-my-openharness', 'skills', 'harness-factory', 'SKILL.md'), 'utf8')).toContain('Harness Factory');
  });

  test('setup dry-run reports the Claude harness-maker package plan without writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-cli-setup-dry-run-'));
    const binDir = join(root, 'bin');
    const claudeConfigDir = join(root, 'claude');
    await mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir, 'claude');

    const result = runCli(['setup', '--runtimes', 'claude', '--dry-run', '--json'], {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      CLAUDE_CONFIG_DIR: claudeConfigDir
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      approvalRequired: boolean;
      capabilityMatrix: Array<{ runtime: string; packageName?: string; packageKind?: string; installStatus: string }>;
      riskyWrites: Array<{ path: string; reason: string }>;
    };
    expect(payload.approvalRequired).toBe(true);
    expect(payload.capabilityMatrix[0]).toMatchObject({
      runtime: 'claude',
      packageName: 'harness-maker',
      packageKind: 'claude-native-harness-maker',
      installStatus: 'ready-to-apply'
    });
    expect(payload.riskyWrites.some((write) => write.path.endsWith('state-contract.json'))).toBe(true);
    expect(payload.riskyWrites.some((write) => write.path.endsWith('skills/harness-factory/SKILL.md'))).toBe(true);
    expect(payload.riskyWrites.every((write) => write.reason.includes('harness-maker') || write.path.endsWith('oh-my-openharness'))).toBe(true);
    expect(existsSync(join(claudeConfigDir, 'plugins', 'oh-my-openharness'))).toBe(false);
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
        packageName?: string;
        packageKind?: string;
        installShape: { status: string };
        hostReadiness: { status: string; details: string[] };
        suggestedNextCommand: string;
      }>;
    };
    expect(payload.runtimes[0]?.runtime).toBe('claude');
    expect(payload.runtimes[0]?.packageName).toBe('harness-maker');
    expect(payload.runtimes[0]?.packageKind).toBe('claude-native-harness-maker');
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

  const authorRuntimeCases = [
    { runtime: 'claude', targetRuntime: 'claude-code', binary: 'claude', envVar: 'CLAUDE_CONFIG_DIR', rootDirName: 'claude-root' },
    { runtime: 'opencode', targetRuntime: 'opencode', binary: 'opencode', envVar: 'OPENCODE_CONFIG_DIR', rootDirName: 'opencode-root' },
    { runtime: 'codex', targetRuntime: 'codex', binary: 'codex', envVar: 'CODEX_HOME', rootDirName: 'codex-root' }
  ] as const;

  for (const testCase of authorRuntimeCases) {
    test(`author applies host-authored graph deltas and preserves configured runtime roots for ${testCase.runtime}`, async () => {
      const root = await mkdtemp(join(tmpdir(), `omoh-cli-author-${testCase.runtime}-`));
      const binDir = join(root, 'bin');
      const configRoot = join(root, testCase.rootDirName);
      const captureFile = join(root, 'captured-root.txt');
      await mkdir(binDir, { recursive: true });
      await createHostAuthoringBinary(binDir, testCase.binary, testCase.envVar, {
        summary: `${testCase.runtime} host-authored summary`,
        emphasis: ['graph'],
        warnings: [`${testCase.runtime} host warning`],
        graphDelta: {
          nodes: {
            add: [{ id: `${testCase.runtime}-guard`, kind: 'Condition', label: `${testCase.runtime} guard` }]
          },
          edges: {
            add: [{ id: `${testCase.runtime}-guard-edge`, from: 'main-skill', to: `${testCase.runtime}-guard`, label: 'host-link' }]
          }
        }
      });

      const env = {
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
        [testCase.envVar]: configRoot,
        OMOH_CAPTURE_FILE: captureFile
      };

      const setupResult = runCli(['setup', '--runtimes', testCase.runtime, '--yes', '--json'], env);
      expect(setupResult.status).toBe(0);

      const authorResult = runCli(
        ['author', '--name', `${testCase.runtime}-author-target`, '--prompt', 'Create a harness with review loop', '--runtime', testCase.targetRuntime, '--dir', root, '--confirm-risk'],
        env
      );
      expect(authorResult.status).toBe(0);

      expect(await readFile(captureFile, 'utf8')).toBe(configRoot);
      const projectDir = join(root, `${testCase.runtime}-author-target`);
      const nodes = JSON.parse(await readFile(join(projectDir, 'graph', 'nodes.json'), 'utf8')) as Array<{ id: string }>;
      const edges = JSON.parse(await readFile(join(projectDir, 'graph', 'edges.json'), 'utf8')) as Array<{ id: string }>;
      const authoring = JSON.parse(await readFile(join(projectDir, 'authoring', 'decision.json'), 'utf8')) as { summary: string; warnings: string[] };

      expect(nodes.some((node) => node.id === `${testCase.runtime}-guard`)).toBe(true);
      expect(edges.some((edge) => edge.id === `${testCase.runtime}-guard-edge`)).toBe(true);
      expect(authoring.summary).toBe(`${testCase.runtime} host-authored summary`);
      expect(authoring.warnings).toContain(`${testCase.runtime} host warning`);
    });
  }
});
