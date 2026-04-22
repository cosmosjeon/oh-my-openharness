import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { refreshDerivedProject } from '../core/generator';
import { loadHarnessProject, writeHarnessProject } from '../core/project';
import type { GraphEdge, GraphNode, HarnessProject, LayoutNode, TraceEvent } from '../core/types';
import { describeRuntimeTarget } from '../core/runtime-targets';
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
  staleTrace?: boolean;
  expectedGraphHash?: string;
  observedGraphHash?: string | null;
}

type EditorMutationBody =
  | { action: 'add-node'; kind: GraphNode['kind']; label: string; x?: number; y?: number }
  | { action: 'update-node'; nodeId: string; label?: string; config?: Record<string, unknown> }
  | { action: 'delete-node'; nodeId: string }
  | { action: 'add-edge'; from: string; to: string; label?: string }
  | { action: 'delete-edge'; edgeId: string };

async function readTraceFile(path: string): Promise<TraceEvent[]> {
  const raw = await readFile(path, 'utf8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEvent);
}

function inferObservedGraphHash(events: TraceEvent[]): string | null {
  for (const event of events) {
    const graphHash = event.metadata && typeof event.metadata.graphHash === 'string' ? event.metadata.graphHash : null;
    if (graphHash) return graphHash;
  }
  return null;
}

export async function loadTracePayload(projectDir: string, explicitPath?: string, expectedGraphHash?: string, currentRuntime = 'claude-code'): Promise<TracePayload> {
  const compileDirName = describeRuntimeTarget(currentRuntime as Parameters<typeof describeRuntimeTarget>[0]).compileDirName;
  const candidates = [
    explicitPath,
    join(projectDir, 'trace.jsonl'),
    join(projectDir, 'compiler', compileDirName, 'trace.jsonl'),
    join(projectDir, 'sandbox', 'trace.jsonl')
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const events = await readTraceFile(candidate);
      const observedGraphHash = inferObservedGraphHash(events);
      return {
        source: 'trace-file',
        path: candidate,
        events,
        ...(expectedGraphHash ? { expectedGraphHash, observedGraphHash, staleTrace: Boolean(observedGraphHash && observedGraphHash !== expectedGraphHash) } : {})
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { source: 'trace-file', path: candidate, events: [], error: (error as Error).message, ...(expectedGraphHash ? { expectedGraphHash, observedGraphHash: null, staleTrace: false } : {}) };
      }
    }
  }

  return { source: 'none', path: null, events: [], ...(expectedGraphHash ? { expectedGraphHash, observedGraphHash: null, staleTrace: false } : {}) };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nextNodeId(nodes: GraphNode[], kind: GraphNode['kind']): string {
  let counter = nodes.filter((node) => node.kind === kind).length + 1;
  let candidate = `${kind.toLowerCase()}-${counter}`;
  const existing = new Set(nodes.map((node) => node.id));
  while (existing.has(candidate)) {
    counter += 1;
    candidate = `${kind.toLowerCase()}-${counter}`;
  }
  return candidate;
}

function nextEdgeId(edges: GraphEdge[]): string {
  let counter = edges.length + 1;
  let candidate = `edge-${counter}`;
  const existing = new Set(edges.map((edge) => edge.id));
  while (existing.has(candidate)) {
    counter += 1;
    candidate = `edge-${counter}`;
  }
  return candidate;
}

async function persistProject(projectDir: string, project: HarnessProject): Promise<ProjectPayload> {
  await writeHarnessProject(projectDir, refreshDerivedProject(project));
  const reloaded = await loadHarnessProject(projectDir);
  return toProjectPayload(reloaded);
}

async function applyEditorMutation(projectDir: string, project: HarnessProject, body: EditorMutationBody): Promise<ProjectPayload> {
  switch (body.action) {
    case 'add-node': {
      if (body.kind === 'Skill') throw new Error('Invalid editor mutation: Skill nodes must be created through runtime authoring, not the generic editor add-node path.');
      const id = nextNodeId(project.nodes, body.kind);
      const nextProject: HarnessProject = {
        ...project,
        nodes: [...project.nodes, { id, kind: body.kind, label: body.label }],
        layout: [...project.layout, { id, x: body.x ?? 80, y: body.y ?? 80 }],
        runtimeIntents: undefined
      };
      return persistProject(projectDir, nextProject);
    }
    case 'update-node': {
      if (!project.nodes.some((node) => node.id === body.nodeId)) throw new Error(`Invalid editor mutation: unknown node ${body.nodeId}`);
      const nextProject: HarnessProject = {
        ...project,
        nodes: project.nodes.map((node) => (node.id === body.nodeId ? { ...node, ...(body.label !== undefined ? { label: body.label } : {}), ...(body.config !== undefined ? { config: body.config } : {}) } : node)),
        runtimeIntents: undefined
      };
      return persistProject(projectDir, nextProject);
    }
    case 'delete-node': {
      if (!project.nodes.some((node) => node.id === body.nodeId)) throw new Error(`Invalid editor mutation: unknown node ${body.nodeId}`);
      const nextProject: HarnessProject = {
        ...project,
        nodes: project.nodes.filter((node) => node.id !== body.nodeId),
        edges: project.edges.filter((edge) => edge.from !== body.nodeId && edge.to !== body.nodeId),
        layout: project.layout.filter((item) => item.id !== body.nodeId),
        composites: project.composites.filter((item) => !item.expandedNodeIds.includes(body.nodeId)),
        runtimeIntents: undefined
      };
      return persistProject(projectDir, nextProject);
    }
    case 'add-edge': {
      if (!project.nodes.some((node) => node.id === body.from) || !project.nodes.some((node) => node.id === body.to)) {
        throw new Error('Invalid editor mutation: add-edge endpoints must both exist in the canonical graph.');
      }
      const nextProject: HarnessProject = {
        ...project,
        edges: [...project.edges, { id: nextEdgeId(project.edges), from: body.from, to: body.to, ...(body.label ? { label: body.label } : {}) }],
        runtimeIntents: undefined
      };
      return persistProject(projectDir, nextProject);
    }
    case 'delete-edge': {
      if (!project.edges.some((edge) => edge.id === body.edgeId)) throw new Error(`Invalid editor mutation: unknown edge ${body.edgeId}`);
      const nextProject: HarnessProject = {
        ...project,
        edges: project.edges.filter((edge) => edge.id !== body.edgeId),
        runtimeIntents: undefined
      };
      return persistProject(projectDir, nextProject);
    }
    default:
      throw new Error('Invalid editor mutation: unsupported action');
  }
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
      const project = await loadHarnessProject(projectDir);
      const payload = await loadTracePayload(projectDir, options.tracePath, project.manifest.graphHash, project.manifest.targetRuntime);
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

    if (req.method === 'POST' && url.pathname === '/api/project/mutate') {
      const body = await readRequestBody(req);
      let parsed: unknown;
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      if (!isRecord(parsed) || typeof parsed.action !== 'string') {
        sendJson(res, 400, { error: 'Body must include a valid action' });
        return;
      }
      try {
        const project = await loadHarnessProject(projectDir);
        const payload = await applyEditorMutation(projectDir, project, parsed as EditorMutationBody);
        sendJson(res, 200, payload);
      } catch (error) {
        const message = (error as Error).message;
        sendJson(res, message.startsWith('Invalid editor mutation') ? 400 : 500, { error: message });
      }
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
