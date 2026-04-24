import { describe, expect, test } from 'bun:test';
import {
  buildReferenceInterviewQuestions,
  findReferencePatterns,
  getReferencePattern,
  parseReferenceInterviewQuestionId,
  REFERENCE_PATTERN_REGISTRY,
  referenceInterviewQuestionId,
  referenceSelectionsForCapabilities
} from '../src/factory/reference';

describe('Harness Factory reference pattern registry', () => {
  test('contains the first six seeded reference patterns with provenance', () => {
    expect(REFERENCE_PATTERN_REGISTRY.map((pattern) => pattern.category).sort()).toEqual([
      'approval-gate',
      'mcp-registration',
      'retry-loop',
      'review-loop',
      'state-persistence',
      'subagent-delegation'
    ]);
    for (const pattern of REFERENCE_PATTERN_REGISTRY) {
      expect(pattern.extraction.mode).toBe('manual-seed');
      expect(pattern.sourceRepos.length).toBeGreaterThanOrEqual(2);
      expect(pattern.primitives.length).toBeGreaterThan(0);
    }
  });

  test('retrieves capability-matched patterns with source provenance', () => {
    const matches = findReferencePatterns({
      intent: 'I need approvals, MCP tool registration, state memory, retry loops, and subagent delegation',
      capabilities: ['approval', 'mcp', 'state', 'retry', 'subagent'],
      targetRuntime: 'claude-code',
      limit: 6
    });

    expect(matches.map((match) => match.pattern.category)).toContain('approval-gate');
    expect(matches.map((match) => match.pattern.category)).toContain('mcp-registration');
    expect(matches.map((match) => match.pattern.category)).toContain('state-persistence');
    expect(matches[0]?.score).toBeGreaterThan(0);
    expect(matches[0]?.why).toContain('runtime:claude-code');
  });

  test('maps matches into compact state selections', () => {
    const selections = referenceSelectionsForCapabilities({ capabilities: ['review'], limit: 1 });
    expect(selections).toHaveLength(1);
    const selected = selections[0];
    expect(selected).toBeDefined();
    expect(getReferencePattern(selected!.id)?.id).toBe(selected!.id);
    expect(selected!.sourceRepo).toBeString();
  });

  test('builds deterministic interview questions from reference matches', () => {
    const questions = buildReferenceInterviewQuestions({
      intent: 'Build a codex harness with approvals, MCP tools, state memory, review gates, retry logic, and subagents',
      capabilities: ['approval', 'mcp', 'state', 'review', 'retry', 'subagent'],
      targetRuntime: 'codex',
      limit: 6,
      now: '2026-04-24T03:30:00.000Z'
    });

    expect(questions.map((question) => question.category)).toEqual([
      'approval-gate',
      'mcp-registration',
      'review-loop',
      'state-persistence',
      'retry-loop',
      'subagent-delegation'
    ]);
    expect(questions[1]?.question).toContain('For codex');
    expect(questions.every((question) => question.createdAt === '2026-04-24T03:30:00.000Z')).toBe(true);
    expect(parseReferenceInterviewQuestionId(questions[0]!.id)).toEqual({
      patternId: questions[0]!.patternId,
      decisionKey: questions[0]!.decisionKey,
      category: questions[0]!.category
    });
  });

  test('falls through to the next reference question when a top decision is already confirmed', () => {
    const questions = buildReferenceInterviewQuestions({
      intent: 'Need approval and mcp support',
      capabilities: ['approval', 'mcp'],
      confirmedDecisionKeys: ['approval-policy'],
      targetRuntime: 'claude-code',
      limit: 1,
      now: '2026-04-24T03:31:00.000Z'
    });

    expect(questions).toHaveLength(1);
    expect(questions[0]?.category).toBe('mcp-registration');
  });

  test('skips already-open or answered reference questions from selected patterns', () => {
    const selections = referenceSelectionsForCapabilities({ capabilities: ['approval', 'mcp', 'state'], limit: 3 });
    const initial = buildReferenceInterviewQuestions({
      referencePatterns: selections,
      limit: 3,
      now: '2026-04-24T03:32:00.000Z'
    });

    const filtered = buildReferenceInterviewQuestions({
      referencePatterns: selections,
      existingQuestionIds: [initial[0]!.id],
      answeredQuestionIds: [initial[1]!.id],
      confirmedDecisionKeys: [initial[2]!.decisionKey],
      limit: 3,
      now: '2026-04-24T03:32:00.000Z'
    });

    expect(filtered).toHaveLength(0);
  });

  test('round-trips stable reference question ids', () => {
    const id = referenceInterviewQuestionId('approval-gate.pre-tool-use', 'approval-policy');
    expect(parseReferenceInterviewQuestionId(id)).toEqual({
      patternId: 'approval-gate.pre-tool-use',
      decisionKey: 'approval-policy',
      category: 'approval-gate'
    });
    expect(parseReferenceInterviewQuestionId('plain-question-id')).toBeUndefined();
  });
});
