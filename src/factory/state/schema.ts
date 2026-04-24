import type { RuntimeTarget } from '../../core/types';
import {
  createHarnessFactoryDraft,
  emptyHarnessFactoryDraftGraphSpec,
  type CreateHarnessFactoryDraftInput,
  type HarnessFactoryDecision,
  type HarnessFactoryDraftGraphSpec,
  type HarnessFactoryDraftSpec,
  type HarnessFactoryReferencePattern
} from '../synthesis/draft-spec';

export const HARNESS_FACTORY_STATE_VERSION = '0.1.0';

export type HarnessFactoryStage = 'intake' | 'interview' | 'drafting' | 'built' | 'previewing' | 'verifying';

export interface HarnessFactoryOpenQuestion {
  id: string;
  question: string;
  reason: string;
  priority: number;
  askedAt?: string;
}

export interface HarnessFactoryPreviewState {
  url?: string;
  lastOpenedAt?: string;
}

export interface HarnessFactoryVerificationState {
  lastRunAt?: string;
  ok?: boolean;
  summary?: string;
}

export interface HarnessFactoryState {
  schemaVersion: string;
  sessionId: string;
  stage: HarnessFactoryStage;
  userIntent: string;
  targetRuntime?: RuntimeTarget;
  requestedCapabilities: string[];
  confirmedDecisions: HarnessFactoryDecision[];
  openQuestions: HarnessFactoryOpenQuestion[];
  referencePatterns: HarnessFactoryReferencePattern[];
  draftGraphSpec: HarnessFactoryDraftGraphSpec;
  draft?: HarnessFactoryDraftSpec;
  projectPath?: string;
  preview?: HarnessFactoryPreviewState;
  verification?: HarnessFactoryVerificationState;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHarnessFactoryStateInput {
  sessionId: string;
  userIntent: string;
  stage?: HarnessFactoryStage;
  targetRuntime?: RuntimeTarget;
  requestedCapabilities?: string[];
  confirmedDecisions?: HarnessFactoryDecision[];
  openQuestions?: HarnessFactoryOpenQuestion[];
  referencePatterns?: HarnessFactoryReferencePattern[];
  draftGraphSpec?: Partial<HarnessFactoryDraftGraphSpec>;
  draft?: HarnessFactoryDraftSpec | CreateHarnessFactoryDraftInput;
  projectPath?: string;
  preview?: HarnessFactoryPreviewState;
  verification?: HarnessFactoryVerificationState;
  createdAt?: string;
  updatedAt?: string;
  schemaVersion?: string;
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

function normalizeOpenQuestions(questions: HarnessFactoryOpenQuestion[]): HarnessFactoryOpenQuestion[] {
  const byId = new Map<string, HarnessFactoryOpenQuestion>();
  for (const question of questions) {
    const id = normalizeString(question.id);
    const prompt = normalizeString(question.question);
    const reason = normalizeString(question.reason);
    if (!id || !prompt || !reason) continue;
    byId.set(id.toLowerCase(), {
      ...question,
      id,
      question: prompt,
      reason,
      priority: Number.isFinite(question.priority) ? question.priority : 100
    });
  }
  return [...byId.values()].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
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

function normalizeDraft(draft?: HarnessFactoryDraftSpec | CreateHarnessFactoryDraftInput): HarnessFactoryDraftSpec | undefined {
  if (!draft) return undefined;
  return createHarnessFactoryDraft(draft);
}

export function createHarnessFactoryState(input: CreateHarnessFactoryStateInput): HarnessFactoryState {
  const sessionId = normalizeString(input.sessionId);
  const userIntent = normalizeString(input.userIntent);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const updatedAt = input.updatedAt ?? createdAt;
  const draft = normalizeDraft(input.draft);
  const draftGraphSpec = draft?.graph ?? {
    ...emptyHarnessFactoryDraftGraphSpec(),
    ...input.draftGraphSpec
  };

  if (!sessionId) throw new Error('Harness factory state requires a non-empty sessionId.');
  if (!userIntent) throw new Error('Harness factory state requires a non-empty userIntent.');

  return {
    schemaVersion: input.schemaVersion ?? HARNESS_FACTORY_STATE_VERSION,
    sessionId,
    stage: input.stage ?? 'intake',
    userIntent,
    ...(input.targetRuntime ? { targetRuntime: input.targetRuntime } : {}),
    requestedCapabilities: uniqueStrings(input.requestedCapabilities ?? draft?.requestedCapabilities ?? []),
    confirmedDecisions: normalizeDecisions(input.confirmedDecisions ?? draft?.confirmedDecisions ?? []),
    openQuestions: normalizeOpenQuestions(input.openQuestions ?? []),
    referencePatterns: normalizeReferencePatterns(input.referencePatterns ?? draft?.referencePatterns ?? []),
    draftGraphSpec,
    ...(draft ? { draft } : {}),
    ...(input.projectPath ? { projectPath: normalizeString(input.projectPath) } : {}),
    ...(input.preview ? { preview: { ...input.preview } } : {}),
    ...(input.verification ? { verification: { ...input.verification } } : {}),
    createdAt,
    updatedAt
  };
}

export function withHarnessFactoryStage(state: HarnessFactoryState, stage: HarnessFactoryStage): HarnessFactoryState {
  return {
    ...state,
    stage,
    updatedAt: new Date().toISOString()
  };
}

export function withHarnessFactoryDraft(state: HarnessFactoryState, draft: HarnessFactoryDraftSpec | CreateHarnessFactoryDraftInput): HarnessFactoryState {
  const normalizedDraft = normalizeDraft(draft);
  if (!normalizedDraft) return state;
  return {
    ...state,
    stage: 'drafting',
    targetRuntime: normalizedDraft.targetRuntime,
    requestedCapabilities: uniqueStrings([...state.requestedCapabilities, ...normalizedDraft.requestedCapabilities]),
    confirmedDecisions: normalizeDecisions([...state.confirmedDecisions, ...normalizedDraft.confirmedDecisions]),
    referencePatterns: normalizeReferencePatterns([...state.referencePatterns, ...normalizedDraft.referencePatterns]),
    draftGraphSpec: normalizedDraft.graph,
    draft: normalizedDraft,
    updatedAt: new Date().toISOString()
  };
}

export function withConfirmedDecision(state: HarnessFactoryState, decision: HarnessFactoryDecision): HarnessFactoryState {
  return {
    ...state,
    confirmedDecisions: normalizeDecisions([...state.confirmedDecisions, decision]),
    updatedAt: new Date().toISOString()
  };
}

export function withResolvedQuestion(state: HarnessFactoryState, questionId: string): HarnessFactoryState {
  const normalizedId = normalizeString(questionId).toLowerCase();
  return {
    ...state,
    openQuestions: state.openQuestions.filter((question) => question.id.toLowerCase() !== normalizedId),
    updatedAt: new Date().toISOString()
  };
}

export function isHarnessFactoryReadyForBuild(state: HarnessFactoryState): boolean {
  return state.openQuestions.length === 0 && Boolean(state.draft) && (state.stage === 'drafting' || state.stage === 'built' || state.stage === 'previewing' || state.stage === 'verifying');
}
