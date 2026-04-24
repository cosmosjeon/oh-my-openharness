import type { RuntimeTarget } from '../../core/types';
import type { HarnessFactoryQuestion, HarnessFactoryReferencePatternSelection } from '../state';
import { getReferencePattern, type ReferencePatternCategory, type ReferencePatternRecord } from './catalog';
import { findReferencePatterns, type ReferencePatternMatch } from './search';

export interface ReferenceInterviewQuestionTemplate {
  category: ReferencePatternCategory;
  capability: string;
  decisionKey: string;
  priority: number;
  buildQuestion(targetRuntime?: RuntimeTarget): string;
  buildReason(pattern: ReferencePatternRecord): string;
}

export interface ReferenceInterviewQuestion extends HarnessFactoryQuestion {
  patternId: string;
  category: ReferencePatternCategory;
  capability: string;
  decisionKey: string;
  sourceRepo: string;
}

export interface BuildReferenceInterviewQuestionsInput {
  intent?: string;
  capabilities?: string[];
  targetRuntime?: RuntimeTarget;
  referencePatterns?: HarnessFactoryReferencePatternSelection[];
  existingQuestionIds?: string[];
  answeredQuestionIds?: string[];
  confirmedDecisionKeys?: string[];
  limit?: number;
  now?: string;
}

const REFERENCE_INTERVIEW_QUESTION_PREFIX = 'reference::';

const REFERENCE_INTERVIEW_QUESTION_TEMPLATES: Record<ReferencePatternCategory, ReferenceInterviewQuestionTemplate> = {
  'approval-gate': {
    category: 'approval-gate',
    capability: 'approval',
    decisionKey: 'approval-policy',
    priority: 100,
    buildQuestion: () => 'Which actions should stop for explicit approval before the harness runs them?',
    buildReason: (pattern) => `${pattern.name} adds a human safety checkpoint for risky or policy-bound actions.`
  },
  'review-loop': {
    category: 'review-loop',
    capability: 'review',
    decisionKey: 'acceptance-checks',
    priority: 90,
    buildQuestion: () => 'What checks should the harness run before it considers the work done?',
    buildReason: (pattern) => `${pattern.name} needs explicit acceptance criteria so review and repair loops can terminate cleanly.`
  },
  'mcp-registration': {
    category: 'mcp-registration',
    capability: 'mcp',
    decisionKey: 'mcp-scope',
    priority: 95,
    buildQuestion: (targetRuntime) => targetRuntime
      ? `For ${targetRuntime}, which tools or resources should be exposed through the MCP boundary?`
      : 'Which tools or resources should be exposed through the MCP boundary?',
    buildReason: (pattern) => `${pattern.name} requires a clear MCP surface before the harness can register tools or resources.`
  },
  'state-persistence': {
    category: 'state-persistence',
    capability: 'state',
    decisionKey: 'memory-scope',
    priority: 85,
    buildQuestion: () => 'What decisions or progress should the harness remember between prompts, retries, or resumed sessions?',
    buildReason: (pattern) => `${pattern.name} needs a concrete persistence scope to resume safely without storing too much.`
  },
  'retry-loop': {
    category: 'retry-loop',
    capability: 'retry',
    decisionKey: 'retry-budget',
    priority: 80,
    buildQuestion: () => 'When a check fails, how should the harness retry and when should it stop escalating?',
    buildReason: (pattern) => `${pattern.name} only works when retryable failures and stop conditions are explicit.`
  },
  'subagent-delegation': {
    category: 'subagent-delegation',
    capability: 'subagent',
    decisionKey: 'delegation-plan',
    priority: 75,
    buildQuestion: () => 'Which parts of the job should be delegated to specialized subagents, and what ownership boundaries should they keep?',
    buildReason: (pattern) => `${pattern.name} benefits from role boundaries so parallel work does not conflict.`
  }
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function sourceRepoForPattern(pattern: ReferencePatternRecord, selections: HarnessFactoryReferencePatternSelection[]): string {
  return selections.find((selection) => selection.id === pattern.id)?.sourceRepo ?? pattern.sourceRepos[0]?.repo ?? 'unknown';
}

function matchesFromSelections(referencePatterns: HarnessFactoryReferencePatternSelection[]): ReferencePatternMatch[] {
  return referencePatterns.flatMap((selection) => {
    const pattern = getReferencePattern(selection.id);
    if (!pattern) return [];
    return [{
      pattern,
      score: selection.score ?? 0,
      why: selection.why || `selected:${pattern.category}`
    } satisfies ReferencePatternMatch];
  });
}

export function getReferenceInterviewQuestionTemplate(category: ReferencePatternCategory): ReferenceInterviewQuestionTemplate {
  return REFERENCE_INTERVIEW_QUESTION_TEMPLATES[category];
}

export function referenceInterviewQuestionId(patternId: string, decisionKey: string): string {
  return `${REFERENCE_INTERVIEW_QUESTION_PREFIX}${patternId}::${decisionKey}`;
}

export interface ParsedReferenceInterviewQuestionId {
  patternId: string;
  decisionKey: string;
  category?: ReferencePatternCategory;
}

export function parseReferenceInterviewQuestionId(questionId: string): ParsedReferenceInterviewQuestionId | undefined {
  if (!questionId.startsWith(REFERENCE_INTERVIEW_QUESTION_PREFIX)) return undefined;
  const trimmed = questionId.slice(REFERENCE_INTERVIEW_QUESTION_PREFIX.length);
  const parts = trimmed.split('::');
  if (parts.length !== 2) return undefined;

  const [patternId, decisionKey] = parts;
  if (!patternId || !decisionKey) return undefined;

  const pattern = getReferencePattern(patternId);
  return {
    patternId,
    decisionKey,
    ...(pattern ? { category: pattern.category } : {})
  };
}

export function buildReferenceInterviewQuestions(input: BuildReferenceInterviewQuestionsInput): ReferenceInterviewQuestion[] {
  const searchLimit = Math.max(input.limit ?? 6, 6);
  const matches = input.referencePatterns && input.referencePatterns.length > 0
    ? matchesFromSelections(input.referencePatterns)
    : findReferencePatterns({
        intent: input.intent,
        capabilities: input.capabilities,
        targetRuntime: input.targetRuntime,
        limit: searchLimit
      });

  const existingQuestionIds = new Set((input.existingQuestionIds ?? []).map(normalize));
  const answeredQuestionIds = new Set((input.answeredQuestionIds ?? []).map(normalize));
  const confirmedDecisionKeys = new Set((input.confirmedDecisionKeys ?? []).map(normalize));
  const now = input.now ?? new Date().toISOString();
  const seenIds = new Set<string>();

  return matches
    .flatMap((match) => {
      const template = getReferenceInterviewQuestionTemplate(match.pattern.category);
      const questionId = referenceInterviewQuestionId(match.pattern.id, template.decisionKey);
      const normalizedQuestionId = normalize(questionId);
      if (seenIds.has(normalizedQuestionId)) return [];
      if (existingQuestionIds.has(normalizedQuestionId) || answeredQuestionIds.has(normalizedQuestionId)) return [];
      if (confirmedDecisionKeys.has(normalize(template.decisionKey))) return [];
      seenIds.add(normalizedQuestionId);

      const sourceRepo = sourceRepoForPattern(match.pattern, input.referencePatterns ?? []);
      const why = match.why === 'fallback: seeded reference pattern' ? 'selected seeded reference pattern' : match.why;

      return [{
        id: questionId,
        question: template.buildQuestion(input.targetRuntime),
        reason: `${template.buildReason(match.pattern)} Source: ${sourceRepo}. Match: ${why}.`,
        priority: template.priority + Math.max(match.score, 0),
        createdAt: now,
        patternId: match.pattern.id,
        category: match.pattern.category,
        capability: template.capability,
        decisionKey: template.decisionKey,
        sourceRepo
      } satisfies ReferenceInterviewQuestion];
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, input.limit ?? 6);
}
