import type { GraphEdge, HarnessProject, TraceEvent } from '../../core/types';
import type { ProjectPayload } from './types';

export interface TraceFailureDetails {
  hook: string;
  nodeId: string;
  eventType: TraceEvent['eventType'];
  message: string;
  metadata?: Record<string, unknown>;
  likelyAction: string;
}

export interface TracePayload {
  source: 'trace-file' | 'sandbox-report' | 'none';
  path: string | null;
  events: TraceEvent[];
  error?: string;
  staleTrace?: boolean;
  expectedGraphHash?: string;
  observedGraphHash?: string | null;
  failure?: TraceFailureDetails;
}

export interface TraceDebuggerState {
  events: TraceEvent[];
  activeNodeIds: string[];
  failedNodeIds: string[];
  highlightedEdgeIds: string[];
  latestFailure: TraceFailureDetails | null;
  staleTrace: boolean;
  unmappedEvents: TraceEvent[];
}

export const EMPTY_TRACE_STATE: TraceDebuggerState = {
  events: [],
  activeNodeIds: [],
  failedNodeIds: [],
  highlightedEdgeIds: [],
  latestFailure: null,
  staleTrace: false,
  unmappedEvents: []
};

function graphHashOf(event: TraceEvent): string | null {
  return typeof event.metadata?.graphHash === 'string' ? event.metadata.graphHash : null;
}

function latestObservedGraphHash(events: TraceEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const hash = graphHashOf(events[index]!);
    if (hash) return hash;
  }
  return null;
}

function knownNodeIds(project: Pick<ProjectPayload, 'nodes'>): Set<string> {
  return new Set(project.nodes.map((node) => node.id));
}

function likelyActionForFailure(event: TraceEvent): string {
  if (event.hook === 'MCPServer' || event.eventType === 'mcp-server') return 'Inspect the MCP server node, generated server script, and runtime registration before rerunning sandbox verification.';
  if (event.eventType === 'failure') return `Inspect the ${event.hook} hook for this node, fix the runtime script or project graph, then rerun sandbox verification.`;
  return 'Inspect the latest runtime trace event and rerun sandbox verification after applying a bounded fix.';
}

export function failureDetailsForEvent(event: TraceEvent): TraceFailureDetails {
  return {
    hook: event.hook,
    nodeId: event.nodeId,
    eventType: event.eventType,
    message: event.message,
    ...(event.metadata ? { metadata: event.metadata } : {}),
    likelyAction: likelyActionForFailure(event)
  };
}

export function edgeHighlightsForEvents(events: TraceEvent[], edges: GraphEdge[]): string[] {
  const highlighted = new Set<string>();
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    const edge = edges.find((candidate) => candidate.from === previous.nodeId && candidate.to === current.nodeId);
    if (edge) highlighted.add(edge.id);
  }
  return [...highlighted];
}

export function escapeTraceText(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function reduceTracePayload(project: Pick<ProjectPayload, 'manifest' | 'nodes' | 'edges'>, payload?: TracePayload | null): TraceDebuggerState {
  if (!payload) return EMPTY_TRACE_STATE;
  const nodeIds = knownNodeIds(project);
  const activeNodeIds = new Set<string>();
  const failedNodeIds = new Set<string>();
  const unmappedEvents: TraceEvent[] = [];

  for (const event of payload.events) {
    if (!nodeIds.has(event.nodeId)) {
      unmappedEvents.push(event);
      continue;
    }
    if (event.status === 'error') failedNodeIds.add(event.nodeId);
    else activeNodeIds.add(event.nodeId);
  }

  const latestFailureEvent = [...payload.events]
    .reverse()
    .find((event) => event.status === 'error' && nodeIds.has(event.nodeId))
    ?? [...payload.events].reverse().find((event) => event.status === 'error');
  const observedHash = latestObservedGraphHash(payload.events) ?? payload.observedGraphHash ?? null;
  const currentHash = project.manifest.graphHash;
  const staleTrace = Boolean(payload.staleTrace) && Boolean(observedHash && currentHash && observedHash !== currentHash);

  return {
    events: payload.events,
    activeNodeIds: [...activeNodeIds],
    failedNodeIds: [...failedNodeIds],
    highlightedEdgeIds: edgeHighlightsForEvents(payload.events.filter((event) => nodeIds.has(event.nodeId)), project.edges),
    latestFailure: payload.failure ?? (latestFailureEvent ? failureDetailsForEvent(latestFailureEvent) : null),
    staleTrace,
    unmappedEvents
  };
}

export function projectPayloadFromHarness(project: HarnessProject): ProjectPayload {
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
