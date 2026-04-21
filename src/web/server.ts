import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadHarnessProject } from '../core/project';
import type { HarnessProject, LayoutNode, TraceEvent } from '../core/types';
import { renderViewerHtml } from './viewer';

export interface ServerOptions {
  projectDir: string;
  port?: number;
  host?: string;
  tracePath?: string;
}

export interface ServerHandle {
  url: string;
  port: number;
  host: string;
  close(): Promise<void>;
}

interface ProjectPayload {
  manifest: HarnessProject['manifest'];
  nodes: HarnessProject['nodes'];
  edges: HarnessProject['edges'];
  layout: HarnessProject['layout'];
  composites: HarnessProject['composites'];
  customBlocks: HarnessProject['customBlocks'];
  registry: HarnessProject['registry'];
  authoring: HarnessProject['authoring'];
  runtimeIntents: HarnessProject['runtimeIntents'];
}

interface TracePayload {
  source: 'trace-file' | 'sandbox-report' | 'none';
  path: string | null;
  events: TraceEvent[];
  error?: string;
}

async function readTraceFile(path: string): Promise<TraceEvent[]> {
  const raw = await readFile(path, 'utf8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEvent);
}

export async function loadTracePayload(projectDir: string, explicitPath?: string): Promise<TracePayload> {
  const candidates = [
    explicitPath,
    join(projectDir, 'trace.jsonl'),
    join(projectDir, 'compiler', 'claude-code', 'trace.jsonl'),
    join(projectDir, 'sandbox', 'trace.jsonl')
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const events = await readTraceFile(candidate);
      return { source: 'trace-file', path: candidate, events };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { source: 'trace-file', path: candidate, events: [], error: (error as Error).message };
      }
    }
  }

  return { source: 'none', path: null, events: [] };
}

function toProjectPayload(project: HarnessProject): ProjectPayload {
  return {
    manifest: project.manifest,
    nodes: project.nodes,
    edges: project.edges,
    layout: project.layout,
    composites: project.composites,
    customBlocks: project.customBlocks,
    registry: project.registry,
    authoring: project.authoring,
    runtimeIntents: project.runtimeIntents ?? []
  };
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function sendNotFound(res: ServerResponse, message: string) {
  sendJson(res, 404, { error: message });
}

function isLayoutNodeArray(value: unknown): value is LayoutNode[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => entry && typeof entry === 'object' && typeof (entry as LayoutNode).id === 'string' && typeof (entry as LayoutNode).x === 'number' && typeof (entry as LayoutNode).y === 'number')
  );
}

async function persistLayout(projectDir: string, project: HarnessProject, layout: LayoutNode[]): Promise<LayoutNode[]> {
  const nodeIds = new Set(project.nodes.map((node) => node.id));
  const merged: LayoutNode[] = project.layout.map((existing) => {
    const update = layout.find((item) => item.id === existing.id);
    return update ? { id: existing.id, x: update.x, y: update.y } : existing;
  });
  for (const entry of layout) {
    if (!nodeIds.has(entry.id)) continue;
    if (!merged.some((item) => item.id === entry.id)) merged.push({ id: entry.id, x: entry.x, y: entry.y });
  }
  await writeFile(join(projectDir, 'layout.json'), JSON.stringify(merged, null, 2));
  return merged;
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse, options: ServerOptions) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const projectDir = resolve(options.projectDir);

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const project = await loadHarnessProject(projectDir);
      sendHtml(res, 200, renderViewerHtml(project.manifest.name));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/project') {
      const project = await loadHarnessProject(projectDir);
      sendJson(res, 200, toProjectPayload(project));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/trace') {
      const payload = await loadTracePayload(projectDir, options.tracePath);
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, projectDir });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/layout') {
      const body = await readRequestBody(req);
      let parsed: unknown;
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      const layout = (parsed as { layout?: unknown }).layout;
      if (!isLayoutNodeArray(layout)) {
        sendJson(res, 400, { error: 'Body must be {"layout": LayoutNode[]}' });
        return;
      }
      const project = await loadHarnessProject(projectDir);
      const merged = await persistLayout(projectDir, project, layout);
      sendJson(res, 200, { ok: true, layout: merged });
      return;
    }

    sendNotFound(res, `No route for ${req.method} ${url.pathname}`);
  } catch (error) {
    sendJson(res, 500, { error: (error as Error).message });
  }
}

export async function startHarnessEditorServer(options: ServerOptions): Promise<ServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 0;

  const server: Server = createServer((req, res) => {
    handleRequest(req, res, options).catch((error) => {
      sendJson(res, 500, { error: (error as Error).message });
    });
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(requestedPort, host, () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to resolve server address');
  const boundPort = address.port;

  return {
    url: `http://${host}:${boundPort}`,
    host,
    port: boundPort,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) rejectPromise(error);
          else resolvePromise();
        });
      })
  };
}
