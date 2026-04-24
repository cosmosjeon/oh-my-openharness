import type { GraphEdge, GraphNode, RuntimeIntent, RuntimeTarget, SkillFile } from '../../core/types';

export type HarnessFactoryStage = 'intake' | 'interview' | 'drafting' | 'built' | 'previewing' | 'verifying';
export type HarnessFactoryDecisionSource = 'user' | 'reference' | 'derived';
export type HarnessFactoryVerificationStatus = 'not-run' | 'running' | 'passed' | 'failed';
export type HarnessFactoryActionName = 'draft' | 'build' | 'preview' | 'verify' | 'export';
export type HarnessFactoryActionStatus = 'idle' | 'running' | 'passed' | 'failed';

export interface HarnessFactoryDecision {
  key: string;
  value: unknown;
  source: HarnessFactoryDecisionSource;
  createdAt: string;
}

export interface HarnessFactoryQuestion {
  id: string;
  question: string;
  reason: string;
  priority: number;
  createdAt: string;
  answeredAt?: string;
}

export interface HarnessFactoryReferencePatternSelection {
  id: string;
  sourceRepo: string;
  why: string;
  score?: number;
}

export interface HarnessFactoryDraftGraphSpec {
  nodes: GraphNode[];
  edges: GraphEdge[];
  runtimeIntents: RuntimeIntent[];
  skills: SkillFile[];
}

export interface HarnessFactoryPreviewStatus {
  url?: string;
  lastOpenedAt?: string;
  status?: 'not-opened' | 'open' | 'closed' | 'error';
  apiToken?: string;
  mutationProtection?: 'token+same-origin';
  error?: string;
}

export interface HarnessFactoryVerification {
  status: HarnessFactoryVerificationStatus;
  lastRunAt?: string;
  ok?: boolean;
  summary?: string;
  traceFile?: string;
  error?: string;
}

export interface HarnessFactoryExportStatus {
  runtime?: RuntimeTarget;
  outDir?: string;
  runtimeBundleRoot?: string;
  runtimeBundleManifestPath?: string;
  exportManifestPath?: string;
  exportedAt?: string;
}

export interface HarnessFactoryActionRecord {
  action: HarnessFactoryActionName;
  status: HarnessFactoryActionStatus;
  startedAt: string;
  completedAt?: string;
  message?: string;
  projectPath?: string;
  graphHash?: string;
  output?: Record<string, unknown>;
}

export interface HarnessFactoryActionFailure {
  action: HarnessFactoryActionName;
  message: string;
  category: string;
  timestamp: string;
  stack?: string;
  projectPath?: string;
  graphHash?: string;
}

export interface HarnessFactoryActionState {
  lastAction?: HarnessFactoryActionRecord;
  lastFailure?: HarnessFactoryActionFailure;
  history: HarnessFactoryActionRecord[];
}

export interface HarnessFactoryState {
  schemaVersion: '0.1.0';
  sessionId: string;
  stage: HarnessFactoryStage;
  userIntent: string;
  targetRuntime?: RuntimeTarget;
  requestedCapabilities: string[];
  openQuestions: HarnessFactoryQuestion[];
  confirmedDecisions: HarnessFactoryDecision[];
  referencePatterns: HarnessFactoryReferencePatternSelection[];
  draftGraphSpec: HarnessFactoryDraftGraphSpec;
  projectPath?: string;
  preview: HarnessFactoryPreviewStatus;
  verification: HarnessFactoryVerification;
  exportResult?: HarnessFactoryExportStatus;
  actions: HarnessFactoryActionState;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHarnessFactoryStateInput {
  sessionId: string;
  userIntent: string;
  targetRuntime?: RuntimeTarget;
  requestedCapabilities?: string[];
  openQuestions?: Array<Omit<HarnessFactoryQuestion, 'createdAt'>>;
  confirmedDecisions?: Array<Omit<HarnessFactoryDecision, 'createdAt'>>;
  referencePatterns?: HarnessFactoryReferencePatternSelection[];
  draftGraphSpec?: Partial<HarnessFactoryDraftGraphSpec>;
  projectPath?: string;
  now?: string;
}

const RUNTIME_TARGETS = new Set<RuntimeTarget>(['claude-code', 'opencode', 'codex']);
const STAGES = new Set<HarnessFactoryStage>(['intake', 'interview', 'drafting', 'built', 'previewing', 'verifying']);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertString(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string.`);
  return value;
}

function assertStringArray(value: unknown, label: string): string[] {
  assert(Array.isArray(value), `${label} must be an array.`);
  for (const [index, item] of value.entries()) assertString(item, `${label}[${index}]`);
  return value;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function normalizeCapabilities(capabilities: string[]): string[] {
  return Array.from(new Set(capabilities.map((item) => item.trim()).filter(Boolean)));
}

export function emptyDraftGraphSpec(): HarnessFactoryDraftGraphSpec {
  return { nodes: [], edges: [], runtimeIntents: [], skills: [] };
}

export function createHarnessFactoryState(input: CreateHarnessFactoryStateInput): HarnessFactoryState {
  const now = input.now ?? new Date().toISOString();
  const draft = input.draftGraphSpec ?? {};
  return validateHarnessFactoryState({
    schemaVersion: '0.1.0',
    sessionId: input.sessionId,
    stage: 'intake',
    userIntent: input.userIntent,
    ...(input.targetRuntime ? { targetRuntime: input.targetRuntime } : {}),
    requestedCapabilities: normalizeCapabilities(input.requestedCapabilities ?? []),
    openQuestions: (input.openQuestions ?? []).map((question) => ({ ...question, createdAt: now })),
    confirmedDecisions: (input.confirmedDecisions ?? []).map((decision) => ({ ...decision, createdAt: now })),
    referencePatterns: input.referencePatterns ?? [],
    draftGraphSpec: {
      nodes: draft.nodes ?? [],
      edges: draft.edges ?? [],
      runtimeIntents: draft.runtimeIntents ?? [],
      skills: draft.skills ?? []
    },
    ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    preview: { status: 'not-opened' },
    verification: { status: 'not-run' },
    actions: { history: [] },
    createdAt: now,
    updatedAt: now
  });
}

export function validateHarnessFactoryState(value: unknown): HarnessFactoryState {
  const state = assertRecord(value, 'HarnessFactoryState');
  assert(state.schemaVersion === '0.1.0', 'HarnessFactoryState.schemaVersion must be 0.1.0.');
  assertString(state.sessionId, 'HarnessFactoryState.sessionId');
  assert(STAGES.has(state.stage as HarnessFactoryStage), 'HarnessFactoryState.stage is invalid.');
  assertString(state.userIntent, 'HarnessFactoryState.userIntent');
  if (state.targetRuntime !== undefined) assert(RUNTIME_TARGETS.has(state.targetRuntime as RuntimeTarget), 'HarnessFactoryState.targetRuntime is invalid.');
  assertStringArray(state.requestedCapabilities, 'HarnessFactoryState.requestedCapabilities');
  assert(Array.isArray(state.openQuestions), 'HarnessFactoryState.openQuestions must be an array.');
  assert(Array.isArray(state.confirmedDecisions), 'HarnessFactoryState.confirmedDecisions must be an array.');
  assert(Array.isArray(state.referencePatterns), 'HarnessFactoryState.referencePatterns must be an array.');
  const draft = assertRecord(state.draftGraphSpec, 'HarnessFactoryState.draftGraphSpec');
  assert(Array.isArray(draft.nodes), 'HarnessFactoryState.draftGraphSpec.nodes must be an array.');
  assert(Array.isArray(draft.edges), 'HarnessFactoryState.draftGraphSpec.edges must be an array.');
  assert(Array.isArray(draft.runtimeIntents), 'HarnessFactoryState.draftGraphSpec.runtimeIntents must be an array.');
  assert(Array.isArray(draft.skills), 'HarnessFactoryState.draftGraphSpec.skills must be an array.');
  if (state.projectPath !== undefined) assertString(state.projectPath, 'HarnessFactoryState.projectPath');
  const preview = assertRecord(state.preview ?? { status: 'not-opened' }, 'HarnessFactoryState.preview');
  const verification = assertRecord(state.verification ?? { status: 'not-run' }, 'HarnessFactoryState.verification');
  const actions = assertRecord(state.actions ?? { history: [] }, 'HarnessFactoryState.actions');
  assert(Array.isArray(actions.history), 'HarnessFactoryState.actions.history must be an array.');
  if (state.exportResult !== undefined) assertRecord(state.exportResult, 'HarnessFactoryState.exportResult');
  assertString(state.createdAt, 'HarnessFactoryState.createdAt');
  assertString(state.updatedAt, 'HarnessFactoryState.updatedAt');
  return {
    ...state,
    preview,
    verification,
    actions: {
      ...(actions.lastAction ? { lastAction: actions.lastAction } : {}),
      ...(actions.lastFailure ? { lastFailure: actions.lastFailure } : {}),
      history: actions.history
    }
  } as unknown as HarnessFactoryState;
}


export function withFactoryStateUpdate(state: HarnessFactoryState, patch: Partial<Omit<HarnessFactoryState, 'schemaVersion' | 'sessionId' | 'createdAt'>>, now = new Date().toISOString()): HarnessFactoryState {
  return validateHarnessFactoryState({ ...state, ...patch, updatedAt: now });
}
