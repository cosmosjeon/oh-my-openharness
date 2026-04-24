import { describe, expect, test } from 'bun:test';
import { findReferencePatterns, getReferencePattern, REFERENCE_PATTERN_REGISTRY, referenceSelectionsForCapabilities } from '../src/factory/reference';

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
});
