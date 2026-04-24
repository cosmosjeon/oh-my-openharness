import { describe, expect, test as bunTest } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import packageJson from '../package.json' with { type: 'json' };
import { applyRiskConfirmations, generateHarnessProject } from '../src/core/generator';
import { writeHarnessProject } from '../src/core/project';
import { catalogFromProject, compatibilityForNode, runtimeCompatibilityForNode, serializeFlowLayout, skillForFlowNode, toReactFlowEdges, toReactFlowNodes } from '../src/web/client/graph';
import { startHarnessEditorServer } from '../src/web/server';

const test = (name: string, fn: Parameters<typeof bunTest>[1]) => bunTest(name, fn, 120000);

function projectPayload() {
  const project = applyRiskConfirmations(generateHarnessProject('gui-client-build', 'Create a harness with approval, MCP server, and state memory'), true);
  return {
    manifest: project.manifest,
    nodes: project.nodes,
    edges: project.edges,
    layout: project.layout,
    skills: project.skills,
    composites: project.composites,
    customBlocks: project.customBlocks,
    registry: project.registry,
    authoring: project.authoring,
    runtimeIntents: project.runtimeIntents ?? []
  };
}

describe('React Flow GUI client foundation', () => {
  test('dependency additions stay within the Phase G allowlist', () => {
    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual(['@xyflow/react', 'react', 'react-dom']);
    expect(Object.keys(packageJson.devDependencies ?? {}).sort()).toEqual([
      '@types/react',
      '@types/react-dom',
      '@vitejs/plugin-react',
      'bun-types',
      'typescript',
      'vite'
    ]);
  });

  test('canonical graph maps to React Flow nodes/edges with stable ids and layout serialization', () => {
    const project = projectPayload();
    const nodes = toReactFlowNodes(project);
    const edges = toReactFlowEdges(project);

    expect(nodes.map((node) => node.id)).toEqual(project.nodes.map((node) => node.id));
    expect(edges.map((edge) => edge.id)).toEqual(project.edges.map((edge) => edge.id));
    expect(nodes[0]?.position).toEqual({ x: project.layout[0]!.x, y: project.layout[0]!.y });
    expect(serializeFlowLayout(nodes)).toEqual(project.layout);
  });

  test('catalog and compatibility helpers derive from registry/runtime metadata', () => {
    const project = projectPayload();
    const catalog = catalogFromProject(project);
    const node = project.nodes.find((entry) => entry.kind === 'MCPServer')!;

    expect(catalog.blocks).toBe(project.registry.blocks);
    expect(catalog.composites).toBe(project.registry.composites);
    expect(compatibilityForNode(project, node)).toEqual(['claude-code', 'opencode', 'codex']);
    expect(runtimeCompatibilityForNode(project, node).map((entry) => `${entry.runtime}:${entry.level}`)).toEqual([
      'claude-code:supported',
      'opencode:supported',
      'codex:supported'
    ]);
  });

  test('skill inspector resolution follows canonical skill ids from Skill node config', () => {
    const project = projectPayload();
    const flowNodes = toReactFlowNodes(project);
    const skillGraphNode = project.nodes.find((node) => node.kind === 'Skill')!;
    const flowNode = flowNodes.find((node) => node.id === skillGraphNode.id)!;

    expect(flowNode.data.config?.skillId).toBe('skill-main');
    expect(skillForFlowNode(project, flowNode)?.id).toBe('skill-main');
  });

  test('custom block compatibility badges follow runtime target metadata', () => {
    const project = {
      ...projectPayload(),
      ...(() => {
        const generated = applyRiskConfirmations(generateHarnessProject('gui-custom-block', 'Create a harness with custom novel runtime block'), true);
        return {
          manifest: generated.manifest,
          nodes: generated.nodes,
          edges: generated.edges,
          layout: generated.layout,
          skills: generated.skills,
          composites: generated.composites,
          customBlocks: generated.customBlocks,
          registry: generated.registry,
          authoring: generated.authoring,
          runtimeIntents: generated.runtimeIntents ?? []
        };
      })()
    };
    const customNode = project.nodes.find((node) => node.kind === 'CustomBlock')!;
    project.customBlocks = project.customBlocks.map((block) => ({ ...block, runtimeTargets: ['claude-code'] }));

    expect(runtimeCompatibilityForNode(project, customNode).map((entry) => `${entry.runtime}:${entry.level}`)).toEqual([
      'claude-code:supported',
      'opencode:error',
      'codex:error'
    ]);
  });

  test('Vite builds the client and the server can serve built assets', async () => {
    const build = spawnSync('bun', ['run', 'build:web'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(build.status, build.stderr || build.stdout).toBe(0);

    const root = await mkdtemp(join(tmpdir(), 'omoh-gui-client-build-'));
    const projectDir = join(root, 'project');
    await writeHarnessProject(projectDir, applyRiskConfirmations(generateHarnessProject('built-gui-project', 'Create a harness with review loop'), true));
    const handle = await startHarnessEditorServer({ projectDir, host: '127.0.0.1', staticRoot: join(process.cwd(), 'dist', 'web-client') });
    try {
      const index = await fetch(`${handle.url}/`);
      expect(index.status).toBe(200);
      const html = await index.text();
      expect(html).toContain('Harness Editor');
      expect(html).toContain('/assets/');

      const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
      expect(asset).toBeDefined();
      const assetResponse = await fetch(`${handle.url}${asset}`);
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get('content-type') ?? '').toContain('text/javascript');
    } finally {
      await handle.close();
    }
  });
});
