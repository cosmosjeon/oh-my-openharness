import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

function sharedRepoRoot() {
  const commonGitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  }).trim();
  return dirname(resolve(process.cwd(), commonGitDir));
}

const repoRoot = sharedRepoRoot();
const schemaPath = join(repoRoot, '.omx', 'plans', 'oh-my-openharness', 'EXECUTION', 'continuation-packet-schema.json');
const latestPacketPath = join(repoRoot, '.omx', 'plans', 'oh-my-openharness', 'STATUS', 'latest-packet.json');
const phase5ProofDir = join(repoRoot, '.omx', 'proofs', 'phase-5', 'scenarios');

describe('continuation packet validator', () => {
  test('latest packet satisfies the continuation schema contract and points at real proof artifacts', async () => {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as {
      required: string[];
      properties: {
        status: { enum: string[] };
        baseline_state: { enum: string[] };
      };
    };
    const packet = JSON.parse(await readFile(latestPacketPath, 'utf8')) as {
      phase: number;
      status: string;
      baseline_state: string;
      timestamp: string;
      audit_completed: boolean;
      scenario_table: Array<{ scenario_id: string; result: string; severity: string }>;
      proof_artifacts: Array<{ class: string; path?: string; scenario_id?: string }>;
    };
    const scenarioFiles = (await readdir(phase5ProofDir)).filter((file) => file.endsWith('.json')).sort();
    const scenarioIds = new Set<string>();
    for (const file of scenarioFiles) {
      const payload = JSON.parse(await readFile(join(phase5ProofDir, file), 'utf8')) as { scenario_id: string };
      scenarioIds.add(payload.scenario_id);
    }

    for (const field of schema.required) expect(packet).toHaveProperty(field);
    expect(packet.phase).toBe(5);
    expect(schema.properties.status.enum).toContain(packet.status);
    expect(schema.properties.baseline_state.enum).toContain(packet.baseline_state);
    expect(packet.audit_completed).toBe(true);
    expect(Date.parse(packet.timestamp)).not.toBeNaN();

    expect(new Set(packet.scenario_table.map((scenario) => scenario.scenario_id))).toEqual(scenarioIds);
    for (const scenario of packet.scenario_table) {
      expect(['pass', 'fail']).toContain(scenario.result);
      expect(typeof scenario.severity).toBe('string');
    }

    for (const artifact of packet.proof_artifacts) {
      if (artifact.path) expect(existsSync(join(repoRoot, artifact.path))).toBe(true);
      if (artifact.scenario_id) expect(scenarioIds.has(artifact.scenario_id)).toBe(true);
    }
  });
});
