import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateHarnessProject } from '../src/core/generator';
import { loadHarnessProject, writeHarnessProject } from '../src/core/project';
import { BLOCK_REGISTRY, COMPOSITE_PATTERNS } from '../src/core/registry';

describe('canonical harness project model', () => {
  test('writes the expected Phase 0 project shape with layout kept separate from graph semantics', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'harness-editor-project-shape-'));
    const project = generateHarnessProject(
      'phase0-shape',
      'Create a harness with approval flow, review loop, mcp server, and state memory'
    );

    await writeHarnessProject(projectDir, project);

    const manifest = JSON.parse(await readFile(join(projectDir, 'harness.json'), 'utf8'));
    const nodes = JSON.parse(await readFile(join(projectDir, 'graph', 'nodes.json'), 'utf8'));
    const edges = JSON.parse(await readFile(join(projectDir, 'graph', 'edges.json'), 'utf8'));
    const layout = JSON.parse(await readFile(join(projectDir, 'layout.json'), 'utf8'));

    expect(manifest.name).toBe('phase0-shape');
    expect(nodes.length).toBe(project.nodes.length);
    expect(edges.length).toBe(project.edges.length);
    expect(layout.length).toBe(project.layout.length);
    expect(nodes.every((node: Record<string, unknown>) => !('x' in node) && !('y' in node))).toBe(true);
    expect(
      layout.every(
        (node: Record<string, unknown>) =>
          typeof node.id === 'string' && typeof node.x === 'number' && typeof node.y === 'number' && !('kind' in node)
      )
    ).toBe(true);

    const loaded = await loadHarnessProject(projectDir);
    expect(loaded.manifest).toEqual(project.manifest);
    expect(loaded.nodes).toEqual(project.nodes);
    expect(loaded.edges).toEqual(project.edges);
    expect(loaded.layout).toEqual(project.layout);
    expect(loaded.skills).toHaveLength(1);
    expect(loaded.skills[0]?.name).toBe(project.skills[0]?.name);
    expect(loaded.skills[0]?.content).toBe(project.skills[0]?.content);
  });

  test('uses one authoritative registry for generated blocks and composite patterns', () => {
    const registeredKinds = new Set(BLOCK_REGISTRY.map((block) => block.kind));
    const prompts = [
      'Create a harness with review loop and approval flow',
      'Create a harness with mcp server and state memory',
      'Create a custom novel runtime block with retry loop'
    ];

    for (const prompt of prompts) {
      const project = generateHarnessProject(`registry-${prompt.length}`, prompt);
      for (const node of project.nodes) {
        expect(registeredKinds.has(node.kind)).toBe(true);
      }
    }

    for (const pattern of COMPOSITE_PATTERNS) {
      for (const kind of pattern.includes) {
        expect(registeredKinds.has(kind)).toBe(true);
      }
    }
  });

  test('keeps the Phase 0 registry snapshot stable for compiler and authoring flows', () => {
    expect(
      BLOCK_REGISTRY.map((block) => ({
        kind: block.kind,
        description: block.description,
        ports: block.ports.map((port) => port.id)
      }))
    ).toEqual([
      { kind: 'SessionStart', description: 'Session start hook', ports: ['in', 'out'] },
      { kind: 'UserPromptSubmit', description: 'Prompt submit hook', ports: ['in', 'out'] },
      { kind: 'PreToolUse', description: 'Pre-tool hook', ports: ['in', 'out'] },
      { kind: 'PostToolUse', description: 'Post-tool hook', ports: ['in', 'out'] },
      { kind: 'Stop', description: 'Stop hook', ports: ['in', 'out'] },
      { kind: 'Skill', description: 'Reusable skill content', ports: ['in', 'out'] },
      { kind: 'Agent', description: 'Sub-agent delegation', ports: ['in', 'out'] },
      { kind: 'Condition', description: 'Conditional routing', ports: ['in', 'out'] },
      { kind: 'Loop', description: 'Retry or iteration loop', ports: ['in', 'out'] },
      { kind: 'StateRead', description: 'Read persisted state', ports: ['in', 'out'] },
      { kind: 'StateWrite', description: 'Write persisted state', ports: ['in', 'out'] },
      { kind: 'MCPServer', description: 'MCP registration or usage', ports: ['in', 'out'] },
      { kind: 'SystemPrompt', description: 'System prompt injection', ports: ['in', 'out'] },
      { kind: 'Permission', description: 'Permission gate', ports: ['in', 'out'] },
      { kind: 'Merge', description: 'Branch merge', ports: ['in', 'out'] },
      { kind: 'Sequence', description: 'Linear orchestration', ports: ['in', 'out'] },
      { kind: 'CustomBlock', description: 'Opaque generated logic block', ports: ['in', 'out'] }
    ]);

    expect(
      COMPOSITE_PATTERNS.map((pattern) => ({
        id: pattern.id,
        includes: pattern.includes
      }))
    ).toEqual([
      { id: 'permission-gate', includes: ['Permission', 'Condition', 'Sequence'] },
      { id: 'review-loop', includes: ['Skill', 'Loop', 'Condition'] },
      { id: 'session-init-bundle', includes: ['SessionStart', 'SystemPrompt', 'StateWrite'] },
      { id: 'ralph-loop', includes: ['Loop', 'Condition', 'Skill'] },
      { id: 'subagent-delegation', includes: ['Agent', 'Merge', 'Sequence'] },
      { id: 'mcp-registration', includes: ['MCPServer', 'Permission', 'Sequence'] }
    ]);
  });
});
