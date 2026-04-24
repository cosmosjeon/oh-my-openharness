import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { refreshDerivedProject } from '../core/generator';
import { loadHarnessProject, writeHarnessProject } from '../core/project';
import type { GraphEdge, GraphNode, HarnessProject, LayoutNode, SkillFile, TraceEvent } from '../core/types';
import { describeRuntimeTarget } from '../core/runtime-targets';
import { createHarnessFactoryStore, type HarnessFactoryState } from '../factory/state';
import { applyAnswer, queueNextQuestion } from '../factory/interview';
import { routeFactoryPrompt } from '../factory/hooks/routing';
import { orchestrateFactoryAction, type FactoryActionOrchestrationResult } from '../factory/actions';
import { renderViewerHtml } from './viewer';

export interface ServerOptions {
  projectDir: string;
  port?: number;
  host?: string;
  tracePath?: string;
  apiToken?: string;
  staticRoot?: string;
  factoryStateRoot?: string;
}

export interface ServerHandle {
  url: string;
  port: number;
  host: string;
  apiToken: string;
  close(): Promise<void>;
}

interface ProjectPayload {
  manifest: HarnessProject['manifest'];
  nodes: HarnessProject['nodes'];
  edges: HarnessProject['edges'];
  layout: HarnessProject['layout'];
  skills: HarnessProject['skills'];
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

type SkillMutationBody =
  | { skillId: string; content: string; description?: string }
  | { name: string; content: string; description?: string };

type FactoryChatBody = {
  sessionId?: string;
  text?: string;
  action?: 'draft' | 'build' | 'preview' | 'verify' | 'export';
  questionId?: string;
  workspaceDir?: string;
  projectName?: string;
  projectPath?: string;
  outDir?: string;
  confirmRisk?: boolean;
};

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
    skills: project.skills,
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

function contentTypeFor(path: string): string {
  const ext = extname(path);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

async function sendStaticFile(res: ServerResponse, filePath: string): Promise<boolean> {
  try {
    const body = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypeFor(filePath));
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function sendNotFound(res: ServerResponse, message: string) {
  sendJson(res, 404, { error: message });
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] ?? null : null;
}

function formatUrlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function createApiToken(): string {
  return randomBytes(24).toString('base64url');
}

function readMutationToken(req: IncomingMessage): string | null {
  const headerToken = firstHeaderValue(req.headers['x-omoh-api-token']);
  if (headerToken) return headerToken;
  const authHeader = firstHeaderValue(req.headers.authorization);
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function hasAllowedMutationOrigin(req: IncomingMessage): boolean {
  const origin = firstHeaderValue(req.headers.origin);
  if (!origin) return true;
  const host = firstHeaderValue(req.headers.host);
  if (!host) return false;
  try {
    const parsedOrigin = new URL(origin);
    return (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:') && parsedOrigin.host === host;
  } catch {
    return false;
  }
}

function authorizeMutationRequest(req: IncomingMessage, res: ServerResponse, apiToken: string): boolean {
  if (readMutationToken(req) !== apiToken) {
    sendJson(res, 401, { error: 'Mutating requests require a valid x-omoh-api-token header.' });
    return false;
  }
  if (!hasAllowedMutationOrigin(req)) {
    sendJson(res, 403, { error: 'Mutating requests must originate from the same origin as the editor server.' });
    return false;
  }
  return true;
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

function mergeRefreshedAuthoring(project: HarnessProject, refreshedProject: HarnessProject): HarnessProject['authoring'] {
  const previousDerivedAuthoring = refreshDerivedProject(project).authoring;
  const confirmationStateById = new Map(project.authoring.confirmationRequests.map((request) => [request.id, request.confirmed]));
  const preservedWarnings = project.authoring.warnings.filter((warning) => !previousDerivedAuthoring.warnings.includes(warning));

  return {
    ...refreshedProject.authoring,
    summary: project.authoring.summary !== previousDerivedAuthoring.summary ? project.authoring.summary : refreshedProject.authoring.summary,
    warnings: [...new Set([...refreshedProject.authoring.warnings, ...preservedWarnings])],
    confirmationRequests: refreshedProject.authoring.confirmationRequests.map((request) => ({
      ...request,
      confirmed: confirmationStateById.get(request.id) ?? request.confirmed
    })),
    compatibleRuntimes: project.authoring.compatibleRuntimes.length > 0 ? project.authoring.compatibleRuntimes : refreshedProject.authoring.compatibleRuntimes
  };
}

async function persistProject(projectDir: string, project: HarnessProject): Promise<ProjectPayload> {
  const refreshedProject = refreshDerivedProject(project);
  await writeHarnessProject(projectDir, {
    ...refreshedProject,
    authoring: mergeRefreshedAuthoring(project, refreshedProject)
  });
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

function resolveFactoryStateRoot(projectDir: string, options: ServerOptions): string {
  return resolve(options.factoryStateRoot ?? process.env.HARNESS_FACTORY_STATE_DIR ?? join(projectDir, '.omx', 'factory-state'));
}

function sessionIdFrom(url: URL, value: unknown): string {
  const fromBody = typeof value === 'string' && value.trim() ? value.trim() : undefined;
  return fromBody ?? url.searchParams.get('sessionId') ?? 'default';
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  const body = await readRequestBody(req);
  if (!body) return {};
  return JSON.parse(body);
}

function findSkill(project: HarnessProject, body: SkillMutationBody): SkillFile | undefined {
  if ('skillId' in body) return project.skills.find((skill) => skill.id === body.skillId);
  return project.skills.find((skill) => skill.name === body.name);
}

async function updateProjectSkill(projectDir: string, project: HarnessProject, body: SkillMutationBody): Promise<ProjectPayload> {
  if (typeof body.content !== 'string') throw new Error('Invalid skill mutation: content must be a string.');
  const skill = findSkill(project, body);
  if (!skill) throw new Error('Invalid skill mutation: unknown skill.');
  const nextProject: HarnessProject = {
    ...project,
    skills: project.skills.map((entry) =>
      entry.id === skill.id
        ? { ...entry, content: body.content, ...(body.description !== undefined ? { description: body.description } : {}) }
        : entry
    )
  };
  return persistProject(projectDir, nextProject);
}

async function loadFactoryState(projectDir: string, options: ServerOptions, sessionId: string): Promise<{ stateRoot: string; state?: HarnessFactoryState; error?: string }> {
  const stateRoot = resolveFactoryStateRoot(projectDir, options);
  const store = createHarnessFactoryStore(stateRoot);
  try {
    return { stateRoot, state: await store.load(sessionId) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { stateRoot };
    return { stateRoot, error: (error as Error).message };
  }
}

async function handleFactoryChat(projectDir: string, url: URL, options: ServerOptions, body: FactoryChatBody): Promise<{
  ok: boolean;
  route: string;
  reason: string;
  state?: HarnessFactoryState;
  question?: unknown;
  result?: Omit<FactoryActionOrchestrationResult, 'previewHandle'>;
  error?: string;
}> {
  const text = typeof body.text === 'string' && body.text.trim() ? body.text.trim() : 'continue';
  const sessionId = sessionIdFrom(url, body.sessionId);
  const stateRoot = resolveFactoryStateRoot(projectDir, options);
  const store = createHarnessFactoryStore(stateRoot);
  let state: HarnessFactoryState;
  try {
    state = await store.load(sessionId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    state = await store.create({ sessionId, userIntent: text });
  }

  if (body.questionId || state.openQuestions.some((question) => !question.answeredAt)) {
    state = await store.save(applyAnswer(state, { answer: text, ...(body.questionId ? { questionId: body.questionId } : {}) }));
  }

  const route = body.action ? { route: body.action, reason: `Explicit Factory action requested: ${body.action}.` } : routeFactoryPrompt(state, text);
  if (route.route === 'ask-question') {
    const queued = queueNextQuestion(state);
    const saved = queued.state === state ? state : await store.save(queued.state);
    return { ok: true, route: 'ask-question', reason: route.reason, state: saved, question: queued.question ?? route.question };
  }

  if (route.route === 'preview') {
    return {
      ok: true,
      route: 'preview',
      reason: route.reason,
      state,
      result: {
        ok: true,
        action: 'preview',
        state,
        record: {
          action: 'preview',
          status: 'idle',
          startedAt: new Date().toISOString(),
          message: 'Preview is already served by the current editor server.'
        },
        preview: { url: '/', host: options.host ?? '127.0.0.1', port: options.port ?? 0, apiToken: options.apiToken ?? '', mutationProtection: 'token+same-origin' }
      }
    };
  }

  const result = await orchestrateFactoryAction({
    store,
    sessionId,
    action: route.route,
    workspaceDir: body.workspaceDir ?? dirname(projectDir),
    ...(body.projectName ? { projectName: body.projectName } : {}),
    ...(body.projectPath ? { projectPath: body.projectPath } : {}),
    ...(body.outDir ? { outDir: body.outDir } : {}),
    ...(body.confirmRisk !== undefined ? { confirmRisk: body.confirmRisk } : {})
  });
  const { previewHandle: _previewHandle, ...serializable } = result;
  return { ok: result.ok, route: route.route, reason: route.reason, state: result.state, result: serializable };
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse, options: ServerOptions) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const projectDir = resolve(options.projectDir);

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const project = await loadHarnessProject(projectDir);
      const staticRoot = resolve(options.staticRoot ?? resolve('dist', 'web-client'));
      if (await sendStaticFile(res, join(staticRoot, 'index.html'))) return;
      sendHtml(res, 200, renderViewerHtml(project.manifest.name));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const staticRoot = resolve(options.staticRoot ?? resolve('dist', 'web-client'));
      const assetPath = resolve(staticRoot, `.${url.pathname}`);
      if (!isPathInside(staticRoot, assetPath)) {
        sendJson(res, 400, { error: 'Invalid asset path' });
        return;
      }
      if (await sendStaticFile(res, assetPath)) return;
      sendNotFound(res, `No route for ${req.method} ${url.pathname}`);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/project') {
      const project = await loadHarnessProject(projectDir);
      sendJson(res, 200, toProjectPayload(project));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      const project = await loadHarnessProject(projectDir);
      sendJson(res, 200, project.registry);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/compatibility') {
      const project = await loadHarnessProject(projectDir);
      sendJson(res, 200, {
        targetRuntime: project.manifest.targetRuntime,
        supportedRuntimes: project.manifest.supportedRuntimes ?? [project.manifest.targetRuntime],
        nodes: project.nodes.map((node) => ({
          id: node.id,
          kind: node.kind,
          compatibleRuntimes: project.registry.blocks.find((block) => block.kind === node.kind)?.compatibleRuntimes ?? []
        }))
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/factory/state') {
      const sessionId = sessionIdFrom(url, undefined);
      const loaded = await loadFactoryState(projectDir, options, sessionId);
      sendJson(res, loaded.error ? 500 : 200, {
        configured: Boolean(loaded.state),
        stateRoot: loaded.stateRoot,
        sessionId,
        ...(loaded.state ? { state: loaded.state } : {}),
        ...(loaded.error ? { error: loaded.error } : {})
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/trace') {
      const project = await loadHarnessProject(projectDir);
      const payload = await loadTracePayload(projectDir, options.tracePath, project.manifest.graphHash, project.manifest.targetRuntime);
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, mutationProtection: 'token+same-origin' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/factory/chat') {
      if (!authorizeMutationRequest(req, res, options.apiToken ?? '')) return;
      try {
        const parsed = await parseJsonBody(req);
        if (!isRecord(parsed)) {
          sendJson(res, 400, { error: 'Body must be a JSON object' });
          return;
        }
        const payload = await handleFactoryChat(projectDir, url, options, parsed as FactoryChatBody);
        sendJson(res, payload.error ? 500 : 200, payload);
      } catch (error) {
        sendJson(res, 500, { error: (error as Error).message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/layout') {
      if (!authorizeMutationRequest(req, res, options.apiToken ?? '')) return;
      let parsed: unknown;
      try {
        parsed = await parseJsonBody(req);
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
      if (!authorizeMutationRequest(req, res, options.apiToken ?? '')) return;
      let parsed: unknown;
      try {
        parsed = await parseJsonBody(req);
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

    if (req.method === 'POST' && url.pathname === '/api/project/skill') {
      if (!authorizeMutationRequest(req, res, options.apiToken ?? '')) return;
      let parsed: unknown;
      try {
        parsed = await parseJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      if (!isRecord(parsed) || typeof parsed.content !== 'string') {
        sendJson(res, 400, { error: 'Body must include skillId or name plus content.' });
        return;
      }
      try {
        const project = await loadHarnessProject(projectDir);
        const payload = await updateProjectSkill(projectDir, project, parsed as SkillMutationBody);
        sendJson(res, 200, payload);
      } catch (error) {
        const message = (error as Error).message;
        sendJson(res, message.startsWith('Invalid skill mutation') ? 400 : 500, { error: message });
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
  const apiToken = options.apiToken?.trim() || createApiToken();
  const resolvedOptions: ServerOptions = { ...options, host, apiToken };

  const server: Server = createServer((req, res) => {
    handleRequest(req, res, resolvedOptions).catch((error) => {
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
    url: `http://${formatUrlHost(host)}:${boundPort}`,
    host,
    port: boundPort,
    apiToken,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) rejectPromise(error);
          else resolvePromise();
        });
      })
  };
}
