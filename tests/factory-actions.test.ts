import { describe, expect, test } from 'bun:test';
import { exists, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import {
  applyAnswer,
  compileCanonicalProject,
  createHarnessFactoryState,
  createHarnessFactoryStore,
  isReadyToDraft,
  orchestrateFactoryAction,
  queueNextQuestion,
  type HarnessFactoryState
} from '../src/factory';
import { loadHarnessProject } from '../src/core/project';

const NOW = '2026-04-24T08:00:00.000Z';

async function tempRoot(prefix = 'omoh-factory-actions-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
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
      now: `2026-04-24T08:00:${String(index).padStart(2, '0')}.000Z`
    });
  }
  expect(isReadyToDraft(current)).toBe(true);
  return current;
}

function readyFactoryState(sessionId: string): HarnessFactoryState {
  return answerAllOpenQuestions(createHarnessFactoryState({
    sessionId,
    userIntent: 'Claude harness with approval, MCP, state, review, retry, and subagent delegation',
    targetRuntime: 'claude-code'
  }));
}

async function expectCanonicalProject(projectPath: string) {
  expect(await exists(join(projectPath, 'harness.json'))).toBe(true);
  const project = await loadHarnessProject(projectPath);
  expect(project.manifest.graphHash).toBeString();
  expect(project.manifest.graphHash!.length).toBeGreaterThan(0);
  return project;
}

describe('Harness Factory action orchestrator', () => {
  test('draft action returns deterministic summary/spec without writing a project', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(join(root, 'state'));
    await store.save(readyFactoryState('draft-action'));

    const result = await orchestrateFactoryAction({
      store,
      sessionId: 'draft-action',
      action: 'draft',
      workspaceDir: join(root, 'workspace'),
      projectName: 'draft-demo',
      now: NOW
    });

    expect(result.ok).toBe(true);
    expect(result.record).toMatchObject({ action: 'draft', status: 'passed', startedAt: NOW, completedAt: NOW });
    expect(result.draft?.summary).toContain('Harness Factory draft for claude-code');
    expect(result.state.stage).toBe('drafting');
    expect(result.state.draftGraphSpec.nodes.length).toBeGreaterThan(0);
    expect(result.state.draftGraphSpec.skills.length).toBeGreaterThan(0);
    expect(result.state.projectPath).toBeUndefined();
    await expect(readdir(join(root, 'workspace'))).rejects.toThrow();
  });

  test('build action materializes canonical project and stores projectPath and graphHash', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(join(root, 'state'));
    await store.save(readyFactoryState('build-action'));

    const result = await orchestrateFactoryAction({
      store,
      sessionId: 'build-action',
      action: 'build',
      workspaceDir: join(root, 'workspace'),
      projectName: 'build-demo',
      confirmRisk: true,
      now: NOW
    });
    const project = await expectCanonicalProject(result.state.projectPath!);

    expect(result.ok).toBe(true);
    expect(result.state.stage).toBe('built');
    expect(result.state.projectPath).toBe(resolve(root, 'workspace', 'build-demo'));
    expect(result.record.graphHash).toBe(project.manifest.graphHash);
    expect(result.state.actions.lastAction?.graphHash).toBe(project.manifest.graphHash);
    expect(project.nodes.map((node) => node.kind)).toContain('Permission');
    expect(project.nodes.map((node) => node.kind)).toContain('MCPServer');
  });

  test('preview action records url token and status without serializing server handle', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(join(root, 'state'));
    await store.save(readyFactoryState('preview-action'));
    const built = await orchestrateFactoryAction({ store, sessionId: 'preview-action', action: 'build', workspaceDir: join(root, 'workspace'), projectName: 'preview-demo', confirmRisk: true, now: NOW });

    const result = await orchestrateFactoryAction({
      store,
      sessionId: 'preview-action',
      action: 'preview',
      preview: { host: '127.0.0.1', port: 0 },
      now: '2026-04-24T08:01:00.000Z'
    });

    try {
      expect(result.ok).toBe(true);
      expect(result.preview?.url).toStartWith('http://127.0.0.1:');
      expect(result.preview?.apiToken).toBeString();
      expect(result.previewHandle).toBeDefined();
      expect(result.state.projectPath).toBe(built.state.projectPath);
      expect(result.state.stage).toBe('previewing');
      expect(result.state.preview.status).toBe('open');
      expect(result.state.preview.url).toBe(result.preview?.url);
      expect(result.state.preview.apiToken).toBe(result.preview?.apiToken);
      expect(JSON.stringify(result.state)).not.toContain('handle');
      expect(JSON.stringify(result.state)).not.toContain('close');
    } finally {
      await result.previewHandle?.close();
    }
  });

  test('verify action records sandbox pass summary and trace path', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(join(root, 'state'));
    await store.save(readyFactoryState('verify-action'));
    const built = await orchestrateFactoryAction({ store, sessionId: 'verify-action', action: 'build', workspaceDir: join(root, 'workspace'), projectName: 'verify-demo', confirmRisk: true, now: NOW });

    const result = await orchestrateFactoryAction({ store, sessionId: 'verify-action', action: 'verify', now: '2026-04-24T08:02:00.000Z' });

    expect(result.ok).toBe(true);
    expect(result.state.projectPath).toBe(built.state.projectPath);
    expect(result.state.stage).toBe('verifying');
    expect(result.state.verification.status).toBe('passed');
    expect(result.state.verification.ok).toBe(true);
    expect(result.state.verification.traceFile).toEndWith('/sandbox/trace.jsonl');
    expect(result.state.verification.summary).toContain('Sandbox passed');
    expect(await exists(result.state.verification.traceFile!)).toBe(true);
  }, 60000);

  test('export action records runtime bundle path and runtime', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(join(root, 'state'));
    await store.save(readyFactoryState('export-action'));
    await orchestrateFactoryAction({ store, sessionId: 'export-action', action: 'build', workspaceDir: join(root, 'workspace'), projectName: 'export-demo', confirmRisk: true, now: NOW });

    const result = await orchestrateFactoryAction({ store, sessionId: 'export-action', action: 'export', now: '2026-04-24T08:03:00.000Z' });
    const manifest = JSON.parse(await readFile(result.state.exportResult!.exportManifestPath!, 'utf8')) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.state.exportResult?.runtime).toBe('claude-code');
    expect(await exists(result.state.exportResult!.runtimeBundleManifestPath!)).toBe(true);
    expect(await exists(result.state.exportResult!.exportManifestPath!)).toBe(true);
    expect(manifest.runtime).toBe('claude-code');
    expect(manifest).toHaveProperty('canonicalRoot');
    expect(manifest).toHaveProperty('runtimeRoot');
  });

  test('action failure stores action error timestamp and stage-safe failure state', async () => {
    const root = await tempRoot();
    const store = createHarnessFactoryStore(join(root, 'state'));
    await store.save(readyFactoryState('failure-action'));

    const result = await orchestrateFactoryAction({
      store,
      sessionId: 'failure-action',
      action: 'export',
      now: '2026-04-24T08:04:00.000Z'
    });
    const loaded = await store.load('failure-action');

    expect(result.ok).toBe(false);
    expect(result.record).toMatchObject({ action: 'export', status: 'failed', completedAt: '2026-04-24T08:04:00.000Z' });
    expect(result.failure).toMatchObject({ action: 'export', category: 'missing-project', timestamp: '2026-04-24T08:04:00.000Z' });
    expect(result.failure?.message).toContain('requires a built canonical project path');
    expect(loaded.stage).not.toBe('built');
    expect(loaded.projectPath).toBeUndefined();
    expect(loaded.actions.lastFailure?.action).toBe('export');
  });
});
