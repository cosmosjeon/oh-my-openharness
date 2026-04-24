import { describe, expect, test } from 'bun:test';
import { exists, readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileCanonicalProject, materializeFactoryDraft, orchestrateFactoryAction } from '../src/factory/actions';
import { enrichStateWithReferencePatterns, synthesizeDraftGraphSpec } from '../src/factory/synthesis';
import { applyAnswer, isReadyToDraft, queueNextQuestion } from '../src/factory/interview';
import { createHarnessFactoryState, createHarnessFactoryStore, type HarnessFactoryState } from '../src/factory/state';
import { loadHarnessProject } from '../src/core/project';


function answerAllFactoryQuestions(state: HarnessFactoryState): HarnessFactoryState {
  let current = state;
  for (let index = 0; index < 12 && !isReadyToDraft(current); index += 1) {
    const queued = queueNextQuestion(current, `2026-04-24T08:20:${String(index).padStart(2, '0')}.000Z`);
    const question = queued.question;
    expect(question).toBeDefined();
    if (!question) throw new Error(`expected question at iteration ${index}`);
    current = applyAnswer(queued.state, {
      questionId: question.id,
      answer: `Answer ${index}: approval for risky writes, MCP search/state tools, memory in .factory/state, tests plus review, retry budget 2, executor/verifier subagents.`,
      now: `2026-04-24T08:21:${String(index).padStart(2, '0')}.000Z`
    });
  }
  expect(isReadyToDraft(current)).toBe(true);
  return current;
}

async function createReadyFactorySession(root: string, sessionId: string): Promise<ReturnType<typeof createHarnessFactoryStore>> {
  const store = createHarnessFactoryStore(join(root, 'factory-state'));
  await store.save(answerAllFactoryQuestions(createHarnessFactoryState({
    sessionId,
    userIntent: 'Create a Claude harness with approval gates, MCP registration, state memory, review retry loop, and subagent delegation',
    targetRuntime: 'claude-code'
  })));
  return store;
}

describe('Harness Factory minimal vertical integration', () => {
  test('turns factory state and reference patterns into a canonical project through substrate adapters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-factory-integration-'));
    const initial = createHarnessFactoryState({
      sessionId: 'vertical-slice',
      userIntent: 'Create a harness with approval gates, MCP server registration, persistent memory, review retry loop, and subagent delegation',
      targetRuntime: 'claude-code',
      requestedCapabilities: ['approval', 'mcp', 'state', 'review', 'retry', 'subagent']
    });
    const enriched = enrichStateWithReferencePatterns(initial, 6);
    const draftGraphSpec = synthesizeDraftGraphSpec(enriched, { name: 'factory-demo' });
    const state = { ...enriched, stage: 'drafting' as const, draftGraphSpec };

    const { projectDir } = await materializeFactoryDraft({ state, name: 'factory-demo', dir: root, confirmRisk: true });
    const loaded = await loadHarnessProject(projectDir);
    const compileResult = await compileCanonicalProject(projectDir);

    expect(enriched.referencePatterns.map((pattern) => pattern.id)).toContain('approval-gate.pre-tool-use');
    expect(loaded.nodes.map((node) => node.kind)).toContain('Permission');
    expect(loaded.nodes.map((node) => node.kind)).toContain('MCPServer');
    expect(loaded.nodes.map((node) => node.kind)).toContain('Loop');
    expect(loaded.nodes.map((node) => node.kind)).toContain('StateWrite');
    expect(loaded.manifest.description).toContain('Harness Factory draft');
    expect(compileResult.runtimeDisplayName).toBe('Claude');
    expect(await exists(compileResult.exportManifestPath)).toBe(true);
  });

  test('drives intent through interview answers before materializing and compiling a canonical project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-factory-interview-integration-'));
    let state = createHarnessFactoryState({
      sessionId: 'interview-to-project',
      userIntent: 'Create a Claude harness with approval gates, MCP registration, state memory, review retry loop, and subagent delegation',
      targetRuntime: 'claude-code'
    });

    for (let index = 0; index < 12 && !isReadyToDraft(state); index += 1) {
      const queued = queueNextQuestion(state, `2026-04-24T04:20:${String(index).padStart(2, '0')}.000Z`);
      expect(queued.question).toBeDefined();
      state = applyAnswer(queued.state, {
        questionId: queued.question!.id,
        answer: `Answer ${index}: approval for risky writes, MCP search/state tools, memory in .factory/state, tests plus review, retry budget 2, executor/verifier subagents.`,
        now: `2026-04-24T04:21:${String(index).padStart(2, '0')}.000Z`
      });
    }

    expect(isReadyToDraft(state)).toBe(true);
    const draftGraphSpec = synthesizeDraftGraphSpec(state, { name: 'factory-interview-demo' });
    const readyState = { ...state, draftGraphSpec };

    const { projectDir } = await materializeFactoryDraft({ state: readyState, name: 'factory-interview-demo', dir: root, confirmRisk: true });
    const loaded = await loadHarnessProject(projectDir);
    const compileResult = await compileCanonicalProject(projectDir);

    expect(readyState.confirmedDecisions.length).toBeGreaterThanOrEqual(6);
    expect(loaded.nodes.map((node) => node.kind)).toContain('Permission');
    expect(loaded.nodes.map((node) => node.kind)).toContain('MCPServer');
    expect(loaded.nodes.map((node) => node.kind)).toContain('Loop');
    expect(compileResult.runtimeDisplayName).toBe('Claude');
    expect(await exists(compileResult.exportManifestPath)).toBe(true);
  });

  test('orchestrates factory state through draft build and compile using canonical project files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-factory-orchestrated-'));
    const store = await createReadyFactorySession(root, 'orchestrated-build');

    const draft = await orchestrateFactoryAction({ store, sessionId: 'orchestrated-build', action: 'draft', projectName: 'orchestrated-demo', workspaceDir: root, now: '2026-04-24T08:30:00.000Z' });
    const build = await orchestrateFactoryAction({ store, sessionId: 'orchestrated-build', action: 'build', projectName: 'orchestrated-demo', workspaceDir: root, confirmRisk: true, now: '2026-04-24T08:31:00.000Z' });
    const loaded = await loadHarnessProject(build.state.projectPath!);
    const compileResult = await compileCanonicalProject(build.state.projectPath!);

    expect(draft.ok).toBe(true);
    expect(draft.draft!.spec.nodes.length).toBeGreaterThan(0);
    expect(build.ok).toBe(true);
    expect(build.state.projectPath).toBe(join(root, 'orchestrated-demo'));
    expect(loaded.manifest.graphHash).toBeString();
    expect(build.record.graphHash).toBe(loaded.manifest.graphHash);
    expect(await exists(compileResult.exportManifestPath)).toBe(true);
  });

  test('orchestrates build then verify with sandbox pass', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-factory-orchestrated-verify-'));
    const store = await createReadyFactorySession(root, 'orchestrated-verify');
    const build = await orchestrateFactoryAction({ store, sessionId: 'orchestrated-verify', action: 'build', projectName: 'orchestrated-verify-demo', workspaceDir: root, confirmRisk: true, now: '2026-04-24T08:32:00.000Z' });

    const verify = await orchestrateFactoryAction({ store, sessionId: 'orchestrated-verify', action: 'verify', now: '2026-04-24T08:33:00.000Z' });

    expect(build.ok).toBe(true);
    expect(verify.ok).toBe(true);
    expect(verify.verification?.success).toBe(true);
    expect(verify.state.verification.status).toBe('passed');
    expect(await exists(verify.state.verification.traceFile!)).toBe(true);
    expect(await exists(verify.verification!.htmlReport)).toBe(true);
    expect(verify.verification!.events.map((event) => event.eventType)).toContain('hook-activation');
  }, 60000);

  test('orchestrates verify failure and export while preserving canonical project state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omoh-factory-orchestrated-failure-export-'));
    const store = await createReadyFactorySession(root, 'orchestrated-failure-export');
    const build = await orchestrateFactoryAction({ store, sessionId: 'orchestrated-failure-export', action: 'build', projectName: 'orchestrated-failure-export-demo', workspaceDir: root, confirmRisk: true, now: '2026-04-24T08:34:00.000Z' });

    const failedVerify = await orchestrateFactoryAction({ store, sessionId: 'orchestrated-failure-export', action: 'verify', verify: { failHook: 'UserPromptSubmit' }, now: '2026-04-24T08:35:00.000Z' });
    const exported = await orchestrateFactoryAction({ store, sessionId: 'orchestrated-failure-export', action: 'export', now: '2026-04-24T08:36:00.000Z' });
    const exportManifest = JSON.parse(await readFile(exported.state.exportResult!.exportManifestPath!, 'utf8')) as Record<string, unknown>;

    expect(build.ok).toBe(true);
    expect(failedVerify.ok).toBe(false);
    expect(failedVerify.state.projectPath).toBe(build.state.projectPath);
    expect(failedVerify.state.verification.status).toBe('failed');
    expect(failedVerify.failure?.action).toBe('verify');
    expect(failedVerify.failure?.message).toContain('Hook command failed');
    expect(await exists(failedVerify.state.verification.traceFile!)).toBe(true);
    expect(exported.ok).toBe(true);
    expect(exported.state.exportResult?.runtime).toBe('claude-code');
    expect(await exists(exported.state.exportResult!.runtimeBundleManifestPath!)).toBe(true);
    expect(exportManifest.runtime).toBe('claude-code');
    expect(exportManifest).toHaveProperty('canonicalRoot');
    expect(exportManifest).toHaveProperty('runtimeRoot');
  }, 60000);

});
