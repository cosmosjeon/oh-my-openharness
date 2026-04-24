import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAnswer, isReadyToDraft, nextQuestion, queueNextQuestion, routeFactoryPrompt } from '../src/factory';
import { createHarnessFactoryState, createHarnessFactoryStore } from '../src/factory/state';

const NOW = '2026-04-24T04:15:00.000Z';

function answerAllOpenQuestions(state: ReturnType<typeof createHarnessFactoryState>) {
  let current = state;
  for (let index = 0; index < 12 && !isReadyToDraft(current); index += 1) {
    const queued = queueNextQuestion(current, NOW);
    expect(queued.question, `expected question at iteration ${index}`).toBeDefined();
    current = applyAnswer(queued.state, {
      questionId: queued.question!.id,
      answer: `decision ${index} for ${queued.question!.id}: approval paths, MCP tools, memory scope, review checks, retry budget 2, and subagent ownership`,
      now: `2026-04-24T04:15:${String(index).padStart(2, '0')}.000Z`
    });
  }
  return current;
}

describe('Harness Factory interview engine', () => {
  test('selects one focused reference-backed question at a time', () => {
    const state = createHarnessFactoryState({
      sessionId: 'interview-focused',
      userIntent: 'Build a Codex harness with approval gates, MCP tools, state memory, review retry loops, and subagent delegation',
      targetRuntime: 'codex'
    });

    const queued = queueNextQuestion(state, NOW);

    expect(queued.readyToDraft).toBe(false);
    expect(queued.question).toBeDefined();
    expect(queued.question!.id).toStartWith('reference::');
    expect(queued.question!.question).toContain('approval');
    expect(queued.state.openQuestions).toHaveLength(1);
    expect(queued.state.referencePatterns.map((pattern) => pattern.id)).toContain('approval-gate.pre-tool-use');
    expect(queued.state.requestedCapabilities).toEqual(['approval', 'mcp', 'state', 'review', 'retry', 'subagent']);
  });

  test('applies an answer by shrinking open questions and accumulating decisions', () => {
    const initial = createHarnessFactoryState({
      sessionId: 'interview-answer',
      userIntent: 'Need approval and mcp support',
      targetRuntime: 'claude-code',
      requestedCapabilities: ['approval', 'mcp']
    });
    const queued = queueNextQuestion(initial, NOW);
    const answered = applyAnswer(queued.state, {
      questionId: queued.question!.id,
      answer: 'Require approval for shell and writes outside src; expose search and state tools through MCP.',
      now: NOW
    });

    expect(answered.openQuestions).toHaveLength(0);
    expect(answered.confirmedDecisions.map((decision) => decision.key)).toContain('approval-policy');
    expect(answered.confirmedDecisions[0]?.source).toBe('user');
    expect(nextQuestion(answered, NOW)?.id).toContain('mcp-registration');
  });

  test('detects runtime and capabilities from answers before drafting', () => {
    const initial = createHarnessFactoryState({ sessionId: 'interview-runtime', userIntent: 'Make a harness for my team' });

    const withRuntime = applyAnswer(initial, { answer: 'Target Codex with approval, MCP, and state memory.', now: NOW });

    expect(withRuntime.targetRuntime).toBe('codex');
    expect(withRuntime.requestedCapabilities).toEqual(['approval', 'mcp', 'state']);
    expect(withRuntime.confirmedDecisions.map((decision) => decision.key)).toContain('runtime.target');
    expect(isReadyToDraft(withRuntime)).toBe(false);
  });

  test('reaches readiness after all capability questions are answered', () => {
    const initial = createHarnessFactoryState({
      sessionId: 'interview-ready',
      userIntent: 'Claude harness with approval, MCP, state, review, retry, and subagent delegation',
      targetRuntime: 'claude-code'
    });

    const answered = answerAllOpenQuestions(initial);

    expect(isReadyToDraft(answered)).toBe(true);
    expect(answered.stage).toBe('drafting');
    expect(answered.openQuestions).toHaveLength(0);
    for (const key of ['approval-policy', 'mcp-scope', 'memory-scope', 'acceptance-checks', 'retry-budget', 'delegation-plan']) {
      expect(answered.confirmedDecisions.map((decision) => decision.key)).toContain(key);
    }
  });

  test('round-trips answered interview state through the file store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-factory-interview-store-'));
    const store = createHarnessFactoryStore(root);
    await store.create({ sessionId: 'store-roundtrip', userIntent: 'Need approval and review', targetRuntime: 'opencode' });

    const updated = await store.update('store-roundtrip', (state) => {
      const queued = queueNextQuestion(state, NOW);
      return applyAnswer(queued.state, { questionId: queued.question!.id, answer: 'Approval for writes and tests as review gate.', now: NOW });
    });
    const loaded = await store.load('store-roundtrip');

    expect(loaded.confirmedDecisions).toEqual(updated.confirmedDecisions);
    expect(loaded.openQuestions).toHaveLength(0);
    expect(loaded.referencePatterns.length).toBeGreaterThan(0);
  });

  test('routes future hook prompts through a pure Phase D seam', () => {
    const state = createHarnessFactoryState({
      sessionId: 'route-seam',
      userIntent: 'Codex harness with approval',
      targetRuntime: 'codex',
      requestedCapabilities: ['approval']
    });

    const route = routeFactoryPrompt(state, 'go ahead and build it');

    expect(route.route).toBe('ask-question');
    expect(route.question?.id).toStartWith('reference::');
  });
});
