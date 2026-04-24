import type { GraphEdge, GraphNode, RuntimeIntent, RuntimeTarget, SkillFile } from '../../core/types';

export type HarnessFactoryDecisionSource = 'user' | 'reference' | 'derived';
export type HarnessFactoryCapabilitySource = 'intent' | 'user' | 'reference' | 'derived';
export type BuiltinHarnessCapabilityId = 'approval-gate' | 'state-memory' | 'mcp-server' | 'review-loop' | 'subagent-delegation';

export interface HarnessFactoryDecision {
  key: string;
  value: unknown;
  source: HarnessFactoryDecisionSource;
  rationale?: string;
  confirmedAt?: string;
}

export interface HarnessFactoryReferencePattern {
  id: string;
  sourceRepo: string;
  why: string;
  capability?: string;
  confidence?: number;
}

export interface HarnessFactoryCapability {
  id: string;
  label: string;
  source: HarnessFactoryCapabilitySource;
  rationale?: string;
  confidence?: number;
}

export interface HarnessFactoryDraftGraphSpec {
  nodes: GraphNode[];
  edges: GraphEdge[];
  runtimeIntents: RuntimeIntent[];
  skills: SkillFile[];
}

export interface HarnessFactoryDraftSpec {
  name: string;
  prompt: string;
  summary: string;
  description?: string;
  targetRuntime: RuntimeTarget;
  requestedCapabilities: string[];
  capabilities: HarnessFactoryCapability[];
  confirmedDecisions: HarnessFactoryDecision[];
  referencePatterns: HarnessFactoryReferencePattern[];
  graph: HarnessFactoryDraftGraphSpec;
}

export interface CreateHarnessFactoryDraftInput {
  name: string;
  prompt: string;
  summary?: string;
  description?: string;
  targetRuntime?: RuntimeTarget;
  requestedCapabilities?: string[];
  capabilities?: HarnessFactoryCapability[];
  confirmedDecisions?: HarnessFactoryDecision[];
  referencePatterns?: HarnessFactoryReferencePattern[];
  graph?: Partial<HarnessFactoryDraftGraphSpec>;
}

function normalizeString(value: string): string {
  return value.trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values.map(normalizeString).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

function cloneNode(node: GraphNode): GraphNode {
  return { ...node, config: node.config ? { ...node.config } : undefined };
}

function cloneEdge(edge: GraphEdge): GraphEdge {
  return { ...edge };
}

function cloneRuntimeIntent(intent: RuntimeIntent): RuntimeIntent {
  return {
    ...intent,
    sourceNodeIds: [...intent.sourceNodeIds]
  };
}

function cloneSkill(skill: SkillFile): SkillFile {
  return { ...skill };
}

function uniqueById<T extends { id: string }>(items: T[], clone: (item: T) => T): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    const id = normalizeString(item.id);
    if (!id) continue;
    byId.set(id, clone({ ...item, id } as T));
  }
  return [...byId.values()];
}

function normalizeCapabilities(capabilities: HarnessFactoryCapability[]): HarnessFactoryCapability[] {
  const byId = new Map<string, HarnessFactoryCapability>();
  for (const capability of capabilities) {
    const id = normalizeString(capability.id);
    const label = normalizeString(capability.label);
    if (!id || !label) continue;
    byId.set(id.toLowerCase(), { ...capability, id, label });
  }
  return [...byId.values()];
}

function normalizeDecisions(decisions: HarnessFactoryDecision[]): HarnessFactoryDecision[] {
  const byKey = new Map<string, HarnessFactoryDecision>();
  for (const decision of decisions) {
    const key = normalizeString(decision.key);
    if (!key) continue;
    byKey.set(key.toLowerCase(), { ...decision, key });
  }
  return [...byKey.values()];
}

function normalizeReferencePatterns(patterns: HarnessFactoryReferencePattern[]): HarnessFactoryReferencePattern[] {
  const byId = new Map<string, HarnessFactoryReferencePattern>();
  for (const pattern of patterns) {
    const id = normalizeString(pattern.id);
    const sourceRepo = normalizeString(pattern.sourceRepo);
    const why = normalizeString(pattern.why);
    if (!id || !sourceRepo || !why) continue;
    byId.set(id.toLowerCase(), {
      ...pattern,
      id,
      sourceRepo,
      why,
      capability: pattern.capability ? normalizeString(pattern.capability) : undefined
    });
  }
  return [...byId.values()];
}

export function emptyHarnessFactoryDraftGraphSpec(): HarnessFactoryDraftGraphSpec {
  return {
    nodes: [],
    edges: [],
    runtimeIntents: [],
    skills: []
  };
}

export function mergeHarnessFactoryDraftGraphSpec(...graphs: Array<Partial<HarnessFactoryDraftGraphSpec> | undefined>): HarnessFactoryDraftGraphSpec {
  const merged = emptyHarnessFactoryDraftGraphSpec();
  for (const graph of graphs) {
    if (!graph) continue;
    merged.nodes = uniqueById([...merged.nodes, ...(graph.nodes ?? [])], cloneNode);
    merged.edges = uniqueById([...merged.edges, ...(graph.edges ?? [])], cloneEdge);
    merged.runtimeIntents = uniqueById([...merged.runtimeIntents, ...(graph.runtimeIntents ?? [])], cloneRuntimeIntent);
    merged.skills = uniqueById([...merged.skills, ...(graph.skills ?? [])], cloneSkill);
  }
  return merged;
}

export function createHarnessFactoryDraft(input: CreateHarnessFactoryDraftInput): HarnessFactoryDraftSpec {
  const name = normalizeString(input.name);
  const prompt = normalizeString(input.prompt);

  if (!name) throw new Error('Harness factory draft requires a non-empty name.');
  if (!prompt) throw new Error('Harness factory draft requires a non-empty prompt.');

  return {
    name,
    prompt,
    summary: normalizeString(input.summary ?? `Harness Factory draft for: ${prompt}`),
    ...(input.description ? { description: normalizeString(input.description) } : {}),
    targetRuntime: input.targetRuntime ?? 'claude-code',
    requestedCapabilities: uniqueStrings(input.requestedCapabilities ?? []),
    capabilities: normalizeCapabilities(input.capabilities ?? []),
    confirmedDecisions: normalizeDecisions(input.confirmedDecisions ?? []),
    referencePatterns: normalizeReferencePatterns(input.referencePatterns ?? []),
    graph: mergeHarnessFactoryDraftGraphSpec(input.graph)
  };
}

export function listHarnessFactoryCapabilityIds(draft: HarnessFactoryDraftSpec): string[] {
  return uniqueStrings(draft.capabilities.map((capability) => capability.id));
}

export function draftIncludesCapability(draft: HarnessFactoryDraftSpec, capabilityId: string): boolean {
  const normalized = normalizeString(capabilityId).toLowerCase();
  return draft.capabilities.some((capability) => capability.id.toLowerCase() === normalized);
}
