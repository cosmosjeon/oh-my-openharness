import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRiskConfirmations, generateHarnessProject } from '../src/core/generator';
import { applyHostAuthoring } from '../src/core/host-authoring';
import { writeHarnessProject } from '../src/core/project';
import { startHarnessEditorServer, type ServerHandle } from '../src/web/server';

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function mutationInit(handle: ServerHandle, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('x-omoh-api-token', handle.apiToken);
  return { ...init, headers };
}

async function setupProject(): Promise<{ projectDir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-server-'));
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

describe('oh-my-openharness local server', () => {
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
    expect(html).toContain('Harness Editor');
    expect(html.includes('server-fixture') || html.includes('id="root"')).toBe(true);
    expect(html.includes('/api/project') || html.includes('/assets/')).toBe(true);
  });

  test('serves catalog, compatibility, and empty Factory state API payloads', async () => {
    const catalog = await fetchJson(`${handle!.url}/api/catalog`);
    expect(catalog.status).toBe(200);
    expect((catalog.body as { blocks: unknown[]; composites: unknown[] }).blocks.length).toBeGreaterThan(0);
    expect((catalog.body as { blocks: unknown[]; composites: unknown[] }).composites.length).toBeGreaterThan(0);

    const compatibility = await fetchJson(`${handle!.url}/api/compatibility`);
    expect(compatibility.status).toBe(200);
    const compatibilityPayload = compatibility.body as { targetRuntime: string; nodes: Array<{ id: string; compatibleRuntimes: string[] }> };
    expect(compatibilityPayload.targetRuntime).toBe('claude-code');
    expect(compatibilityPayload.nodes.length).toBeGreaterThan(0);

    const factoryState = await fetchJson(`${handle!.url}/api/factory/state?sessionId=missing`);
    expect(factoryState.status).toBe(200);
    expect(factoryState.body).toMatchObject({ configured: false, sessionId: 'missing' });
  });

  test('reports no trace when sandbox has not run', async () => {
    const { status, body } = await fetchJson(`${handle!.url}/api/trace`);
    expect(status).toBe(200);
    const payload = body as { source: string; events: unknown[] };
    expect(payload.source).toBe('none');
    expect(payload.events).toEqual([]);
  });

  test('reports server health separately from project payloads', async () => {
    const { status, body } = await fetchJson(`${handle!.url}/api/health`);
    expect(status).toBe(200);
    const payload = body as { ok: boolean; mutationProtection: string; projectDir?: string };
    expect(payload.ok).toBe(true);
    expect(payload.mutationProtection).toBe('token+same-origin');
    expect(payload.projectDir).toBeUndefined();
  });

  test('reads trace events produced by sandbox runs', async () => {
    const tracePath = join(fixture!.projectDir, 'trace.jsonl');
    const manifest = JSON.parse(await readFile(join(fixture!.projectDir, 'harness.json'), 'utf8')) as { graphHash: string };
    const now = new Date().toISOString();
    await writeFile(
      tracePath,
      [
        JSON.stringify({ timestamp: now, eventType: 'hook-activation', hook: 'SessionStart', nodeId: 'sessionstart-1', status: 'ok', message: 'ready', metadata: { graphHash: manifest.graphHash, runtime: 'claude-code' } }),
        JSON.stringify({ timestamp: now, eventType: 'failure', hook: 'PreToolUse', nodeId: 'pretooluse-5', status: 'error', message: 'forced failure', metadata: { graphHash: manifest.graphHash, runtime: 'claude-code' } })
      ].join('\n')
    );
    const { status, body } = await fetchJson(`${handle!.url}/api/trace`);
    expect(status).toBe(200);
    const payload = body as { source: string; path: string; staleTrace: boolean; events: Array<{ status: string; nodeId: string }> };
    expect(payload.source).toBe('trace-file');
    expect(payload.path).toBe(tracePath);
    expect(payload.staleTrace).toBe(false);
    expect(payload.events.length).toBe(2);
    expect(payload.events[1].status).toBe('error');
  });

  test('marks trace payload stale when graph hash no longer matches the canonical project', async () => {
    const tracePath = join(fixture!.projectDir, 'trace.jsonl');
    const now = new Date().toISOString();
    await writeFile(
      tracePath,
      JSON.stringify({ timestamp: now, eventType: 'hook-activation', hook: 'SessionStart', nodeId: 'sessionstart-1', status: 'ok', message: 'ready', metadata: { graphHash: 'stale-graph-hash', runtime: 'claude-code' } })
    );
    const { status, body } = await fetchJson(`${handle!.url}/api/trace`);
    expect(status).toBe(200);
    const payload = body as { staleTrace: boolean; observedGraphHash: string | null; expectedGraphHash: string };
    expect(payload.staleTrace).toBe(true);
    expect(payload.observedGraphHash).toBe('stale-graph-hash');
    expect(typeof payload.expectedGraphHash).toBe('string');
  });

  test('localizes trace failures for debugger panels', async () => {
    const tracePath = join(fixture!.projectDir, 'trace.jsonl');
    const project = await fetchJson(`${handle!.url}/api/project`);
    const firstNode = (project.body as { nodes: Array<{ id: string }>; manifest: { graphHash: string } }).nodes[0]!;
    const graphHash = (project.body as { manifest: { graphHash: string } }).manifest.graphHash;
    await writeFile(
      tracePath,
      JSON.stringify({ timestamp: new Date().toISOString(), eventType: 'failure', hook: 'UserPromptSubmit', nodeId: firstNode.id, status: 'error', message: 'localized failure', metadata: { graphHash, runtime: 'claude-code', details: '<unsafe>' } })
    );

    const { status, body } = await fetchJson(`${handle!.url}/api/trace`);
    expect(status).toBe(200);
    const payload = body as { failure: { hook: string; nodeId: string; message: string; likelyAction: string } };
    expect(payload.failure.nodeId).toBe(firstNode.id);
    expect(payload.failure.hook).toBe('UserPromptSubmit');
    expect(payload.failure.message).toBe('localized failure');
    expect(payload.failure.likelyAction).toContain('rerun sandbox verification');
  });

  test('persists layout updates without mutating other files', async () => {
    const { body } = await fetchJson(`${handle!.url}/api/project`);
    const payload = body as { nodes: Array<{ id: string }>; layout: Array<{ id: string; x: number; y: number }> };
    const first = payload.layout[0];
    const updated = [{ id: first.id, x: 999, y: 42 }];
    const { status, body: response } = await fetchJson(`${handle!.url}/api/layout`, mutationInit(handle!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: updated })
    }));
    expect(status).toBe(200);
    const saved = (response as { layout: Array<{ id: string; x: number; y: number }> }).layout;
    expect(saved.find((item) => item.id === first.id)).toEqual({ id: first.id, x: 999, y: 42 });

    const reloadedLayout = JSON.parse(await readFile(join(fixture!.projectDir, 'layout.json'), 'utf8')) as Array<{ id: string; x: number; y: number }>;
    expect(reloadedLayout.find((item) => item.id === first.id)).toEqual({ id: first.id, x: 999, y: 42 });
    expect(reloadedLayout.length).toBe(payload.layout.length);

    const manifest = JSON.parse(await readFile(join(fixture!.projectDir, 'harness.json'), 'utf8')) as { name: string };
    expect(manifest.name).toBe('server-fixture');
  });

  test('mutates the canonical graph through the editor endpoint', async () => {
    const addNode = await fetchJson(`${handle!.url}/api/project/mutate`, mutationInit(handle!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-node', kind: 'Condition', label: 'Editor-added condition', x: 320, y: 140 })
    }));
    expect(addNode.status).toBe(200);
    const addedPayload = addNode.body as { nodes: Array<{ id: string; label: string }>; edges: Array<{ id: string; from: string; to: string }> };
    const addedNode = addedPayload.nodes.find((node) => node.label === 'Editor-added condition');
    expect(addedNode).toBeDefined();

    const addEdge = await fetchJson(`${handle!.url}/api/project/mutate`, mutationInit(handle!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-edge', from: addedNode!.id, to: addedPayload.nodes[0]!.id, label: 'editor-link' })
    }));
    expect(addEdge.status).toBe(200);
    const edgePayload = addEdge.body as { edges: Array<{ id: string; label?: string }> };
    expect(edgePayload.edges.some((edge) => edge.label === 'editor-link')).toBe(true);

    const deleteNode = await fetchJson(`${handle!.url}/api/project/mutate`, mutationInit(handle!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete-node', nodeId: addedNode!.id })
    }));
    expect(deleteNode.status).toBe(200);
    const deletePayload = deleteNode.body as { nodes: Array<{ id: string }> };
    expect(deletePayload.nodes.some((node) => node.id === addedNode!.id)).toBe(false);
  });

  test('updates skill markdown through the inspector endpoint', async () => {
    const projectBefore = await fetchJson(`${handle!.url}/api/project`);
    const skill = (projectBefore.body as { skills: Array<{ id: string; name: string; content: string; path?: string }> }).skills[0]!;
    const nextContent = `${skill.content}\n\n## Inspector note\nSaved from React inspector.`;

    const update = await fetchJson(`${handle!.url}/api/project/skill`, mutationInit(handle!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: skill.id, content: nextContent })
    }));

    expect(update.status).toBe(200);
    const updatedSkill = (update.body as { skills: Array<{ id: string; content: string }> }).skills.find((entry) => entry.id === skill.id);
    expect(updatedSkill?.content).toContain('Inspector note');
    const persisted = await readFile(join(fixture!.projectDir, 'skills', skill.path ?? `${skill.name}.md`), 'utf8');
    expect(persisted).toContain('Inspector note');
  });

  test('Factory chat endpoint routes prompts into interview state', async () => {
    const result = await fetchJson(`${handle!.url}/api/factory/chat`, mutationInit(handle!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'server-chat', text: 'Build a Claude harness with approval and MCP support' })
    }));

    expect(result.status).toBe(200);
    const payload = result.body as { ok: boolean; route: string; state: { sessionId: string; stage: string; openQuestions: unknown[] } };
    expect(payload.ok).toBe(true);
    expect(payload.state.sessionId).toBe('server-chat');
    expect(['ask-question', 'draft', 'build']).toContain(payload.route);
    expect(payload.state.openQuestions.length).toBeGreaterThanOrEqual(0);
  });

  test('editor mutations preserve confirmed gates and host-authored guidance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-server-authoring-'));
    const projectDir = join(root, 'server-authoring');
    const project = applyHostAuthoring(
      applyRiskConfirmations(generateHarnessProject('server-authoring', 'Create a harness with full access and review loop', 'codex'), true),
      {
        runtime: 'codex',
        summary: 'Codex-guided authoring summary',
        emphasis: ['state', 'review'],
        warnings: ['Host runtime returned a compact plan'],
        rawOutput: '{"summary":"Codex-guided authoring summary","emphasis":["state","review"],"warnings":["Host runtime returned a compact plan"]}',
        command: 'codex exec <prompt>'
      }
    );
    await writeHarnessProject(projectDir, project);

    const authoringHandle = await startHarnessEditorServer({ projectDir, host: '127.0.0.1' });
    try {
      const mutation = await fetchJson(`${authoringHandle.url}/api/project/mutate`, mutationInit(authoringHandle, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-node', kind: 'Condition', label: 'Editor-added condition', x: 320, y: 140 })
      }));

      expect(mutation.status).toBe(200);
      const payload = mutation.body as {
        authoring: {
          summary: string;
          warnings: string[];
          confirmationRequests: Array<{ confirmed: boolean }>;
        };
      };
      expect(payload.authoring.summary).toBe('Codex-guided authoring summary');
      expect(payload.authoring.warnings).toContain('Host runtime returned a compact plan');
      expect(payload.authoring.confirmationRequests.length).toBeGreaterThan(0);
      expect(payload.authoring.confirmationRequests.every((request) => request.confirmed)).toBe(true);
    } finally {
      await authoringHandle.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects malformed layout payloads', async () => {
    const { status, body } = await fetchJson(`${handle!.url}/api/layout`, mutationInit(handle!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: [{ id: 42, x: 'left', y: 0 }] })
    }));
    expect(status).toBe(400);
    expect((body as { error: string }).error).toContain('LayoutNode');
  });

  test('returns 404 for unknown routes', async () => {
    const res = await fetch(`${handle!.url}/api/does-not-exist`);
    expect(res.status).toBe(404);
  });
});
