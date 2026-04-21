import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRiskConfirmations, generateHarnessProject } from '../src/core/generator';
import { writeHarnessProject } from '../src/core/project';
import { startHarnessEditorServer, type ServerHandle } from '../src/web/server';

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function setupProject(): Promise<{ projectDir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'harness-editor-server-'));
  const projectDir = join(root, 'server-fixture');
  const project = applyRiskConfirmations(generateHarnessProject('server-fixture', 'Create a basic harness with review loop and mcp server'), true);
  await writeHarnessProject(projectDir, project);
  return {
    projectDir,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

describe('harness-editor local server', () => {
  let fixture: { projectDir: string; cleanup: () => Promise<void> } | null = null;
  let handle: ServerHandle | null = null;

  beforeEach(async () => {
    fixture = await setupProject();
    handle = await startHarnessEditorServer({ projectDir: fixture.projectDir, host: '127.0.0.1' });
  });

  afterEach(async () => {
    if (handle) await handle.close();
    if (fixture) await fixture.cleanup();
    handle = null;
    fixture = null;
  });

  test('serves the canonical project over GET /api/project', async () => {
    const { status, body } = await fetchJson(`${handle!.url}/api/project`);
    expect(status).toBe(200);
    const payload = body as {
      manifest: { name: string; targetRuntime: string };
      nodes: Array<{ id: string; kind: string }>;
      edges: Array<{ from: string; to: string }>;
      layout: Array<{ id: string; x: number; y: number }>;
      registry: { blocks: unknown[]; composites: unknown[] };
    };
    expect(payload.manifest.name).toBe('server-fixture');
    expect(payload.manifest.targetRuntime).toBe('claude-code');
    expect(payload.nodes.length).toBeGreaterThan(0);
    expect(payload.edges.length).toBeGreaterThan(0);
    expect(payload.layout.length).toBe(payload.nodes.length);
    expect(payload.registry.blocks.length).toBeGreaterThan(0);
  });

  test('serves the viewer HTML at /', async () => {
    const res = await fetch(`${handle!.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
    const html = await res.text();
    expect(html).toContain('server-fixture');
    expect(html).toContain('/api/project');
    expect(html).toContain('/api/trace');
  });

  test('reports no trace when sandbox has not run', async () => {
    const { status, body } = await fetchJson(`${handle!.url}/api/trace`);
    expect(status).toBe(200);
    const payload = body as { source: string; events: unknown[] };
    expect(payload.source).toBe('none');
    expect(payload.events).toEqual([]);
  });

  test('reads trace events produced by sandbox runs', async () => {
    const tracePath = join(fixture!.projectDir, 'trace.jsonl');
    const now = new Date().toISOString();
    await writeFile(
      tracePath,
      [
        JSON.stringify({ timestamp: now, eventType: 'hook-activation', hook: 'SessionStart', nodeId: 'session-start-1', status: 'ok', message: 'ready' }),
        JSON.stringify({ timestamp: now, eventType: 'failure', hook: 'PreToolUse', nodeId: 'pre-tool-use-5', status: 'error', message: 'forced failure' })
      ].join('\n')
    );
    const { status, body } = await fetchJson(`${handle!.url}/api/trace`);
    expect(status).toBe(200);
    const payload = body as { source: string; path: string; events: Array<{ status: string; nodeId: string }> };
    expect(payload.source).toBe('trace-file');
    expect(payload.path).toBe(tracePath);
    expect(payload.events.length).toBe(2);
    expect(payload.events[1].status).toBe('error');
  });

  test('persists layout updates without mutating other files', async () => {
    const { body } = await fetchJson(`${handle!.url}/api/project`);
    const payload = body as { nodes: Array<{ id: string }>; layout: Array<{ id: string; x: number; y: number }> };
    const first = payload.layout[0];
    const updated = [{ id: first.id, x: 999, y: 42 }];
    const { status, body: response } = await fetchJson(`${handle!.url}/api/layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: updated })
    });
    expect(status).toBe(200);
    const saved = (response as { layout: Array<{ id: string; x: number; y: number }> }).layout;
    expect(saved.find((item) => item.id === first.id)).toEqual({ id: first.id, x: 999, y: 42 });

    const reloadedLayout = JSON.parse(await readFile(join(fixture!.projectDir, 'layout.json'), 'utf8')) as Array<{ id: string; x: number; y: number }>;
    expect(reloadedLayout.find((item) => item.id === first.id)).toEqual({ id: first.id, x: 999, y: 42 });
    expect(reloadedLayout.length).toBe(payload.layout.length);

    const manifest = JSON.parse(await readFile(join(fixture!.projectDir, 'harness.json'), 'utf8')) as { name: string };
    expect(manifest.name).toBe('server-fixture');
  });

  test('rejects malformed layout payloads', async () => {
    const { status, body } = await fetchJson(`${handle!.url}/api/layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: [{ id: 42, x: 'left', y: 0 }] })
    });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toContain('LayoutNode');
  });

  test('returns 404 for unknown routes', async () => {
    const res = await fetch(`${handle!.url}/api/does-not-exist`);
    expect(res.status).toBe(404);
  });
});
