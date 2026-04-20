import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateHarnessProject } from '../src/core/generator';
import { writeHarnessProject } from '../src/core/project';

describe('generateHarnessProject', () => {
  test('adds MCP and permission related nodes from prompt keywords', () => {
    const project = generateHarnessProject('sample', 'Create a harness with MCP server and approval flow');
    const kinds = project.nodes.map((node) => node.kind);
    expect(kinds).toContain('MCPServer');
    expect(kinds).toContain('Permission');
    expect(kinds).toContain('PreToolUse');
    expect(kinds).toContain('PostToolUse');
  });

  test('flags risky permission changes for confirmation', () => {
    const project = generateHarnessProject('sample', 'Create a harness with full access and bypass safety');
    expect(project.authoring.confirmationRequests.length).toBeGreaterThan(0);
    expect(project.authoring.confirmationRequests.every((request) => request.confirmed === false)).toBe(true);
  });

  test('writes canonical project structure with semantic/layout separation and registry snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-project-'));
    const projectDir = join(root, 'demo');
    const project = generateHarnessProject('demo', 'Create a harness with review loop and custom runtime block');
    await writeHarnessProject(projectDir, project);

    const layout = JSON.parse(await readFile(join(projectDir, 'layout.json'), 'utf8')) as Array<{ id: string }>;
    const nodes = JSON.parse(await readFile(join(projectDir, 'graph', 'nodes.json'), 'utf8')) as Array<{ id: string }>;
    const blocks = JSON.parse(await readFile(join(projectDir, 'registry', 'blocks.json'), 'utf8')) as Array<{ kind: string }>;
    const customBlocks = JSON.parse(
      await readFile(join(projectDir, 'custom-blocks', 'definitions.json'), 'utf8')
    ) as Array<{ id: string }>;

    expect(layout.length).toBe(nodes.length);
    expect(blocks.some((block) => block.kind === 'Permission')).toBe(true);
    expect(customBlocks.length).toBe(1);
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
