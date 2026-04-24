import { describe, expect, test as bunTest } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRiskConfirmations, generateHarnessProject } from '../src/core/generator';
import { loadHarnessProject, writeHarnessProject } from '../src/core/project';
import { compileClaude } from '../src/compiler/claude';
import { validateProject } from '../src/sandbox/validate';
import { renderTraceHtml } from '../src/web/report';
import { startHarnessEditorServer } from '../src/web/server';
import type { GraphEdge, GraphNode, LayoutNode, TraceEvent } from '../src/core/types';

const test = (name: string, fn: Parameters<typeof bunTest>[1]) => bunTest(name, fn, 180000);
const RICH_PROMPT = 'Create a review harness with approvals, state memory, MCP server support, and retry loop';

async function buildWrittenProject(name: string, prompt = RICH_PROMPT): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-gui-shell-'));
  const projectDir = join(root, name);
  const project = applyRiskConfirmations(generateHarnessProject(name, prompt), true);
  await writeHarnessProject(projectDir, project);
  return projectDir;
}

describe('GUI shell contract: loading canonical project data', () => {
  test('loadHarnessProject exposes a renderable graph (nodes, edges, layout) for a viewer', async () => {
    const projectDir = await buildWrittenProject('gui-shell-load');
    const loaded = await loadHarnessProject(projectDir);

    expect(loaded.nodes.length).toBeGreaterThan(0);
    expect(loaded.edges.length).toBeGreaterThan(0);
    expect(loaded.layout.length).toBe(loaded.nodes.length);

    const nodeIds = new Set(loaded.nodes.map((node: GraphNode) => node.id));
    for (const edge of loaded.edges as GraphEdge[]) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
    }

    const layoutIds = new Set(loaded.layout.map((position: LayoutNode) => position.id));
    for (const node of loaded.nodes) expect(layoutIds.has(node.id)).toBe(true);
    for (const position of loaded.layout as LayoutNode[]) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }

    expect(loaded.manifest.schemaVersion).toBeDefined();
    expect(loaded.manifest.targetRuntime).toBe('claude-code');
    expect(loaded.authoring.compatibleRuntimes.length).toBeGreaterThan(0);
    expect(loaded.registry.blocks.length).toBeGreaterThan(0);
    expect((loaded.runtimeIntents ?? []).length).toBeGreaterThan(0);
  });

  test('layout-only changes do not mutate the semantic graph (GUI drag-and-drop safety)', async () => {
    const projectDir = await buildWrittenProject('gui-shell-layout');
    const loaded = await loadHarnessProject(projectDir);

    const shifted = {
      ...loaded,
      layout: loaded.layout.map((position: LayoutNode) => ({ ...position, x: position.x + 42, y: position.y + 17 }))
    };
    await writeHarnessProject(projectDir, shifted);
    const reloaded = await loadHarnessProject(projectDir);

    expect(reloaded.nodes).toEqual(loaded.nodes);
    expect(reloaded.edges).toEqual(loaded.edges);
    expect(reloaded.layout).not.toEqual(loaded.layout);
    expect(reloaded.layout.length).toBe(loaded.layout.length);
  });

  test('viewer HTML exposes editor controls or bootstraps the React editor shell', async () => {
    const projectDir = await buildWrittenProject('gui-shell-editor-controls');
    const handle = await startHarnessEditorServer({ projectDir, host: '127.0.0.1' });
    try {
      const html = await fetch(handle.url).then((res) => res.text());
      expect(html).toContain('Harness Editor');
      if (html.includes('id="root"')) {
        const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
        expect(asset).toBeDefined();
        const script = await fetch(`${handle.url}${asset}`).then((res) => res.text());
        expect(script).toContain('Save node');
        expect(script).toContain('/api/project/mutate');
        expect(script).toContain('/api/project/skill');
        expect(script).toContain('/api/trace/stream');
        expect(script).toContain('Rerun sandbox');
      } else {
        expect(html).toContain('Save node');
        expect(html).toContain('/api/project/mutate');
        expect(html).toContain('Mutation token');
      }
    } finally {
      await handle.close();
    }
  });
});

describe('GUI shell contract: runtime trace and error surfaces', () => {
  test('sandbox trace events carry every field a GUI trace panel needs to render rows', async () => {
    const projectDir = await buildWrittenProject('gui-shell-trace');
    const project = await loadHarnessProject(projectDir);
    const result = await validateProject(projectDir);

    expect(result.success).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    const nodeIds = new Set(project.nodes.map((node) => node.id));

    for (const event of result.events as TraceEvent[]) {
      expect(typeof event.timestamp).toBe('string');
      expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
      expect(typeof event.hook).toBe('string');
      expect(typeof event.nodeId).toBe('string');
      expect(typeof event.message).toBe('string');
      expect(['ok', 'error']).toContain(event.status);
      expect([
        'hook-activation',
        'branch-selection',
        'state-transition',
        'loop-iteration',
        'custom-block',
        'failure',
        'mcp-server'
      ]).toContain(event.eventType);
      expect(nodeIds.has(event.nodeId)).toBe(true);
      expect(event.metadata?.graphHash).toBe(project.manifest.graphHash);
      expect(typeof event.metadata?.runtime).toBe('string');
    }

    const html = await readFile(result.htmlReport, 'utf8');
    expect(html).toContain('Runtime Trace');
    expect(html).toContain('Event Type');
    expect(html).toContain('Total events');
  });

  test('forced failure exposes an error event the GUI can highlight', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-gui-shell-fail-'));
    const projectDir = join(root, 'gui-shell-fail');
    const project = applyRiskConfirmations(generateHarnessProject('gui-shell-fail', 'Create a harness __FORCE_SANDBOX_FAILURE__'), true);
    await writeHarnessProject(projectDir, project);

    const result = await validateProject(projectDir, { failHook: 'UserPromptSubmit' });
    expect(result.success).toBe(false);
    expect(result.failure).toBeDefined();
    expect(result.failure?.status).toBe('error');
    expect(result.events.some((event) => event.status === 'error')).toBe(true);

    const html = await readFile(result.htmlReport, 'utf8');
    expect(html).toContain('is-error');
    expect(html).toContain('Error events');
    expect(html).toContain('Hook command failed');
  });

  test('project persistence records a graph hash the trace layer can compare against', async () => {
    const projectDir = await buildWrittenProject('gui-shell-graph-hash');
    const loaded = await loadHarnessProject(projectDir);
    expect(typeof loaded.manifest.graphHash).toBe('string');
    expect(loaded.manifest.graphHash?.length).toBeGreaterThan(0);
  });

  test('renderTraceHtml escapes user-controlled trace data (GUI XSS guard)', () => {
    const hostile: TraceEvent[] = [
      {
        timestamp: '2026-04-21T00:00:00.000Z',
        hook: 'PreToolUse',
        nodeId: 'node-<script>',
        status: 'error',
        message: '<img src=x onerror=alert(1)>',
        eventType: 'failure',
        metadata: { payload: '"><svg/onload=alert(2)>' }
      }
    ];
    const html = renderTraceHtml('<danger>', hostile);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<svg/onload=alert(2)>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;danger&gt;');
  });
});

describe('GUI shell contract: Phase 0 CLI/compiler/sandbox loop still works', () => {
  test('new -> load -> compile -> sandbox round-trips without manual edits', async () => {
    const projectDir = await buildWrittenProject('gui-shell-phase0-loop');

    const loaded = await loadHarnessProject(projectDir);
    expect(loaded.authoring.confirmationRequests.every((request) => request.confirmed)).toBe(true);

    const compileOut = join(projectDir, 'compiler', 'claude-code');
    const compileResult = await compileClaude(loaded, compileOut);
    expect(compileResult.generatedFiles.length).toBeGreaterThan(0);
    expect(compileResult.pluginRoot.startsWith(compileOut)).toBe(true);

    const pluginJson = JSON.parse(await readFile(join(compileResult.pluginRoot, 'plugin.json'), 'utf8')) as { hooks: string; skills: string };
    expect(pluginJson.hooks).toBe('./hooks/hooks.json');
    expect(pluginJson.skills).toBe('./skills');

    const sandboxResult = await validateProject(projectDir);
    expect(sandboxResult.success).toBe(true);
    expect(sandboxResult.events.length).toBeGreaterThan(0);
    expect(sandboxResult.events.some((event) => event.eventType === 'hook-activation')).toBe(true);
  });
});
