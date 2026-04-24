import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { compileProjectForRuntime } from '../../compiler';
import { exportProjectBundle, type ExportResult } from '../../compiler/export';
import { applyRiskConfirmations, generateHarnessProject } from '../../core/generator';
import { importSeedProject } from '../../core/import-seed';
import { loadHarnessProject, writeHarnessProject } from '../../core/project';
import { describeRuntimeTarget } from '../../core/runtime-targets';
import type { CompileResult, HarnessProject, RuntimeTarget, SandboxRunResult } from '../../core/types';
import { projectFromFactoryState } from '../synthesis';
import type { HarnessFactoryState } from '../state';
import { validateProject } from '../../sandbox/validate';
import { startHarnessEditorServer, type ServerHandle } from '../../web/server';

export interface FactoryMaterializeRequest {
  name: string;
  userIntent: string;
  targetRuntime: RuntimeTarget;
  dir: string;
  confirmRisk?: boolean;
}

export interface FactoryMaterializeResult {
  projectDir: string;
  project: HarnessProject;
}

export interface FactoryDraftMaterializeRequest {
  state: HarnessFactoryState;
  name: string;
  dir: string;
  confirmRisk?: boolean;
}

export interface FactoryImportRequest {
  fromDir: string;
  name: string;
  dir: string;
  runtime?: RuntimeTarget;
}

export interface FactoryCompileResult extends CompileResult {
  runtimeDisplayName: string;
}

export interface FactoryPreviewRequest {
  projectDir: string;
  port?: number;
  host?: string;
  tracePath?: string;
  apiToken?: string;
}

export interface FactoryPreviewResult {
  handle: ServerHandle;
  url: string;
  host: string;
  port: number;
  apiToken: string;
  mutationProtection: 'token+same-origin';
}

/**
 * Minimal Harness Factory -> OMOH substrate bridge.
 *
 * The factory layer owns conversation state and draft choices, but the current
 * canonical project model remains the only project source of truth. These
 * adapters intentionally call the existing substrate modules instead of adding a
 * parallel build/export/verify implementation.
 */
export async function materializeCanonicalProject(request: FactoryMaterializeRequest): Promise<FactoryMaterializeResult> {
  const projectDir = resolve(request.dir, request.name);
  let project = generateHarnessProject(request.name, request.userIntent, request.targetRuntime);
  if (request.confirmRisk) project = applyRiskConfirmations(project, true);
  await writeHarnessProject(projectDir, project);
  project = await loadHarnessProject(projectDir);
  return { projectDir, project };
}


export async function materializeFactoryDraft(request: FactoryDraftMaterializeRequest): Promise<FactoryMaterializeResult> {
  const projectDir = resolve(request.dir, request.name);
  let project = projectFromFactoryState(request.state, { name: request.name, targetRuntime: request.state.targetRuntime });
  if (request.confirmRisk) project = applyRiskConfirmations(project, true);
  await writeHarnessProject(projectDir, project);
  project = await loadHarnessProject(projectDir);
  return { projectDir, project };
}

export async function importCanonicalProjectSeed(request: FactoryImportRequest): Promise<FactoryMaterializeResult> {
  const projectDir = resolve(request.dir, request.name);
  const project = await importSeedProject({ sourceDir: request.fromDir, name: request.name, runtime: request.runtime });
  await writeHarnessProject(projectDir, project);
  return { projectDir, project: await loadHarnessProject(projectDir) };
}

export async function compileCanonicalProject(projectDir: string, outDir?: string): Promise<FactoryCompileResult> {
  const resolvedProjectDir = resolve(projectDir);
  const project = await loadHarnessProject(resolvedProjectDir);
  const runtimeDescriptor = describeRuntimeTarget(project.manifest.targetRuntime);
  const resolvedOutDir = resolve(outDir ?? join(resolvedProjectDir, 'compiler'));
  await mkdir(resolvedOutDir, { recursive: true });
  const result = await compileProjectForRuntime(project, resolvedOutDir);
  return { ...result, runtimeDisplayName: runtimeDescriptor.displayName };
}

export async function exportCanonicalProject(projectDir: string, outDir?: string): Promise<ExportResult> {
  const resolvedProjectDir = resolve(projectDir);
  const project = await loadHarnessProject(resolvedProjectDir);
  const runtimeDescriptor = describeRuntimeTarget(project.manifest.targetRuntime);
  const resolvedOutDir = resolve(outDir ?? join(resolvedProjectDir, 'export', runtimeDescriptor.compileDirName));
  await mkdir(resolvedOutDir, { recursive: true });
  return exportProjectBundle(resolvedProjectDir, project, resolvedOutDir);
}

export async function verifyCanonicalProject(projectDir: string, outDir?: string): Promise<SandboxRunResult> {
  return validateProject(resolve(projectDir), outDir ? { outDir: resolve(outDir) } : {});
}

export async function openCanonicalProjectPreview(request: FactoryPreviewRequest): Promise<FactoryPreviewResult> {
  const handle = await startHarnessEditorServer({
    projectDir: resolve(request.projectDir),
    port: request.port ?? 0,
    host: request.host,
    ...(request.tracePath ? { tracePath: resolve(request.tracePath) } : {}),
    ...(request.apiToken ? { apiToken: request.apiToken } : {})
  });
  return {
    handle,
    url: handle.url,
    host: handle.host,
    port: handle.port,
    apiToken: handle.apiToken,
    mutationProtection: 'token+same-origin'
  };
}
