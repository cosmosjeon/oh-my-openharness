import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { generateHarnessProject } from './generator';
import { parseRuntimeTarget } from './runtime-targets';
import type { HarnessProject, RuntimeTarget } from './types';

interface ImportSeedOptions {
  sourceDir: string;
  runtime?: string;
  name?: string;
}

interface ExportManifest {
  runtime: RuntimeTarget;
  runtimeRoot: string;
  runtimeBundleManifestPath: string;
}

function resolveBundleScopedManifestPath(bundleRoot: string, manifestPath: string, fieldName: keyof Pick<ExportManifest, 'runtimeRoot' | 'runtimeBundleManifestPath'>): string {
  if (isAbsolute(manifestPath)) {
    throw new Error(`Import seed manifest has unsafe ${fieldName}; path must stay within the bundle root.`);
  }
  const resolvedPath = resolve(bundleRoot, manifestPath);
  const relativePath = relative(bundleRoot, resolvedPath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Import seed manifest has unsafe ${fieldName}; path must stay within the bundle root.`);
  }
  return resolvedPath;
}

async function loadExportManifest(sourceDir: string): Promise<ExportManifest | null> {
  const exportManifestPath = join(sourceDir, 'export-manifest.json');
  if (!existsSync(exportManifestPath)) return null;
  return JSON.parse(await readFile(exportManifestPath, 'utf8')) as ExportManifest;
}

function detectRuntimeTarget(sourceDir: string): RuntimeTarget {
  const resolved = resolve(sourceDir);
  if (existsSync(join(resolved, '.claude-plugin', 'plugin.json'))) return 'claude-code';
  if (existsSync(join(resolved, '.opencode', 'oh-my-openharness.jsonc'))) return 'opencode';
  if (existsSync(join(resolved, '.codex', 'oh-my-openharness.json'))) return 'codex';
  throw new Error('Unable to detect import runtime from source directory.');
}

async function runtimePrompt(sourceDir: string, runtime: RuntimeTarget): Promise<string> {
  const exportManifest = await loadExportManifest(sourceDir);
  const runtimeRoot = exportManifest?.runtimeRoot
    ? resolveBundleScopedManifestPath(sourceDir, exportManifest.runtimeRoot, 'runtimeRoot')
    : sourceDir;

  if (runtime === 'claude-code') {
    const pluginJsonPath = exportManifest ? join(runtimeRoot, 'plugin.json') : join(runtimeRoot, '.claude-plugin', 'plugin.json');
    const pluginJson = JSON.parse(await readFile(pluginJsonPath, 'utf8')) as { description?: string };
    return `Import seed from Claude runtime bundle: ${pluginJson.description ?? 'Claude plugin bundle'}`;
  }
  if (runtime === 'opencode') {
    const configPath = exportManifest ? join(runtimeRoot, 'oh-my-openharness.jsonc') : join(runtimeRoot, '.opencode', 'oh-my-openharness.jsonc');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { contract?: string };
    return `Import seed from OpenCode runtime bundle: ${config.contract ?? 'host-native-authoring'}`;
  }
  const configPath = exportManifest ? join(runtimeRoot, 'oh-my-openharness.json') : join(runtimeRoot, '.codex', 'oh-my-openharness.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as { contract?: string };
  return `Import seed from Codex runtime bundle: ${config.contract ?? 'host-native-authoring'}`;
}

export async function importSeedProject(options: ImportSeedOptions): Promise<HarnessProject> {
  const sourceDir = resolve(options.sourceDir);
  const exportManifest = await loadExportManifest(sourceDir);
  const runtime = options.runtime ? parseRuntimeTarget(options.runtime) : exportManifest?.runtime ?? detectRuntimeTarget(sourceDir);
  if (exportManifest) {
    const runtimeRoot = resolveBundleScopedManifestPath(sourceDir, exportManifest.runtimeRoot, 'runtimeRoot');
    const runtimeBundleManifestPath = resolveBundleScopedManifestPath(sourceDir, exportManifest.runtimeBundleManifestPath, 'runtimeBundleManifestPath');
    if (!existsSync(runtimeRoot) || !existsSync(runtimeBundleManifestPath)) throw new Error('Import seed manifest references missing runtime export artifacts.');
  }
  const name = options.name ?? basename(sourceDir);
  const prompt = await runtimePrompt(sourceDir, runtime);
  const project = generateHarnessProject(name, prompt, runtime);
  return {
    ...project,
    manifest: {
      ...project.manifest,
      description: `Imported seed harness from ${runtime} bundle at ${sourceDir}`
    },
    authoring: {
      ...project.authoring,
      summary: `Imported seed project from ${runtime} bundle at ${sourceDir}`,
      warnings: [
        ...project.authoring.warnings,
        'Import seed MVP preserves only bounded runtime bridge shape and requires manual review for unsupported surfaces.',
        'Classification: supported = exported runtime bridge metadata, partial = runtime-specific workflow semantics, unsupported = full upstream session history/provider state.'
      ]
    }
  };
}
