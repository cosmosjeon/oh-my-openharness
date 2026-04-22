import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseRuntimeTarget } from '../src/core/runtime-targets';

function sharedRepoRoot() {
  const commonGitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  }).trim();
  return dirname(resolve(process.cwd(), commonGitDir));
}

const repoRoot = sharedRepoRoot();
const phase5ProofDir = join(repoRoot, '.omx', 'proofs', 'phase-5', 'scenarios');
const phase5ManifestPath = join(repoRoot, '.omx', 'plans', 'oh-my-openharness', 'PHASES', 'phase-5', 'proofs-manifest.md');

function normalizeRuntime(runtime: string | undefined) {
  return runtime ? parseRuntimeTarget(runtime) : undefined;
}

describe('Phase 5 proof audit', () => {
  test('phase 5 proof manifest lists every scenario artifact', async () => {
    const scenarioFiles = (await readdir(phase5ProofDir)).filter((file) => file.endsWith('.json')).sort();
    const manifest = await readFile(phase5ManifestPath, 'utf8');
    const listedFiles = [...manifest.matchAll(/\.omx\/proofs\/phase-5\/scenarios\/([^\s|]+\.json)/g)].map((match) => match[1]).sort();

    expect(listedFiles).toEqual(scenarioFiles);
    expect(scenarioFiles.length).toBeGreaterThanOrEqual(7);
  });

  test('phase 5 proofs stay aligned with runtime and verification contracts', async () => {
    const scenarioFiles = (await readdir(phase5ProofDir)).filter((file) => file.endsWith('.json')).sort();
    const coveredRuntimes = new Set<string>();

    for (const file of scenarioFiles) {
      const payload = JSON.parse(await readFile(join(phase5ProofDir, file), 'utf8')) as {
        phase: number;
        runtime: string;
        result: string;
        exact_command_or_invocation_path: string[];
        expected_proof_artifacts: string[];
        artifacts: Record<string, any>;
      };

      // Scenario envelopes sometimes use setup-runtime labels like `claude`,
      // while generated manifests use canonical target-runtime labels like
      // `claude-code`. Normalize through the runtime parser so this audit checks
      // the real contract instead of string spelling differences.
      const canonicalRuntime = normalizeRuntime(payload.runtime);
      coveredRuntimes.add(canonicalRuntime ?? payload.runtime);

      expect(payload.phase).toBe(5);
      expect(payload.result).toBe('pass');
      expect(payload.expected_proof_artifacts).toContain(`.omx/proofs/phase-5/scenarios/${file}`);
      expect(payload.exact_command_or_invocation_path.length).toBeGreaterThan(0);
      expect(payload.exact_command_or_invocation_path.some((command) => command.includes('/bin/oh-my-openharness'))).toBe(true);
      expect(payload.artifacts.sandbox?.success).toBe(true);
      expect(payload.artifacts.sandbox?.events.length ?? 0).toBeGreaterThan(0);

      const runtimeLabels = [
        payload.runtime,
        ...(payload.artifacts.setup?.selectedRuntimes ?? []),
        ...(payload.artifacts.doctor?.selectedRuntimes ?? []),
        payload.artifacts.export?.runtime,
        payload.artifacts.exportManifest?.runtime,
        payload.artifacts.manifest?.targetRuntime,
        payload.artifacts.importedManifest?.targetRuntime
      ].filter((value): value is string => Boolean(value));

      for (const runtimeLabel of runtimeLabels) {
        expect(normalizeRuntime(runtimeLabel)).toBe(canonicalRuntime);
      }

      const manifestRuntimes = [
        ...(payload.artifacts.manifest?.supportedRuntimes ?? []),
        ...(payload.artifacts.importedManifest?.supportedRuntimes ?? [])
      ].filter((value): value is string => Boolean(value));
      for (const runtimeLabel of manifestRuntimes) {
        expect(normalizeRuntime(runtimeLabel)).toBe(canonicalRuntime);
      }

      const commands = payload.exact_command_or_invocation_path.join('\n');
      // Some import proofs intentionally consume a previously exported bundle, so
      // an `export` artifact can be present without an `export` command in the
      // current scenario invocation path.
      if (payload.artifacts.setup) expect(commands).toContain(' setup ');
      if (payload.artifacts.doctor) expect(commands).toContain(' doctor ');
      if (payload.artifacts.import) expect(commands).toContain(' import ');
      if (payload.artifacts.sandbox) expect(commands).toContain(' sandbox ');
    }

    expect([...coveredRuntimes].sort()).toEqual(['claude-code', 'codex', 'opencode']);
  });
});
