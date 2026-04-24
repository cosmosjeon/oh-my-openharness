import { resolve } from 'node:path';
import { isReadyToDraft } from '../interview';
import { synthesizeDraftGraphSpec } from '../synthesis';
import {
  withFactoryStateUpdate,
  type HarnessFactoryActionName,
  type HarnessFactoryActionRecord,
  type HarnessFactoryActionStatus,
  type HarnessFactoryDraftGraphSpec,
  type HarnessFactoryExportStatus,
  type HarnessFactoryState,
  type HarnessFactoryStore,
  type HarnessFactoryVerification
} from '../state';
import { createFactoryActionFailure, graphHashForProject, type FactoryActionErrorCategory } from './errors';
import {
  exportCanonicalProject,
  materializeFactoryDraft,
  openCanonicalProjectPreview,
  verifyCanonicalProject,
  type FactoryPreviewResult
} from './substrate';
import type { RuntimeTarget, SandboxRunResult } from '../../core/types';

export interface FactoryActionOrchestrationRequest {
  store: HarnessFactoryStore;
  sessionId: string;
  action: HarnessFactoryActionName;
  workspaceDir?: string;
  projectName?: string;
  projectPath?: string;
  outDir?: string;
  confirmRisk?: boolean;
  now?: string;
  preview?: {
    port?: number;
    host?: string;
    tracePath?: string;
    apiToken?: string;
  };
  verify?: {
    failHook?: string;
  };
}

export interface FactoryActionOrchestrationResult {
  ok: boolean;
  action: HarnessFactoryActionName;
  state: HarnessFactoryState;
  record: HarnessFactoryActionRecord;
  draft?: {
    summary: string;
    spec: HarnessFactoryDraftGraphSpec;
  };
  build?: {
    projectPath: string;
    graphHash?: string;
  };
  preview?: Omit<FactoryPreviewResult, 'handle'>;
  previewHandle?: FactoryPreviewResult['handle'];
  verification?: SandboxRunResult;
  exportResult?: HarnessFactoryExportStatus;
  failure?: HarnessFactoryState['actions']['lastFailure'];
}

type ActionOutput = Record<string, unknown>;

function actionRecord(input: {
  action: HarnessFactoryActionName;
  status: HarnessFactoryActionStatus;
  startedAt: string;
  completedAt?: string;
  message?: string;
  projectPath?: string;
  graphHash?: string;
  output?: ActionOutput;
}): HarnessFactoryActionRecord {
  return {
    action: input.action,
    status: input.status,
    startedAt: input.startedAt,
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    ...(input.message ? { message: input.message } : {}),
    ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    ...(input.graphHash ? { graphHash: input.graphHash } : {}),
    ...(input.output ? { output: input.output } : {})
  };
}

function appendActionRecord(state: HarnessFactoryState, record: HarnessFactoryActionRecord, lastFailure: HarnessFactoryState['actions']['lastFailure'] = state.actions.lastFailure): HarnessFactoryState['actions'] {
  return {
    lastAction: record,
    ...(lastFailure ? { lastFailure } : {}),
    history: [...state.actions.history, record].slice(-25)
  };
}

function projectNameFor(state: HarnessFactoryState, request: FactoryActionOrchestrationRequest): string {
  return request.projectName ?? state.sessionId.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function requireProjectPath(state: HarnessFactoryState, request: FactoryActionOrchestrationRequest): string {
  const projectPath = request.projectPath ?? state.projectPath;
  if (!projectPath) throw new Error(`Factory action ${request.action} requires a built canonical project path.`);
  return resolve(projectPath);
}

function draftSummary(state: HarnessFactoryState, spec: HarnessFactoryDraftGraphSpec): string {
  const runtime = state.targetRuntime ?? 'claude-code';
  const capabilities = state.requestedCapabilities.length > 0 ? state.requestedCapabilities.join(', ') : 'none';
  return [
    `Harness Factory draft for ${runtime}`,
    `Intent: ${state.userIntent}`,
    `Capabilities: ${capabilities}`,
    `Graph: ${spec.nodes.length} nodes, ${spec.edges.length} edges, ${spec.skills.length} skills`
  ].join('\n');
}

function verificationState(result: SandboxRunResult, now: string): HarnessFactoryVerification {
  return {
    status: result.success ? 'passed' : 'failed',
    ok: result.success,
    lastRunAt: now,
    summary: result.success
      ? `Sandbox passed with ${result.events.length} trace events.`
      : result.failure?.message ?? `Sandbox failed with ${result.events.length} trace events.`,
    traceFile: result.traceFile,
    ...(result.failure?.message ? { error: result.failure.message } : {})
  };
}

function exportState(runtime: RuntimeTarget, result: { outDir: string; runtimeBundleRoot: string; runtimeBundleManifestPath: string; exportManifestPath: string }, now: string): HarnessFactoryExportStatus {
  return {
    runtime,
    outDir: result.outDir,
    runtimeBundleRoot: result.runtimeBundleRoot,
    runtimeBundleManifestPath: result.runtimeBundleManifestPath,
    exportManifestPath: result.exportManifestPath,
    exportedAt: now
  };
}

async function persistSuccess(
  request: FactoryActionOrchestrationRequest,
  state: HarnessFactoryState,
  patch: Partial<Omit<HarnessFactoryState, 'schemaVersion' | 'sessionId' | 'createdAt'>>,
  record: HarnessFactoryActionRecord
): Promise<HarnessFactoryState> {
  const timestamp = record.completedAt ?? request.now;
  const next = withFactoryStateUpdate(
    state,
    { ...patch, actions: appendActionRecord(withFactoryStateUpdate(state, patch, timestamp), record, undefined) },
    timestamp
  );
  return request.store.save(next);
}

async function persistFailure(
  request: FactoryActionOrchestrationRequest,
  state: HarnessFactoryState,
  error: unknown,
  category: FactoryActionErrorCategory,
  startedAt: string,
  projectPath?: string
): Promise<FactoryActionOrchestrationResult> {
  const completedAt = request.now ?? new Date().toISOString();
  const failureProjectPath = projectPath ?? state.projectPath;
  const graphHash = await graphHashForProject(failureProjectPath);
  const failure = createFactoryActionFailure({ action: request.action, error, category, timestamp: completedAt, state, projectPath: failureProjectPath, graphHash });
  const record = actionRecord({
    action: request.action,
    status: 'failed',
    startedAt,
    completedAt,
    message: failure.message,
    ...(failureProjectPath ? { projectPath: failureProjectPath } : {}),
    ...(graphHash ? { graphHash } : {}),
    output: { category }
  });
  const failedState = await request.store.save(withFactoryStateUpdate(state, { actions: appendActionRecord(state, record, failure) }, completedAt));
  return { ok: false, action: request.action, state: failedState, record, failure };
}

export async function orchestrateFactoryAction(request: FactoryActionOrchestrationRequest): Promise<FactoryActionOrchestrationResult> {
  const startedAt = request.now ?? new Date().toISOString();
  const state = await request.store.load(request.sessionId);

  try {
    switch (request.action) {
      case 'draft': {
        const spec = synthesizeDraftGraphSpec(state, { name: projectNameFor(state, request), targetRuntime: state.targetRuntime });
        const summary = draftSummary(state, spec);
        const record = actionRecord({
          action: 'draft',
          status: 'passed',
          startedAt,
          completedAt: startedAt,
          message: 'Draft graph spec synthesized from Factory state.',
          output: { nodeCount: spec.nodes.length, edgeCount: spec.edges.length, skillCount: spec.skills.length }
        });
        const saved = await persistSuccess(request, state, { stage: 'drafting', draftGraphSpec: spec }, record);
        return { ok: true, action: 'draft', state: saved, record, draft: { summary, spec } };
      }

      case 'build': {
        if (!isReadyToDraft(state)) throw new Error('Factory state is not ready to build; complete runtime and capability decisions first.');
        const workspaceDir = resolve(request.workspaceDir ?? process.cwd());
        const projectName = projectNameFor(state, request);
        const draftState = state.draftGraphSpec.nodes.length > 0
          ? state
          : withFactoryStateUpdate(state, { draftGraphSpec: synthesizeDraftGraphSpec(state, { name: projectName, targetRuntime: state.targetRuntime }) }, startedAt);
        const result = await materializeFactoryDraft({ state: draftState, name: projectName, dir: workspaceDir, confirmRisk: request.confirmRisk });
        const graphHash = result.project.manifest.graphHash;
        const record = actionRecord({
          action: 'build',
          status: 'passed',
          startedAt,
          completedAt: startedAt,
          message: 'Canonical project materialized through writeHarnessProject.',
          projectPath: result.projectDir,
          ...(graphHash ? { graphHash } : {})
        });
        const saved = await persistSuccess(request, draftState, { stage: 'built', projectPath: result.projectDir, draftGraphSpec: draftState.draftGraphSpec }, record);
        return { ok: true, action: 'build', state: saved, record, build: { projectPath: result.projectDir, ...(graphHash ? { graphHash } : {}) } };
      }

      case 'preview': {
        const projectPath = requireProjectPath(state, request);
        const previewResult = await openCanonicalProjectPreview({ projectDir: projectPath, ...request.preview });
        const previewPayload = {
          url: previewResult.url,
          host: previewResult.host,
          port: previewResult.port,
          apiToken: previewResult.apiToken,
          mutationProtection: previewResult.mutationProtection
        };
        const preview = {
          url: previewPayload.url,
          status: 'open' as const,
          lastOpenedAt: startedAt,
          apiToken: previewPayload.apiToken,
          mutationProtection: previewPayload.mutationProtection
        };
        const record = actionRecord({ action: 'preview', status: 'passed', startedAt, completedAt: startedAt, message: 'Preview server opened.', projectPath, output: { url: previewPayload.url, port: previewPayload.port, host: previewPayload.host } });
        const saved = await persistSuccess(request, state, { stage: 'previewing', preview }, record);
        return {
          ok: true,
          action: 'preview',
          state: saved,
          record,
          preview: previewPayload,
          previewHandle: previewResult.handle
        };
      }

      case 'verify': {
        const projectPath = requireProjectPath(state, request);
        const result = await verifyCanonicalProject(projectPath, { outDir: request.outDir, failHook: request.verify?.failHook });
        const verification = verificationState(result, startedAt);
        const graphHash = await graphHashForProject(projectPath);
        const record = actionRecord({ action: 'verify', status: result.success ? 'passed' : 'failed', startedAt, completedAt: startedAt, message: verification.summary, projectPath, ...(graphHash ? { graphHash } : {}), output: { traceFile: result.traceFile, htmlReport: result.htmlReport, eventCount: result.events.length } });
        const failure = result.success ? undefined : createFactoryActionFailure({ action: 'verify', error: new Error(verification.summary), category: 'sandbox-failure', timestamp: startedAt, state, projectPath, graphHash });
        const saved = await request.store.save(withFactoryStateUpdate(state, { stage: 'verifying', verification, actions: appendActionRecord(state, record, failure) }, startedAt));
        return { ok: result.success, action: 'verify', state: saved, record, verification: result, ...(failure ? { failure } : {}) };
      }

      case 'export': {
        const projectPath = requireProjectPath(state, request);
        const result = await exportCanonicalProject(projectPath, request.outDir);
        const exportResult = exportState(result.runtime, result, startedAt);
        const graphHash = await graphHashForProject(projectPath);
        const record = actionRecord({ action: 'export', status: 'passed', startedAt, completedAt: startedAt, message: 'Runtime export bundle written from canonical project.', projectPath, ...(graphHash ? { graphHash } : {}), output: { exportManifestPath: result.exportManifestPath, runtime: result.runtime } });
        const saved = await persistSuccess(request, state, { exportResult }, record);
        return { ok: true, action: 'export', state: saved, record, exportResult };
      }
    }
  } catch (error) {
    const category: FactoryActionErrorCategory = request.action === 'preview' || request.action === 'verify' || request.action === 'export' ? 'missing-project' : 'substrate-error';
    return persistFailure(request, state, error, category, startedAt, request.projectPath ?? state.projectPath);
  }
}
