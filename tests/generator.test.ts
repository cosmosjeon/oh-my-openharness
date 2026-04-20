import { describe, expect, test } from 'bun:test';
import { generateHarnessProject } from '../src/core/generator';

describe('generateHarnessProject', () => {
  test('adds MCP and permission related nodes from prompt keywords', () => {
    const project = generateHarnessProject('sample', 'Create a harness with MCP server and approval flow');
    const kinds = project.nodes.map((node) => node.kind);
    expect(kinds).toContain('MCPServer');
    expect(kinds).toContain('Permission');
    expect(project.authoring.confirmationRequests.length).toBeGreaterThan(0);
    expect(project.registry.blocks.length).toBeGreaterThan(5);
    expect(project.composites.length).toBeGreaterThan(1);
  });

  test('captures authoring decisions from prompt cues while preserving the baseline flow', () => {
    const project = generateHarnessProject(
      'authoring-decisions',
      'Create a custom novel harness with retry loop, state memory, and approval flow'
    );
    const ids = project.nodes.map((node) => node.id);
    const kinds = project.nodes.map((node) => node.kind);

    expect(ids.slice(0, 5)).toEqual(['session-start', 'user-submit', 'main-skill', 'sequence-main', 'stop']);
    expect(kinds).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'Skill',
      'Sequence',
      'Stop',
      'Permission',
      'Loop',
      'StateWrite',
      'CustomBlock'
    ]);
    expect(project.edges).toHaveLength(project.nodes.length - 1);
    expect(project.layout.map((node) => node.id)).toEqual(ids);
  });
});
