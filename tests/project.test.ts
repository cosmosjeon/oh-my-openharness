import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { generateHarnessProject } from '../src/core/generator';
import { loadHarnessProject, writeHarnessProject } from '../src/core/project';

describe('project persistence', () => {
  test('writes extensible runtime/composite metadata and reloads it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-project-roundtrip-'));
    const project = generateHarnessProject('roundtrip', 'Create a harness with MCP server and approval flow');
    project.composites = [{ id: 'cmp-1', patternId: 'mcp-registration', label: 'MCP Registration' }];
    project.runtimeIntents = [
      {
        id: 'intent:mcp',
        kind: 'mcp-server',
        label: 'Generated MCP',
        targetRuntime: 'claude-code',
        sourceNodeIds: ['mcp-server'],
        transport: 'stdio',
        safety: 'confirm'
      }
    ];
    project.customBlocks = [
      {
        id: 'custom-1',
        label: 'Opaque Runtime Logic',
        opaque: true,
        ports: [
          { id: 'in', label: 'In', direction: 'input' },
          { id: 'out', label: 'Out', direction: 'output' }
        ],
        runtimeTargets: ['claude-code']
      }
    ];
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
    expect(loaded.composites?.[0]?.patternId).toBe('mcp-registration');
    expect(loaded.runtimeIntents?.[0]?.kind).toBe('mcp-server');
    expect(loaded.customBlocks?.[0]?.opaque).toBe(true);
    expect(loaded.skills.map((skill) => skill.name)).toEqual(['roundtrip-skill', 'roundtrip-followup']);

    const runtimeJson = JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8'));
    expect(runtimeJson).toHaveLength(1);
    const skillIndex = JSON.parse(await readFile(join(root, 'skills', 'index.json'), 'utf8'));
    expect(skillIndex).toHaveLength(2);
  });

  test('loads legacy project shape and derives runtime intents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-project-legacy-'));
    await mkdir(join(root, 'graph'), { recursive: true });
    await mkdir(join(root, 'skills'), { recursive: true });

    await writeFile(
      join(root, 'harness.json'),
      JSON.stringify(
        {
          name: 'legacy',
          version: '0.1.0',
          description: 'Legacy project',
          targetRuntime: 'claude-code',
          createdAt: new Date().toISOString(),
          prompt: 'Create a harness with MCP server'
        },
        null,
        2
      )
    );
    await writeFile(
      join(root, 'graph', 'nodes.json'),
      JSON.stringify(
        [
          { id: 'session-start', kind: 'SessionStart', label: 'Session Start' },
          { id: 'mcp-server', kind: 'MCPServer', label: 'MCP Server Registration' }
        ],
        null,
        2
      )
    );
    await writeFile(join(root, 'graph', 'edges.json'), JSON.stringify([], null, 2));
    await writeFile(join(root, 'layout.json'), JSON.stringify([], null, 2));
    await writeFile(join(root, 'skills', 'legacy-skill.md'), '# legacy');

    const loaded = await loadHarnessProject(root);

    expect(loaded.manifest.schemaVersion).toBe('0.1.0');
    expect(loaded.manifest.supportedRuntimes).toEqual(['claude-code']);
    expect(loaded.runtimeIntents?.map((intent) => intent.kind)).toEqual(['hook', 'mcp-server']);
    expect(loaded.skills[0]?.name).toBe('legacy-skill');
  });
});
