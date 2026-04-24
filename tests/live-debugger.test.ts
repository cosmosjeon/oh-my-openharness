import { afterEach, beforeEach, describe, expect, test as bunTest } from 'bun:test';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyRiskConfirmations, generateHarnessProject } from '../src/core/generator';
import { loadHarnessProject, writeHarnessProject } from '../src/core/project';
import type { TraceEvent } from '../src/core/types';
import { validateProject } from '../src/sandbox/validate';
import { startTracePollingFallback } from '../src/web/client/trace-stream';
import { escapeTraceText, projectPayloadFromHarness, reduceTracePayload, type TracePayload } from '../src/web/client/trace';
import { startHarnessEditorServer, type ServerHandle } from '../src/web/server';

const test = (name: string, fn: Parameters<typeof bunTest>[1]) => bunTest(name, fn, 120_000);

function now() {
  return new Date().toISOString();
}

async function setupProject(name = 'live-debugger'): Promise<{ root: string; projectDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-live-debugger-'));
  const projectDir = join(root, name);
  const project = applyRiskConfirmations(generateHarnessProject(name, 'Create a harness with approval flow, mcp server, state memory, and review loop'), true);
  await writeHarnessProject(projectDir, project);
  return { root, projectDir };
}

function eventFor(nodeId: string, graphHash: string, overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    timestamp: now(),
    eventType: 'hook-activation',
    hook: 'SessionStart',
    nodeId,
    status: 'ok',
    message: `event for ${nodeId}`,
    metadata: { graphHash, runtime: 'claude-code' },
    ...overrides
  };
}

async function writeTrace(path: string, events: TraceEvent[]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
}

async function appendTrace(path: string, event: TraceEvent) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(event) + '\n');
}

function mutationInit(handle: ServerHandle, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('x-omoh-api-token', handle.apiToken);
  headers.set('Content-Type', 'application/json');
  return { ...init, headers };
}

function createSseReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  async function nextFrame(timeoutMs = 5_000): Promise<{ event: string; data: unknown }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const separator = buffer.indexOf('\n\n');
      if (separator >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const event = frame.match(/^event: (.+)$/m)?.[1] ?? 'message';
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice('data: '.length))
          .join('\n');
        return { event, data: data ? JSON.parse(data) : null };
      }
      const remaining = Math.max(1, deadline - Date.now());
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for SSE frame')), remaining));
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) throw new Error('SSE stream ended before a frame arrived');
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    throw new Error('Timed out waiting for SSE frame');
  }

  return { nextFrame, cancel: () => reader.cancel().catch(() => undefined) };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('Timed out waiting for condition');
}

describe('Live sandbox debugger trace reducer', () => {
  test('trace event reducer marks ok nodes active and error nodes failed', async () => {
    const { root, projectDir } = await setupProject('trace-reducer');
    try {
      const project = await loadHarnessProject(projectDir);
      const payload = projectPayloadFromHarness(project);
      const first = project.nodes[0]!;
      const second = project.nodes[1]!;
      const state = reduceTracePayload(payload, {
        source: 'trace-file',
        path: 'trace.jsonl',
        events: [
          eventFor(first.id, project.manifest.graphHash!),
          eventFor(second.id, project.manifest.graphHash!, { eventType: 'failure', status: 'error', hook: 'UserPromptSubmit', message: '<img src=x onerror=alert(1)>' })
        ],
        staleTrace: false,
        observedGraphHash: project.manifest.graphHash!,
        expectedGraphHash: project.manifest.graphHash!
      });

      expect(state.activeNodeIds).toContain(first.id);
      expect(state.failedNodeIds).toContain(second.id);
      expect(state.latestFailure?.nodeId).toBe(second.id);
      expect(escapeTraceText(state.latestFailure?.message)).not.toContain('<img');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('edge highlighting follows consecutive graph events', async () => {
    const { root, projectDir } = await setupProject('trace-edge-highlight');
    try {
      const project = await loadHarnessProject(projectDir);
      const edge = project.edges[0]!;
      const state = reduceTracePayload(projectPayloadFromHarness(project), {
        source: 'trace-file',
        path: 'trace.jsonl',
        events: [eventFor(edge.from, project.manifest.graphHash!), eventFor(edge.to, project.manifest.graphHash!, { hook: 'UserPromptSubmit' })]
      });

      expect(state.highlightedEdgeIds).toContain(edge.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('MCP server trace events map to the canonical MCP node', async () => {
    const { root, projectDir } = await setupProject('trace-mcp-highlight');
    try {
      const project = await loadHarnessProject(projectDir);
      const mcpNode = project.nodes.find((node) => node.kind === 'MCPServer')!;
      const state = reduceTracePayload(projectPayloadFromHarness(project), {
        source: 'trace-file',
        path: 'trace.jsonl',
        events: [eventFor(mcpNode.id, project.manifest.graphHash!, { eventType: 'mcp-server', hook: 'MCPServer' })]
      });

      expect(state.activeNodeIds).toContain(mcpNode.id);
      expect(state.unmappedEvents).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('stale trace warning clears after a matching graph hash payload arrives', async () => {
    const { root, projectDir } = await setupProject('trace-stale-clear');
    try {
      const project = await loadHarnessProject(projectDir);
      const payload = projectPayloadFromHarness(project);
      const stale = reduceTracePayload(payload, {
        source: 'trace-file',
        path: 'trace.jsonl',
        events: [eventFor(project.nodes[0]!.id, 'old-graph-hash')],
        staleTrace: true,
        observedGraphHash: 'old-graph-hash',
        expectedGraphHash: project.manifest.graphHash!
      });
      const fresh = reduceTracePayload(payload, {
        source: 'trace-file',
        path: 'trace.jsonl',
        events: [eventFor(project.nodes[0]!.id, project.manifest.graphHash!)],
        staleTrace: true,
        observedGraphHash: project.manifest.graphHash!,
        expectedGraphHash: project.manifest.graphHash!
      });

      expect(stale.staleTrace).toBe(true);
      expect(fresh.staleTrace).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('polling fallback keeps refreshing trace after stream failure', async () => {
    const originalSetInterval = globalThis.window?.setInterval;
    const originalClearInterval = globalThis.window?.clearInterval;
    const originalFetch = globalThis.fetch;
    const intervals: TimerHandler[] = [];
    const payloads: TracePayload[] = [];
    const errors: Error[] = [];
    const fallbackPayload: TracePayload = { source: 'none', path: null, events: [] };

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setInterval: (handler: TimerHandler) => {
          intervals.push(handler);
          return 1;
        },
        clearInterval: () => undefined
      }
    });
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(fallbackPayload), { status: 200, headers: { 'Content-Type': 'application/json' } }))) as unknown as typeof fetch;

    try {
      const stop = startTracePollingFallback({ pollMs: 10, onTrace: (payload) => payloads.push(payload), onError: (error) => errors.push(error) });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      expect(payloads.length).toBe(1);
      expect(intervals.length).toBe(1);

      (intervals[0] as () => void)();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      expect(payloads.length).toBe(2);
      expect(errors).toEqual([]);

      stop();
    } finally {
      if (originalSetInterval || originalClearInterval) {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: {
            setInterval: originalSetInterval,
            clearInterval: originalClearInterval
          }
        });
      } else {
        delete (globalThis as { window?: unknown }).window;
      }
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Live sandbox debugger stream and rerun API', () => {
  let fixture: { root: string; projectDir: string } | null = null;
  let handle: ServerHandle | null = null;

  beforeEach(async () => {
    fixture = await setupProject('trace-stream');
    handle = await startHarnessEditorServer({ projectDir: fixture.projectDir, host: '127.0.0.1' });
  }, 120_000);

  afterEach(async () => {
    if (handle) await handle.close();
    if (fixture) await rm(fixture.root, { recursive: true, force: true });
    handle = null;
    fixture = null;
  }, 120_000);

  test('trace stream emits existing trace events before waiting for appends', async () => {
    const project = await loadHarnessProject(fixture!.projectDir);
    const tracePath = join(fixture!.projectDir, 'trace.jsonl');
    await writeTrace(tracePath, [eventFor(project.nodes[0]!.id, project.manifest.graphHash!)]);

    const controller = new AbortController();
    const response = await fetch(`${handle!.url}/api/trace/stream`, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toContain('text/event-stream');
    const stream = createSseReader(response.body!);
    try {
      const frame = await stream.nextFrame();
      expect(frame.event).toBe('trace');
      const payload = frame.data as TracePayload;
      expect(payload.events.length).toBe(1);
      expect(payload.events[0]!.nodeId).toBe(project.nodes[0]!.id);
    } finally {
      controller.abort();
      await stream.cancel();
    }
  });

  test('appending a trace event sends one live update without manual refresh', async () => {
    const project = await loadHarnessProject(fixture!.projectDir);
    const tracePath = join(fixture!.projectDir, 'trace.jsonl');
    await writeTrace(tracePath, []);

    const controller = new AbortController();
    const response = await fetch(`${handle!.url}/api/trace/stream`, { signal: controller.signal });
    const stream = createSseReader(response.body!);
    try {
      const initial = await stream.nextFrame();
      expect((initial.data as TracePayload).events.length).toBe(0);
      await appendTrace(tracePath, eventFor(project.nodes[0]!.id, project.manifest.graphHash!, { hook: 'UserPromptSubmit' }));
      const update = await stream.nextFrame();
      expect(update.event).toBe('trace');
      expect((update.data as TracePayload).events.at(-1)?.hook).toBe('UserPromptSubmit');
    } finally {
      controller.abort();
      await stream.cancel();
    }
  });

  test('trace stream disconnect cleanup removes stream clients', async () => {
    const controller = new AbortController();
    const response = await fetch(`${handle!.url}/api/trace/stream`, { signal: controller.signal });
    const stream = createSseReader(response.body!);
    await stream.nextFrame();
    expect(handle!.debug.traceStreamClients()).toBe(1);

    controller.abort();
    await stream.cancel();
    await waitFor(() => handle!.debug.traceStreamClients() === 0);
  });

  test('bounded rerun rewrites trace with current graph hash and clears stale warning', async () => {
    const project = await loadHarnessProject(fixture!.projectDir);
    const tracePath = join(fixture!.projectDir, 'trace.jsonl');
    await writeTrace(tracePath, [eventFor(project.nodes[0]!.id, 'stale-graph-hash')]);

    const stale = await fetch(`${handle!.url}/api/trace`).then((res) => res.json()) as TracePayload;
    expect(stale.staleTrace).toBe(true);

    const response = await fetch(`${handle!.url}/api/sandbox/rerun`, mutationInit(handle!, { method: 'POST', body: '{}' }));
    expect(response.status).toBe(200);
    const rerun = await response.json() as { ok: boolean; mode: string; hotReload: boolean; trace: TracePayload };
    expect(rerun.ok).toBe(true);
    expect(rerun.mode).toBe('bounded-rerun');
    expect(rerun.hotReload).toBe(false);
    expect(rerun.trace.staleTrace).toBe(false);
    expect(rerun.trace.observedGraphHash).toBe(project.manifest.graphHash!);
  });

  test('real Claude proof reports a blocker by default instead of claiming synthetic replay is enough', async () => {
    const previous = process.env.HARNESS_REAL_CLAUDE_PROOF;
    delete process.env.HARNESS_REAL_CLAUDE_PROOF;
    try {
      const response = await fetch(`${handle!.url}/api/sandbox/claude-proof`);
      expect(response.status).toBe(409);
      const proof = await response.json() as { ok: boolean; status: string; reason: string };
      expect(proof.ok).toBe(false);
      expect(proof.status).toBe('blocked');
      expect(proof.reason).toContain('V1 100% cannot be claimed from synthetic replay alone');
    } finally {
      if (previous === undefined) delete process.env.HARNESS_REAL_CLAUDE_PROOF;
      else process.env.HARNESS_REAL_CLAUDE_PROOF = previous;
    }
  });
});

describe('Live sandbox debugger failure localization from sandbox output', () => {
  test('forced sandbox failure localizes the failing canonical graph node', async () => {
    const { root, projectDir } = await setupProject('trace-localized-failure');
    try {
      const project = await loadHarnessProject(projectDir);
      const result = await validateProject(projectDir, { failHook: 'UserPromptSubmit' });
      const nodeIds = new Set(project.nodes.map((node) => node.id));
      const failure = [...result.events].reverse().find((event) => event.status === 'error' && nodeIds.has(event.nodeId));

      expect(result.success).toBe(false);
      expect(failure?.hook).toBe('UserPromptSubmit');
      expect(failure?.eventType).toBe('failure');
      expect(nodeIds.has(failure!.nodeId)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
