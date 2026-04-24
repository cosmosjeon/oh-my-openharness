import type { LayoutNode } from '../../core/types';
import type { CatalogPayload, FactoryChatPayload, FactoryStatePayload, ProjectPayload, SkillUpdatePayload } from './types';
import type { TracePayload } from './trace';

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

function mutationHeaders(apiToken: string): HeadersInit {
  return { 'Content-Type': 'application/json', 'x-omoh-api-token': apiToken };
}

export function fetchProject(): Promise<ProjectPayload> {
  return jsonRequest<ProjectPayload>('/api/project');
}

export function fetchCatalog(): Promise<CatalogPayload> {
  return jsonRequest<CatalogPayload>('/api/catalog');
}

export function fetchFactoryState(sessionId = 'default'): Promise<FactoryStatePayload> {
  return jsonRequest<FactoryStatePayload>(`/api/factory/state?sessionId=${encodeURIComponent(sessionId)}`);
}

export function fetchTrace(): Promise<TracePayload> {
  return jsonRequest<TracePayload>('/api/trace');
}

export function postFactoryChat(apiToken: string, text: string, sessionId = 'default'): Promise<FactoryChatPayload> {
  return jsonRequest<FactoryChatPayload>('/api/factory/chat', {
    method: 'POST',
    headers: mutationHeaders(apiToken),
    body: JSON.stringify({ text, sessionId })
  });
}

export function saveLayout(apiToken: string, layout: LayoutNode[]) {
  return jsonRequest<{ ok: boolean; layout: LayoutNode[] }>('/api/layout', {
    method: 'POST',
    headers: mutationHeaders(apiToken),
    body: JSON.stringify({ layout })
  });
}

export function updateNode(apiToken: string, nodeId: string, label: string, config?: Record<string, unknown>) {
  return jsonRequest<ProjectPayload>('/api/project/mutate', {
    method: 'POST',
    headers: mutationHeaders(apiToken),
    body: JSON.stringify({ action: 'update-node', nodeId, label, ...(config ? { config } : {}) })
  });
}

export function updateSkill(apiToken: string, payload: SkillUpdatePayload) {
  return jsonRequest<ProjectPayload>('/api/project/skill', {
    method: 'POST',
    headers: mutationHeaders(apiToken),
    body: JSON.stringify(payload)
  });
}

export function rerunSandbox(apiToken: string) {
  return jsonRequest<{ ok: boolean; mode: string; hotReload: boolean; message: string; trace: TracePayload }>('/api/sandbox/rerun', {
    method: 'POST',
    headers: mutationHeaders(apiToken),
    body: JSON.stringify({})
  });
}
