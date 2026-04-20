import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRiskConfirmations, generateHarnessProject } from '../src/core/generator';
import { loadHarnessProject, writeHarnessProject } from '../src/core/project';

describe('project persistence', () => {
  test('writes extensible runtime/composite metadata and reloads it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-project-roundtrip-'));
    const project = applyRiskConfirmations(
      generateHarnessProject('roundtrip', 'Create a harness with MCP server and approval flow and custom runtime'),
      true
    );
    project.skills.push({
      id: 'skill-secondary',
      name: 'roundtrip-followup',
      description: 'Secondary skill',
      content: '# followup',
      path: 'followup.md'
    });

    await writeHarnessProject(root, project);
    const loaded = await loadHarnessProject(root);

    expect(loaded.manifest.schemaVersion).toBe('0.1.0');
    expect(loaded.manifest.supportedRuntimes).toEqual(['claude-code']);
    expect(loaded.composites.length).toBeGreaterThan(0);
    expect(loaded.runtimeIntents?.some((intent) => intent.kind === 'mcp-server')).toBe(true);
    expect(loaded.customBlocks[0]?.opaque).toBe(true);
    expect(loaded.skills.map((skill) => skill.name)).toEqual(['roundtrip-skill', 'roundtrip-followup']);
  });

  test('loads legacy project shape and derives runtime intents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-project-legacy-'));
    const project = generateHarnessProject('legacy', 'Create a harness with MCP server');
    await writeHarnessProject(root, project);
    const loaded = await loadHarnessProject(root);

    expect(loaded.manifest.schemaVersion).toBe('0.1.0');
    expect(loaded.runtimeIntents?.map((intent) => intent.kind)).toContain('mcp-server');
    expect(loaded.skills[0]?.name).toBe('legacy-skill');
  });
});
