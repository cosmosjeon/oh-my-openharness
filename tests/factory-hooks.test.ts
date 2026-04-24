import { describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applyAnswer,
  createHarnessFactoryState,
  createHarnessFactoryStore,
  handleFactoryHook,
  handleFactoryHookStdin,
  isReadyToDraft,
  parseHookStdin,
  queueNextQuestion,
  type FactoryHookRuntimePayload,
  type HarnessFactoryState
} from '../src/factory';

const NOW = '2026-04-24T06:30:00.000Z';
const FIXTURE_DIR = join(import.meta.dir, 'fixtures', 'factory-hooks');
const EXPECTED_FIXTURES = [
  'post-tool-use.project-update.json',
  'pre-tool-use.block.json',
  'session-start.json',
  'user-prompt-submit.ask.json',
  'user-prompt-submit.build.json'
];

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'omoh-factory-hooks-'));
}

async function readFixture(name: string, stateRoot: string, cwd = stateRoot): Promise<FactoryHookRuntimePayload> {
  const raw = await readFile(join(FIXTURE_DIR, name), 'utf8');
  return JSON.parse(raw.replaceAll('__TEMP__', stateRoot).replaceAll('__CWD__', cwd)) as FactoryHookRuntimePayload;
}

function stringifyFixture(payload: FactoryHookRuntimePayload): string {
  return JSON.stringify(payload, null, 2);
}

function answerAllOpenQuestions(state: HarnessFactoryState): HarnessFactoryState {
  let current = state;
  for (let index = 0; index < 12 && !isReadyToDraft(current); index += 1) {
    const queued = queueNextQuestion(current, NOW);
    const question = queued.question;
    expect(question, `expected question at iteration ${index}`).toBeDefined();
    if (!question) throw new Error(`expected question at iteration ${index}`);
    current = applyAnswer(queued.state, {
      questionId: question.id,
      answer: `decision ${index} for ${question.id}: approval paths, MCP tools, memory scope, review checks, retry budget 2, and subagent ownership`,
      now: `2026-04-24T06:30:${String(index).padStart(2, '0')}.000Z`
    });
  }
  return current;
}

describe('Harness Factory runtime hooks', () => {
  test('parseHookStdin accepts valid JSON and preserves raw payload preview', async () => {
    const root = await tempRoot();
    const payload = await readFixture('session-start.json', root);
    const raw = stringifyFixture(payload);

    const parsed = parseHookStdin(raw);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('expected valid parse');
    expect(parsed.payload).toEqual(payload);
    expect(parsed.rawPayloadPreview).toContain('SessionStart');

    const longParsed = parseHookStdin(JSON.stringify({ hook_event_name: 'SessionStart', filler: 'x'.repeat(400) }));
    expect(longParsed.ok).toBe(true);
    if (!longParsed.ok) throw new Error('expected valid long parse');
    expect(longParsed.rawPayloadPreview.length).toBeLessThanOrEqual(241);
    expect(longParsed.rawPayloadPreview).toEndWith('…');
  });

  test('parseHookStdin returns structured error for invalid JSON without crashing', () => {
    const parsed = parseHookStdin('{bad json');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('expected invalid parse');
    expect(parsed.error.message).toContain('Invalid hook JSON');
    expect(parsed.error.rawPayloadPreview).toBe('{bad json');
  });

  test('SessionStart loads Factory state and emits next recommendation', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(root);
    await store.create({
      sessionId: 'session-start',
      userIntent: 'Build a Claude harness with approvals and MCP access',
      targetRuntime: 'claude-code',
      requestedCapabilities: ['approval', 'mcp']
    });
    const payload = await readFixture('session-start.json', root);

    const output = await handleFactoryHook(payload, NOW);

    expect(output.hookSpecificOutput).toMatchObject({ hookEventName: 'SessionStart' });
    expect(output.harnessFactory).toMatchObject({
      ok: true,
      hook: 'SessionStart',
      state: {
        sessionId: 'session-start',
        stage: 'intake',
        targetRuntime: 'claude-code',
        requestedCapabilities: ['approval', 'mcp']
      },
      recommendation: { route: 'ask-question' }
    });
    expect(JSON.stringify(output)).toContain('question');
  });

  test('UserPromptSubmit routes to ask-question when target runtime/capability decisions are missing', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(root);
    await store.create({ sessionId: 'prompt-ask', userIntent: 'Make a harness for my team' });
    const payload = await readFixture('user-prompt-submit.ask.json', root);

    const output = await handleFactoryHook(payload, NOW);
    const loaded = await store.load('prompt-ask');

    expect(output.hookSpecificOutput).toMatchObject({ hookEventName: 'UserPromptSubmit' });
    expect(output.harnessFactory).toMatchObject({
      ok: true,
      hook: 'UserPromptSubmit',
      action: { route: 'ask-question' }
    });
    expect(JSON.stringify(output)).toContain('missing decisions');
    expect(loaded.stage).toBe('interview');
    expect(loaded.openQuestions.length).toBeGreaterThan(0);
    expect(loaded.projectPath).toBeUndefined();
    expect(isReadyToDraft(loaded)).toBe(false);
  });

  test('UserPromptSubmit routes to build only when isReadyToDraft is true and user asks to build', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(root);
    const ready = answerAllOpenQuestions(createHarnessFactoryState({
      sessionId: 'prompt-build',
      userIntent: 'Codex harness with approval, MCP, state, review, retry, and subagent delegation',
      targetRuntime: 'codex'
    }));
    expect(isReadyToDraft(ready)).toBe(true);
    await store.save(ready);
    const payload = await readFixture('user-prompt-submit.build.json', root);

    const output = await handleFactoryHook(payload, NOW);
    const loaded = await store.load('prompt-build');

    expect(output.harnessFactory).toMatchObject({
      ok: true,
      hook: 'UserPromptSubmit',
      action: { route: 'build', safeToExecute: true },
      state: { sessionId: 'prompt-build', stage: 'drafting', targetRuntime: 'codex' }
    });
    expect(loaded.stage).toBe('drafting');
    expect(loaded.projectPath).toBeUndefined();
  });


  test('UserPromptSubmit does not mark export safe before a project exists', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(root);
    const ready = answerAllOpenQuestions(createHarnessFactoryState({
      sessionId: 'prompt-export-without-project',
      userIntent: 'Codex harness with approval, MCP, state, review, retry, and subagent delegation',
      targetRuntime: 'codex'
    }));
    expect(isReadyToDraft(ready)).toBe(true);
    await store.save(ready);

    const output = await handleFactoryHook({
      session_id: 'prompt-export-without-project',
      hook_event_name: 'UserPromptSubmit',
      cwd: root,
      prompt: 'export it',
      factory: { stateRoot: root }
    }, NOW);

    expect(output.harnessFactory).toMatchObject({
      ok: true,
      hook: 'UserPromptSubmit',
      action: { route: 'export', safeToExecute: false },
      state: { sessionId: 'prompt-export-without-project', stage: 'drafting' }
    });
  });

  test('PostToolUse ignores unrecognized generic path responses', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(root);
    await store.create({ sessionId: 'post-tool-generic-path', userIntent: 'Build a Claude harness', targetRuntime: 'claude-code' });

    const output = await handleFactoryHook({
      session_id: 'post-tool-generic-path',
      hook_event_name: 'PostToolUse',
      cwd: root,
      tool_name: 'Bash',
      tool_input: { command: 'cat notes.txt' },
      tool_response: { path: 'notes.txt' },
      factory: { stateRoot: root }
    }, NOW);
    const loaded = await store.load('post-tool-generic-path');

    expect(output.harnessFactory).toMatchObject({ ok: true, hook: 'PostToolUse', updated: false, updates: {} });
    expect(loaded.stage).toBe('intake');
    expect(loaded.projectPath).toBeUndefined();
  });

  test('PreToolUse blocks unsafe/out-of-order canonical project writes before Factory readiness', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(root);
    await store.create({ sessionId: 'pre-tool-block', userIntent: 'Need approval and MCP support' });
    const payload = await readFixture('pre-tool-use.block.json', root);

    const output = await handleFactoryHook(payload, NOW);
    const loaded = await store.load('pre-tool-block');

    expect(output.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny'
    });
    expect(JSON.stringify(output)).toContain('out-of-order canonical project mutation');
    expect(output.harnessFactory).toMatchObject({ ok: false, hook: 'PreToolUse', guard: 'blocked' });
    expect(loaded.stage).toBe('intake');
    expect(loaded.projectPath).toBeUndefined();
  });

  test('PostToolUse persists projectPath and stage when a recognized project materialization result is observed', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(root);
    await store.create({ sessionId: 'post-tool-project', userIntent: 'Build a Claude harness', targetRuntime: 'claude-code' });
    const payload = await readFixture('post-tool-use.project-update.json', root, root);

    const output = await handleFactoryHook(payload, NOW);
    const loaded = await store.load('post-tool-project');

    expect(output.hookSpecificOutput).toMatchObject({ hookEventName: 'PostToolUse' });
    expect(output.harnessFactory).toMatchObject({
      ok: true,
      hook: 'PostToolUse',
      updated: true,
      updates: { projectPath: resolve(root, 'factory-built-project') },
      state: { stage: 'built', projectPath: resolve(root, 'factory-built-project') }
    });
    expect(loaded.stage).toBe('built');
    expect(loaded.projectPath).toBe(resolve(root, 'factory-built-project'));
  });

  test('handleFactoryHookStdin returns deterministic host-valid JSON stdout for fixtures', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(root);
    await store.create({ sessionId: 'session-start', userIntent: 'Claude harness with approval', targetRuntime: 'claude-code', requestedCapabilities: ['approval'] });
    await store.create({ sessionId: 'prompt-ask', userIntent: 'Make a harness for my team' });
    await store.save(answerAllOpenQuestions(createHarnessFactoryState({
      sessionId: 'prompt-build',
      userIntent: 'Codex harness with approval, MCP, state, review, retry, and subagent delegation',
      targetRuntime: 'codex'
    })));
    await store.create({ sessionId: 'pre-tool-block', userIntent: 'Need approval and MCP support' });
    await store.create({ sessionId: 'post-tool-project', userIntent: 'Build a Claude harness', targetRuntime: 'claude-code' });

    for (const name of EXPECTED_FIXTURES) {
      const payload = await readFixture(name, root, root);
      const result = await handleFactoryHookStdin(stringifyFixture(payload), NOW);
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;

      expect(result.exitCode).toBe(0);
      expect(parsed).toHaveProperty('hookSpecificOutput');
      expect(parsed).toHaveProperty('harnessFactory');
      expect(result.stdout).toEndWith('\n');
    }
  });

  test('fixture coverage exercises every required factory hook fixture', async () => {
    const fixtureNames = (await readdir(FIXTURE_DIR)).filter((name) => name.endsWith('.json')).sort();

    expect(fixtureNames).toEqual(EXPECTED_FIXTURES);
    for (const name of fixtureNames) {
      const raw = await readFile(join(FIXTURE_DIR, name), 'utf8');
      const parsed = parseHookStdin(raw);
      expect(parsed.ok, `${name} should parse`).toBe(true);
    }
  });
});
