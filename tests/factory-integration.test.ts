import { describe, expect, test } from 'bun:test';
import { exists } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileCanonicalProject, materializeFactoryDraft } from '../src/factory/actions';
import { enrichStateWithReferencePatterns, synthesizeDraftGraphSpec } from '../src/factory/synthesis';
import { createHarnessFactoryState } from '../src/factory/state';
import { loadHarnessProject } from '../src/core/project';

describe('Harness Factory minimal vertical integration', () => {
  test('turns factory state and reference patterns into a canonical project through substrate adapters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-factory-integration-'));
    const initial = createHarnessFactoryState({
      sessionId: 'vertical-slice',
      userIntent: 'Create a harness with approval gates, MCP server registration, persistent memory, review retry loop, and subagent delegation',
      targetRuntime: 'claude-code',
      requestedCapabilities: ['approval', 'mcp', 'state', 'review', 'retry', 'subagent']
    });
    const enriched = enrichStateWithReferencePatterns(initial, 6);
    const draftGraphSpec = synthesizeDraftGraphSpec(enriched, { name: 'factory-demo' });
    const state = { ...enriched, stage: 'drafting' as const, draftGraphSpec };

    const { projectDir } = await materializeFactoryDraft({ state, name: 'factory-demo', dir: root, confirmRisk: true });
    const loaded = await loadHarnessProject(projectDir);
    const compileResult = await compileCanonicalProject(projectDir);

    expect(enriched.referencePatterns.map((pattern) => pattern.id)).toContain('approval-gate.pre-tool-use');
    expect(loaded.nodes.map((node) => node.kind)).toContain('Permission');
    expect(loaded.nodes.map((node) => node.kind)).toContain('MCPServer');
    expect(loaded.nodes.map((node) => node.kind)).toContain('Loop');
    expect(loaded.nodes.map((node) => node.kind)).toContain('StateWrite');
    expect(loaded.manifest.description).toContain('Harness Factory draft');
    expect(compileResult.runtimeDisplayName).toBe('Claude');
    expect(await exists(compileResult.exportManifestPath)).toBe(true);
  });
});
