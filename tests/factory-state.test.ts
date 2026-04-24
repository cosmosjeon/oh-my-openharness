import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHarnessFactoryState, createHarnessFactoryStore, validateHarnessFactoryState } from '../src/factory/state';

describe('Harness Factory state schema/store', () => {
  test('creates the minimum persistent factory state shape', () => {
    const state = createHarnessFactoryState({
      sessionId: 'session-1',
      userIntent: 'Build a harness with approvals, MCP, and memory',
      targetRuntime: 'claude-code',
      requestedCapabilities: ['approval', 'mcp', 'state', 'approval'],
      openQuestions: [{ id: 'q-runtime-risk', question: 'Which tools need approval?', reason: 'approval scope', priority: 10 }],
      confirmedDecisions: [{ key: 'audience', value: 'platform team', source: 'user' }]
    });

    expect(state.schemaVersion).toBe('0.1.0');
    expect(state.stage).toBe('intake');
    expect(state.requestedCapabilities).toEqual(['approval', 'mcp', 'state']);
    expect(state.openQuestions[0]?.createdAt).toBeString();
    expect(state.confirmedDecisions[0]?.createdAt).toBeString();
    expect(state.draftGraphSpec).toEqual({ nodes: [], edges: [], runtimeIntents: [], skills: [] });
    expect(state.preview.status).toBe('not-opened');
    expect(state.verification.status).toBe('not-run');
  });

  test('round-trips state through the file store and validates updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-factory-state-'));
    const store = createHarnessFactoryStore(root);
    await store.create({ sessionId: 'roundtrip', userIntent: 'Need review loop', requestedCapabilities: ['review'] });

    const updated = await store.update('roundtrip', (state) => ({
      stage: 'interview',
      targetRuntime: 'codex',
      confirmedDecisions: [...state.confirmedDecisions, { key: 'retryBudget', value: 2, source: 'user', createdAt: state.createdAt }]
    }));

    const loaded = await store.load('roundtrip');
    expect(loaded.stage).toBe('interview');
    expect(loaded.targetRuntime).toBe('codex');
    expect(updated.confirmedDecisions[0]?.key).toBe('retryBudget');
    expect(store.statePath('roundtrip')).toEndWith('roundtrip.json');
  });

  test('rejects invalid runtime and unsafe session ids', async () => {
    expect(() => validateHarnessFactoryState({ schemaVersion: '0.1.0', sessionId: 'x', stage: 'intake', userIntent: 'x', targetRuntime: 'bad-runtime' })).toThrow('targetRuntime');
    const store = createHarnessFactoryStore('/tmp/factory-state-test');
    await expect(store.create({ sessionId: '../escape', userIntent: 'bad' })).rejects.toThrow('session id');
  });
});
