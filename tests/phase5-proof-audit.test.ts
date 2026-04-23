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
const latestPacketPath = join(repoRoot, '.omx', 'plans', 'oh-my-openharness', 'STATUS', 'latest-packet.json');

const PHASE5_RUNTIME_THRESHOLDS = {
  claude: 3,
  opencode: 2,
  codex: 2
} as const;

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
      if (payload.artifacts.authored) expect(commands).toContain(' author ');
      if (payload.artifacts.created) expect(commands).toContain(' new ');
      if (payload.artifacts.import) expect(commands).toContain(' import ');
      if (payload.artifacts.editor || payload.artifacts.traceFromServer) expect(commands).toContain(' serve ');
      if ((payload.artifacts.export || payload.artifacts.exportManifest) && !payload.artifacts.import) expect(commands).toContain(' export ');
      if (payload.artifacts.sandbox) expect(commands).toContain(' sandbox ');
    }

    expect([...coveredRuntimes].sort()).toEqual(['claude-code', 'codex', 'opencode']);
  });

  test('phase 5 latest packet satisfies the 3/2/2 runtime threshold against actual proofs', async () => {
    const scenarioFiles = (await readdir(phase5ProofDir)).filter((file) => file.endsWith('.json')).sort();
    const packet = JSON.parse(await readFile(latestPacketPath, 'utf8')) as {
      scenario_table: Array<{ scenario_id: string; result: string }>;
      proof_artifacts: Array<{ class: string; runtime?: string; scenario_id?: string }>;
    };

    const proofCounts = { claude: 0, opencode: 0, codex: 0 } as Record<keyof typeof PHASE5_RUNTIME_THRESHOLDS, number>;
    for (const file of scenarioFiles) {
      const payload = JSON.parse(await readFile(join(phase5ProofDir, file), 'utf8')) as { runtime: string; result: string };
      if (payload.result === 'pass' && payload.runtime in proofCounts) proofCounts[payload.runtime as keyof typeof proofCounts] += 1;
    }

    const packetCounts = { claude: 0, opencode: 0, codex: 0 } as Record<keyof typeof PHASE5_RUNTIME_THRESHOLDS, number>;
    for (const artifact of packet.proof_artifacts) {
      if (artifact.class === 'scenario-result' && artifact.runtime && artifact.runtime in packetCounts) {
        packetCounts[artifact.runtime as keyof typeof packetCounts] += 1;
      }
    }

    for (const runtime of Object.keys(PHASE5_RUNTIME_THRESHOLDS) as Array<keyof typeof PHASE5_RUNTIME_THRESHOLDS>) {
      expect(proofCounts[runtime]).toBeGreaterThanOrEqual(PHASE5_RUNTIME_THRESHOLDS[runtime]);
      expect(packetCounts[runtime]).toBeGreaterThanOrEqual(PHASE5_RUNTIME_THRESHOLDS[runtime]);
      expect(packet.scenario_table.filter((scenario) => scenario.result === 'pass' && scenario.scenario_id.includes(`-${runtime === 'claude' ? 'cld' : runtime === 'opencode' ? 'opc' : 'cdx'}-`)).length)
        .toBeGreaterThanOrEqual(PHASE5_RUNTIME_THRESHOLDS[runtime]);
    }
  });

  test('phase 5 includes explicit Codex author + serve/editor + export + validate evidence', async () => {
    const scenarioFiles = (await readdir(phase5ProofDir)).filter((file) => file.endsWith('.json')).sort();
    const codexScenarioPayloads = await Promise.all(
      scenarioFiles.map(async (file) => ({
        file,
        payload: JSON.parse(await readFile(join(phase5ProofDir, file), 'utf8')) as {
          runtime: string;
          exact_command_or_invocation_path: string[];
          artifacts: Record<string, any>;
        }
      }))
    );

    const explicitCodexProof = codexScenarioPayloads.find(({ payload }) => {
      const commands = payload.exact_command_or_invocation_path.join('\n');
      return payload.runtime === 'codex'
        && Boolean(payload.artifacts.authored)
        && Boolean(payload.artifacts.editor)
        && Boolean(payload.artifacts.export)
        && Boolean(payload.artifacts.sandbox)
        && commands.includes(' author ')
        && commands.includes(' serve ')
        && commands.includes(' export ')
        && commands.includes(' sandbox ');
    });

    expect(explicitCodexProof).toBeDefined();
    expect(explicitCodexProof?.payload.artifacts.authored.hostAuthoring.runtime).toBe('codex');
    expect(explicitCodexProof?.payload.artifacts.editor.addNodePayload.nodes.length ?? 0).toBeGreaterThan(0);
    expect(explicitCodexProof?.payload.artifacts.sandbox.success).toBe(true);
  });
});
