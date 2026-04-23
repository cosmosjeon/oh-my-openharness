import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
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
  const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-server-auth-'));
  const projectDir = join(root, 'server-auth-fixture');
  const project = applyRiskConfirmations(generateHarnessProject('server-auth-fixture', 'Create a basic harness with review loop and mcp server'), true);
  await writeHarnessProject(projectDir, project);
  return {
    projectDir,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function mutationInit(handle: ServerHandle, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('x-omoh-api-token', handle.apiToken);
  return { ...init, headers };
}

describe('oh-my-openharness server mutation auth', () => {
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

  test('generates an API token for mutating requests', () => {
    expect(handle?.apiToken).toBeDefined();
    expect(handle!.apiToken.length).toBeGreaterThan(20);
  });

  test('rejects mutations without an API token', async () => {
    const { status, body } = await fetchJson(`${handle!.url}/api/project/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-node', kind: 'Condition', label: 'Missing token' })
    });

    expect(status).toBe(401);
    expect((body as { error: string }).error).toContain('x-omoh-api-token');
  });

  test('rejects mutations with the wrong API token', async () => {
    const { status } = await fetchJson(`${handle!.url}/api/layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-omoh-api-token': 'wrong-token' },
      body: JSON.stringify({ layout: [] })
    });

    expect(status).toBe(401);
  });

  test('rejects cross-origin browser writes even with a valid API token', async () => {
    const { status, body } = await fetchJson(`${handle!.url}/api/project/mutate`, mutationInit(handle!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ action: 'add-node', kind: 'Condition', label: 'Cross origin' })
    }));

    expect(status).toBe(403);
    expect((body as { error: string }).error).toContain('same origin');
  });

  test('accepts same-origin browser writes with a valid API token', async () => {
    const { status, body } = await fetchJson(`${handle!.url}/api/project/mutate`, mutationInit(handle!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: handle!.url },
      body: JSON.stringify({ action: 'add-node', kind: 'Condition', label: 'Same origin write' })
    }));

    expect(status).toBe(200);
    const payload = body as { nodes: Array<{ label: string }> };
    expect(payload.nodes.some((node) => node.label === 'Same origin write')).toBe(true);
  });
});
