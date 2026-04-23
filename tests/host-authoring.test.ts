import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyHostAuthoring } from '../src/core/host-authoring';
import { generateHarnessProject } from '../src/core/generator';
import { loadHarnessProject, writeHarnessProject } from '../src/core/project';

describe('host authoring bridge', () => {
  test('applies graph deltas to the canonical project summary, graph, runtime intents, skills, and persisted layout', async () => {
    const project = generateHarnessProject('hosted', 'Create a harness with state memory', 'codex');
    const updated = applyHostAuthoring(project, {
      runtime: 'codex',
      summary: 'Codex-guided authoring summary',
      emphasis: ['state', 'review'],
      warnings: ['Host runtime returned a compact plan'],
      graphDelta: {
        manifest: {
          description: 'Host-authored canonical harness'
        },
        nodes: {
          add: [{ id: 'runtime-guard', kind: 'Condition', label: 'Runtime Guard', config: { mode: 'strict' } }],
          update: [{ id: 'main-skill', label: 'Host Authored Skill' }],
          remove: ['state-read']
        },
        edges: {
          add: [{ id: 'edge-runtime-guard', from: 'main-skill', to: 'runtime-guard', label: 'host-authored' }]
        },
        skills: {
          update: [{ id: 'skill-main', appendContent: '\n## Host mutation\n- runtime guard enabled\n' }]
        },
        runtimeIntents: {
          add: [
            {
              id: 'intent:runtime-guard',
              kind: 'custom-runtime',
              label: 'Runtime Guard Intent',
              targetRuntime: 'codex',
              sourceNodeIds: ['runtime-guard'],
              safety: 'confirm'
            }
          ]
        }
      },
      rawOutput: '{"summary":"Codex-guided authoring summary","emphasis":["state","review"],"warnings":["Host runtime returned a compact plan"]}',
      command: 'codex exec <prompt>'
    });

    expect(updated.authoring.summary).toBe('Codex-guided authoring summary');
    expect(updated.authoring.warnings).toContain('Host runtime returned a compact plan');
    expect(updated.manifest.description).toBe('Host-authored canonical harness');
    expect(updated.nodes.some((node) => node.id === 'runtime-guard')).toBe(true);
    expect(updated.nodes.some((node) => node.id === 'state-read')).toBe(false);
    expect(updated.nodes.find((node) => node.id === 'main-skill')?.label).toBe('Host Authored Skill');
    expect(updated.edges.some((edge) => edge.id === 'edge-runtime-guard')).toBe(true);
    expect(updated.runtimeIntents?.some((intent) => intent.id === 'intent:runtime-guard')).toBe(true);
    expect(updated.skills[0]?.content).toContain('Host-native authoring guidance');
    expect(updated.skills[0]?.content).toContain('Host mutation');
    expect(updated.skills[0]?.content).toContain('Codex-guided authoring summary');

    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-host-authoring-'));
    await writeHarnessProject(root, updated);
    const reloaded = await loadHarnessProject(root);

    expect(reloaded.nodes.some((node) => node.id === 'runtime-guard')).toBe(true);
    expect(reloaded.edges.some((edge) => edge.id === 'edge-runtime-guard')).toBe(true);
    expect(reloaded.layout.some((item) => item.id === 'runtime-guard')).toBe(true);
    expect(reloaded.runtimeIntents?.some((intent) => intent.id === 'intent:runtime-guard')).toBe(true);
  });
});
