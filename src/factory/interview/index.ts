import type { RuntimeTarget } from '../../core/types';
import {
  buildReferenceInterviewQuestions,
  findReferencePatterns,
  getReferencePattern,
  parseReferenceInterviewQuestionId,
  referenceSelectionsForCapabilities
} from '../reference';
import {
  withFactoryStateUpdate,
  type HarnessFactoryDecision,
  type HarnessFactoryDecisionSource,
  type HarnessFactoryQuestion,
  type HarnessFactoryReferencePatternSelection,
  type HarnessFactoryState
} from '../state';

export type InterviewCapability = 'approval' | 'mcp' | 'state' | 'review' | 'retry' | 'subagent';

export interface QueueNextQuestionResult {
  state: HarnessFactoryState;
  question?: HarnessFactoryQuestion;
  readyToDraft: boolean;
}

export interface ApplyInterviewAnswerInput {
  answer: string;
  questionId?: string;
  now?: string;
  source?: HarnessFactoryDecisionSource;
}

interface CapabilityQuestionConfig {
  capability: InterviewCapability;
  decisionKey: string;
  priority: number;
  fallbackQuestion: string;
  fallbackReason: string;
}

const CAPABILITY_QUESTION_CONFIG: Record<InterviewCapability, CapabilityQuestionConfig> = {
  approval: {
    capability: 'approval',
    decisionKey: 'approval-policy',
    priority: 90,
    fallbackQuestion: 'Which actions or file paths should require approval before the harness continues?',
    fallbackReason: 'Approval scope affects how the harness handles risky actions.'
  },
  mcp: {
    capability: 'mcp',
    decisionKey: 'mcp-scope',
    priority: 80,
    fallbackQuestion: 'What tools or resources should the harness expose through MCP?',
    fallbackReason: 'The draft needs a concrete MCP surface before build-time synthesis.'
  },
  state: {
    capability: 'state',
    decisionKey: 'memory-scope',
    priority: 70,
    fallbackQuestion: 'What state should persist between sessions, and where should the harness store it?',
    fallbackReason: 'Persistence decisions shape the state read/write path in the draft graph.'
  },
  review: {
    capability: 'review',
    decisionKey: 'acceptance-checks',
    priority: 60,
    fallbackQuestion: 'What review or verification steps must run before the harness is done?',
    fallbackReason: 'A review loop needs explicit acceptance criteria.'
  },
  retry: {
    capability: 'retry',
    decisionKey: 'retry-budget',
    priority: 50,
    fallbackQuestion: 'Which failures are retryable, and what retry budget or stop condition should the harness use?',
    fallbackReason: 'Retry loops need bounded failure handling before the draft is buildable.'
  },
  subagent: {
    capability: 'subagent',
    decisionKey: 'delegation-plan',
    priority: 40,
    fallbackQuestion: 'Which work should be delegated to subagents, and what ownership boundaries should they follow?',
    fallbackReason: 'Delegation needs clear ownership to keep generated flows safe.'
  }
};

const CAPABILITY_ALIASES: Record<InterviewCapability, string[]> = {
  approval: ['approval', 'approve', 'permission', 'guardrail', 'safety'],
  mcp: ['mcp', 'tool server', 'resource', 'registration'],
  state: ['state', 'memory', 'persistence', 'checkpoint', 'resume'],
  review: ['review', 'qa', 'verify', 'verification', 'quality gate'],
  retry: ['retry', 'recovery', 'try again', 'loop'],
  subagent: ['subagent', 'delegate', 'delegation', 'parallel', 'role']
};

const CAPABILITY_PRIORITY = Object.values(CAPABILITY_QUESTION_CONFIG)
  .sort((left, right) => right.priority - left.priority)
  .map((config) => config.capability);

const RUNTIME_PATTERNS: Array<{ runtime: RuntimeTarget; phrases: string[] }> = [
  { runtime: 'claude-code', phrases: ['claude code', 'claude'] },
  { runtime: 'opencode', phrases: ['opencode', 'open code'] },
  { runtime: 'codex', phrases: ['codex'] }
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesPhrase(text: string, phrase: string): boolean {
  const pattern = escapeRegExp(normalize(phrase)).replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${pattern}\\b`, 'i').test(text);
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function sortQuestions(questions: HarnessFactoryQuestion[]): HarnessFactoryQuestion[] {
  return [...questions].sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt));
}

function hasDecision(state: HarnessFactoryState, key: string): boolean {
  return state.confirmedDecisions.some((decision) => decision.key === key);
}

function upsertDecision(
  decisions: HarnessFactoryDecision[],
  key: string,
  value: unknown,
  source: HarnessFactoryDecisionSource,
  now: string
): HarnessFactoryDecision[] {
  const nextDecision: HarnessFactoryDecision = { key, value, source, createdAt: now };
  return [...decisions.filter((decision) => decision.key !== key), nextDecision];
}

function capabilityFromCategory(category: string): InterviewCapability | undefined {
  if (category === 'approval-gate') return 'approval';
  if (category === 'mcp-registration') return 'mcp';
  if (category === 'state-persistence') return 'state';
  if (category === 'review-loop') return 'review';
  if (category === 'retry-loop') return 'retry';
  if (category === 'subagent-delegation') return 'subagent';
  return undefined;
}

function canonicalizeCapability(value: string): InterviewCapability | undefined {
  const normalized = normalize(value);
  for (const capability of Object.keys(CAPABILITY_ALIASES) as InterviewCapability[]) {
    if (capability === normalized) return capability;
    if (CAPABILITY_ALIASES[capability].some((alias) => includesPhrase(normalized, alias) || alias === normalized)) return capability;
  }
  return capabilityFromCategory(normalized);
}

function normalizeCapabilities(capabilities: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const capability of capabilities) {
    const canonical = canonicalizeCapability(capability) ?? normalize(capability);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    normalized.push(canonical);
  }

  return normalized;
}

function extractCapabilitiesFromText(text: string): InterviewCapability[] {
  const normalized = normalize(text);
  const matches: InterviewCapability[] = [];

  for (const capability of Object.keys(CAPABILITY_ALIASES) as InterviewCapability[]) {
    if (CAPABILITY_ALIASES[capability].some((alias) => includesPhrase(normalized, alias))) matches.push(capability);
  }

  return dedupe(matches);
}

function extractRuntimeFromText(text: string): RuntimeTarget | undefined {
  const normalized = normalize(text);
  return RUNTIME_PATTERNS.find(({ phrases }) => phrases.some((phrase) => includesPhrase(normalized, phrase)))?.runtime;
}

function mergeReferenceSelections(
  existing: HarnessFactoryReferencePatternSelection[],
  inferred: HarnessFactoryReferencePatternSelection[]
): HarnessFactoryReferencePatternSelection[] {
  const merged = new Map<string, HarnessFactoryReferencePatternSelection>();
  for (const selection of [...existing, ...inferred]) {
    if (!merged.has(selection.id)) merged.set(selection.id, selection);
  }
  return [...merged.values()];
}

function inferredReferenceSelections(state: HarnessFactoryState): HarnessFactoryReferencePatternSelection[] {
  return referenceSelectionsForCapabilities({
    intent: state.userIntent,
    capabilities: state.requestedCapabilities,
    targetRuntime: state.targetRuntime,
    limit: 6
  });
}

function referenceSelectionsForState(state: HarnessFactoryState): HarnessFactoryReferencePatternSelection[] {
  return mergeReferenceSelections(state.referencePatterns, inferredReferenceSelections(state));
}

function capabilitiesForState(state: HarnessFactoryState): InterviewCapability[] {
  const capabilities: InterviewCapability[] = [];

  for (const capability of state.requestedCapabilities) {
    const canonical = canonicalizeCapability(capability);
    if (canonical) capabilities.push(canonical);
  }

  for (const capability of extractCapabilitiesFromText(state.userIntent)) capabilities.push(capability);

  for (const selection of referenceSelectionsForState(state)) {
    const pattern = getReferencePattern(selection.id);
    if (!pattern) continue;
    const fromCategory = capabilityFromCategory(pattern.category);
    if (fromCategory) capabilities.push(fromCategory);
    for (const capability of pattern.capabilities) {
      const canonical = canonicalizeCapability(capability);
      if (canonical) capabilities.push(canonical);
    }
  }

  return CAPABILITY_PRIORITY.filter((capability) => dedupe(capabilities).includes(capability));
}

function needsCapabilityDiscovery(state: HarnessFactoryState): boolean {
  return capabilitiesForState(state).length === 0 && !hasDecision(state, 'capabilities.selected');
}

function capabilityQuestionId(capability: InterviewCapability): string {
  return `capability.${capability}`;
}

function questionTextForCapability(capability: InterviewCapability, state: HarnessFactoryState) {
  const config = CAPABILITY_QUESTION_CONFIG[capability];
  const resolvedSelections = referenceSelectionsForState(state);

  for (const selection of resolvedSelections) {
    const pattern = getReferencePattern(selection.id);
    if (!pattern) continue;
    const matchesCapability = capabilityFromCategory(pattern.category) === capability
      || pattern.capabilities.some((entry) => canonicalizeCapability(entry) === capability);
    if (!matchesCapability) continue;

    return {
      question: pattern.applicability.followUpQuestions[0] ?? config.fallbackQuestion,
      reason: `${pattern.summary} (${selection.why})`
    };
  }

  const fallbackPattern = findReferencePatterns({
    intent: state.userIntent,
    capabilities: [capability],
    targetRuntime: state.targetRuntime,
    limit: 1
  })[0]?.pattern;

  return {
    question: fallbackPattern?.applicability.followUpQuestions[0] ?? config.fallbackQuestion,
    reason: fallbackPattern?.summary ?? config.fallbackReason
  };
}

function generatedQuestion(state: HarnessFactoryState, now: string): HarnessFactoryQuestion | undefined {
  if (!state.targetRuntime) {
    return {
      id: 'runtime.target',
      question: 'Which runtime should the harness target: Claude Code, OpenCode, or Codex?',
      reason: 'The factory draft cannot materialize until the target runtime is chosen.',
      priority: 100,
      createdAt: now
    };
  }

  if (needsCapabilityDiscovery(state)) {
    return {
      id: 'capabilities.requested',
      question: 'Which core capabilities should the harness include first: approval, MCP, state persistence, review, retry, or subagent delegation?',
      reason: 'The interview needs at least one concrete capability to turn intent into a focused draft.',
      priority: 95,
      createdAt: now
    };
  }

  const referenceQuestion = buildReferenceInterviewQuestions({
    intent: state.userIntent,
    capabilities: capabilitiesForState(state),
    targetRuntime: state.targetRuntime,
    referencePatterns: referenceSelectionsForState(state),
    existingQuestionIds: state.openQuestions.filter((question) => !question.answeredAt).map((question) => question.id),
    answeredQuestionIds: state.openQuestions.filter((question) => question.answeredAt).map((question) => question.id),
    confirmedDecisionKeys: state.confirmedDecisions.map((decision) => decision.key),
    limit: 1,
    now
  })[0];
  if (referenceQuestion) return referenceQuestion;

  for (const capability of capabilitiesForState(state)) {
    const config = CAPABILITY_QUESTION_CONFIG[capability];
    if (hasDecision(state, config.decisionKey)) continue;
    const prompt = questionTextForCapability(capability, state);
    return {
      id: capabilityQuestionId(capability),
      question: prompt.question,
      reason: prompt.reason,
      priority: config.priority,
      createdAt: now
    };
  }

  return undefined;
}

function activeOpenQuestion(state: HarnessFactoryState): HarnessFactoryQuestion | undefined {
  return sortQuestions(state.openQuestions).find((question) => !question.answeredAt);
}

function resolveActiveQuestion(state: HarnessFactoryState, now: string, questionId?: string): HarnessFactoryQuestion | undefined {
  if (questionId) return state.openQuestions.find((question) => question.id === questionId) ?? generatedQuestion(state, now);
  return activeOpenQuestion(state) ?? generatedQuestion(state, now);
}

function withInterviewContext(state: HarnessFactoryState, now: string): HarnessFactoryState {
  const requestedCapabilities = normalizeCapabilities([...state.requestedCapabilities, ...capabilitiesForState(state)]);
  const contextualState = { ...state, requestedCapabilities };
  return withFactoryStateUpdate(
    state,
    {
      requestedCapabilities,
      referencePatterns: referenceSelectionsForState(contextualState)
    },
    now
  );
}

export function nextQuestion(state: HarnessFactoryState, now = new Date().toISOString()): HarnessFactoryQuestion | undefined {
  const prepared = withInterviewContext(state, now);
  return activeOpenQuestion(prepared) ?? generatedQuestion(prepared, now);
}

export function queueNextQuestion(state: HarnessFactoryState, now = new Date().toISOString()): QueueNextQuestionResult {
  const prepared = withInterviewContext(state, now);
  const openQuestion = activeOpenQuestion(prepared);
  if (openQuestion) {
    return {
      state: withFactoryStateUpdate(prepared, { stage: 'interview' }, now),
      question: openQuestion,
      readyToDraft: false
    };
  }

  const question = generatedQuestion(prepared, now);
  if (!question) {
    return {
      state: withFactoryStateUpdate(prepared, { stage: 'drafting' }, now),
      readyToDraft: true
    };
  }

  return {
    state: withFactoryStateUpdate(prepared, { stage: 'interview', openQuestions: [...prepared.openQuestions, question] }, now),
    question,
    readyToDraft: false
  };
}

function applyDecisionForQuestion(
  state: HarnessFactoryState,
  questionId: string,
  answer: string,
  now: string,
  source: HarnessFactoryDecisionSource
): HarnessFactoryState {
  const trimmedAnswer = answer.trim();
  const extractedCapabilities = extractCapabilitiesFromText(trimmedAnswer);
  const requestedCapabilities = normalizeCapabilities([...state.requestedCapabilities, ...extractedCapabilities]);
  const extractedRuntime = extractRuntimeFromText(trimmedAnswer);
  const openQuestions = state.openQuestions.filter((question) => question.id !== questionId);

  let targetRuntime = extractedRuntime ?? state.targetRuntime;
  let confirmedDecisions = state.confirmedDecisions;

  if (questionId === 'runtime.target') {
    targetRuntime = extractedRuntime ?? state.targetRuntime;
    confirmedDecisions = upsertDecision(
      confirmedDecisions,
      'runtime.target',
      targetRuntime ?? trimmedAnswer,
      source,
      now
    );
  } else if (questionId === 'capabilities.requested') {
    confirmedDecisions = upsertDecision(
      confirmedDecisions,
      'capabilities.selected',
      extractedCapabilities.length > 0 ? requestedCapabilities : trimmedAnswer,
      source,
      now
    );
  } else {
    const parsedReferenceQuestion = parseReferenceInterviewQuestionId(questionId);
    if (parsedReferenceQuestion) {
      const capability = parsedReferenceQuestion.category ? capabilityFromCategory(parsedReferenceQuestion.category) : undefined;
      if (capability && !requestedCapabilities.includes(capability)) requestedCapabilities.push(capability);
      confirmedDecisions = upsertDecision(confirmedDecisions, parsedReferenceQuestion.decisionKey, trimmedAnswer, source, now);
    } else if (questionId.startsWith('capability.')) {
      const capability = questionId.slice('capability.'.length) as InterviewCapability;
      const config = CAPABILITY_QUESTION_CONFIG[capability];
      if (config) confirmedDecisions = upsertDecision(confirmedDecisions, config.decisionKey, trimmedAnswer, source, now);
    } else {
      confirmedDecisions = upsertDecision(confirmedDecisions, `interview.${questionId}`, trimmedAnswer, source, now);
    }
  }

  return withFactoryStateUpdate(
    state,
    {
      ...(targetRuntime ? { targetRuntime } : {}),
      requestedCapabilities,
      confirmedDecisions,
      openQuestions,
      referencePatterns: mergeReferenceSelections(
        state.referencePatterns,
        referenceSelectionsForCapabilities({
          intent: state.userIntent,
          capabilities: requestedCapabilities,
          targetRuntime,
          limit: 6
        })
      )
    },
    now
  );
}

export function applyAnswer(
  state: HarnessFactoryState,
  answerOrInput: string | ApplyInterviewAnswerInput,
  nowOverride?: string
): HarnessFactoryState {
  const input: ApplyInterviewAnswerInput = typeof answerOrInput === 'string'
    ? { answer: answerOrInput, ...(nowOverride ? { now: nowOverride } : {}) }
    : answerOrInput;
  const now = input.now ?? nowOverride ?? new Date().toISOString();
  const primed = queueNextQuestion(state, now).state;
  const activeQuestion = resolveActiveQuestion(primed, now, input.questionId);
  if (!activeQuestion) return withFactoryStateUpdate(primed, { stage: isReadyToDraft(primed) ? 'drafting' : 'interview' }, now);

  const updated = applyDecisionForQuestion(primed, activeQuestion.id, input.answer, now, input.source ?? 'user');
  return withFactoryStateUpdate(updated, { stage: isReadyToDraft(updated) ? 'drafting' : 'interview' }, now);
}

export function isReadyToDraft(state: HarnessFactoryState): boolean {
  const prepared = withInterviewContext(state, state.updatedAt);
  if (!prepared.targetRuntime) return false;
  if (activeOpenQuestion(prepared)) return false;
  if (needsCapabilityDiscovery(prepared)) return false;
  return capabilitiesForState(prepared).every((capability) => hasDecision(prepared, CAPABILITY_QUESTION_CONFIG[capability].decisionKey));
}
