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
});
