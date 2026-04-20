import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HOOK_BLOCK_KINDS, createRegistrySnapshot } from './registry';
import type { HarnessManifest, HarnessProject, RuntimeIntent, SkillFile } from './types';

const CURRENT_SCHEMA_VERSION = '0.1.0';

function normalizeManifest(manifest: HarnessManifest): HarnessManifest {
  return {
    ...manifest,
    schemaVersion: manifest.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    supportedRuntimes: manifest.supportedRuntimes ?? [manifest.targetRuntime]
  };
}

function deriveRuntimeIntents(manifest: HarnessManifest, nodes: HarnessProject['nodes']): RuntimeIntent[] {
  const intents: RuntimeIntent[] = [];
  for (const node of nodes) {
    if (HOOK_BLOCK_KINDS.includes(node.kind)) {
      intents.push({ id: `intent:${node.id}`, kind: 'hook', label: node.label, targetRuntime: manifest.targetRuntime, sourceNodeIds: [node.id], transport: 'stdio', safety: 'safe' });
    } else if (node.kind === 'MCPServer') {
      intents.push({ id: `intent:${node.id}`, kind: 'mcp-server', label: node.label, targetRuntime: manifest.targetRuntime, sourceNodeIds: [node.id], transport: 'stdio', safety: 'confirm' });
    } else if (node.kind === 'StateRead' || node.kind === 'StateWrite') {
      intents.push({ id: `intent:${node.id}`, kind: 'state', label: node.label, targetRuntime: manifest.targetRuntime, sourceNodeIds: [node.id], transport: 'in-memory', safety: 'safe' });
    } else if (node.kind === 'CustomBlock') {
      intents.push({ id: `intent:${node.id}`, kind: 'custom-runtime', label: node.label, targetRuntime: manifest.targetRuntime, sourceNodeIds: [node.id], safety: 'confirm' });
    }
  }
  return intents;
}

function normalizeProject(project: HarnessProject): HarnessProject {
  const manifest = normalizeManifest(project.manifest);
  return {
    ...project,
    manifest,
    composites: project.composites ?? [],
    customBlocks: project.customBlocks ?? [],
    registry: project.registry ?? createRegistrySnapshot(),
    runtimeIntents: project.runtimeIntents ?? deriveRuntimeIntents(manifest, project.nodes)
  };
}

async function readOptionalJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeHarnessProject(baseDir: string, project: HarnessProject): Promise<string> {
  const normalized = normalizeProject(project);
  await mkdir(join(baseDir, 'graph'), { recursive: true });
  await mkdir(join(baseDir, 'skills'), { recursive: true });
  await mkdir(join(baseDir, 'custom-blocks'), { recursive: true });
  await mkdir(join(baseDir, 'registry'), { recursive: true });
  await mkdir(join(baseDir, 'authoring'), { recursive: true });
  await mkdir(join(baseDir, 'compiler'), { recursive: true });

  await writeFile(join(baseDir, 'harness.json'), JSON.stringify(normalized.manifest, null, 2));
  await writeFile(join(baseDir, 'graph', 'nodes.json'), JSON.stringify(normalized.nodes, null, 2));
  await writeFile(join(baseDir, 'graph', 'edges.json'), JSON.stringify(normalized.edges, null, 2));
  await writeFile(join(baseDir, 'graph', 'composites.json'), JSON.stringify(normalized.composites, null, 2));
  await writeFile(join(baseDir, 'layout.json'), JSON.stringify(normalized.layout, null, 2));
  await writeFile(join(baseDir, 'runtime.json'), JSON.stringify(normalized.runtimeIntents ?? [], null, 2));
  await writeFile(join(baseDir, 'custom-blocks', 'definitions.json'), JSON.stringify(normalized.customBlocks, null, 2));
  await writeFile(join(baseDir, 'registry', 'blocks.json'), JSON.stringify(normalized.registry.blocks, null, 2));
  await writeFile(join(baseDir, 'registry', 'composites.json'), JSON.stringify(normalized.registry.composites, null, 2));
  await writeFile(join(baseDir, 'authoring', 'decision.json'), JSON.stringify(normalized.authoring, null, 2));

  const skillIndex = normalized.skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, path: skill.path ?? `${skill.name}.md` }));
  await writeFile(join(baseDir, 'skills', 'index.json'), JSON.stringify(skillIndex, null, 2));
  for (const skill of normalized.skills) {
    await writeFile(join(baseDir, 'skills', skill.path ?? `${skill.name}.md`), skill.content);
  }
  return baseDir;
}

export async function loadHarnessProject(baseDir: string): Promise<HarnessProject> {
  const manifest = normalizeManifest(JSON.parse(await readFile(join(baseDir, 'harness.json'), 'utf8')) as HarnessManifest);
  const nodes = JSON.parse(await readFile(join(baseDir, 'graph', 'nodes.json'), 'utf8'));
  const edges = JSON.parse(await readFile(join(baseDir, 'graph', 'edges.json'), 'utf8'));
  const layout = JSON.parse(await readFile(join(baseDir, 'layout.json'), 'utf8'));
  const composites = (await readOptionalJson<HarnessProject['composites']>(join(baseDir, 'graph', 'composites.json'))) ?? [];
  const runtimeIntents = (await readOptionalJson<NonNullable<HarnessProject['runtimeIntents']>>(join(baseDir, 'runtime.json'))) ?? deriveRuntimeIntents(manifest, nodes);
  const customBlocks = (await readOptionalJson<HarnessProject['customBlocks']>(join(baseDir, 'custom-blocks', 'definitions.json'))) ?? [];
  const blocks = (await readOptionalJson<HarnessProject['registry']['blocks']>(join(baseDir, 'registry', 'blocks.json'))) ?? createRegistrySnapshot().blocks;
  const compositeRegistry = (await readOptionalJson<HarnessProject['registry']['composites']>(join(baseDir, 'registry', 'composites.json'))) ?? createRegistrySnapshot().composites;
  const authoring =
    (await readOptionalJson<HarnessProject['authoring']>(join(baseDir, 'authoring', 'decision.json'))) ??
    ({ summary: `Loaded harness project ${manifest.name}`, warnings: [], confirmationRequests: [], compatibleRuntimes: [manifest.targetRuntime], traceIntent: ['hook-activation', 'failure'] } satisfies HarnessProject['authoring']);
  const skillIndex = ((await readOptionalJson(join(baseDir, 'skills', 'index.json'))) ?? []) as Array<Omit<SkillFile, 'content'> & { path: string }>;
  const skills =
    skillIndex.length > 0
      ? await Promise.all(skillIndex.map(async (entry) => ({ id: entry.id, name: entry.name, description: entry.description, path: entry.path, content: await readFile(join(baseDir, 'skills', entry.path), 'utf8') })))
      : [
          {
            id: 'skill-main',
            name: `${manifest.name}-skill`,
            description: 'Generated skill',
            content: await readFile(join(baseDir, 'skills', `${manifest.name}-skill.md`), 'utf8')
          }
        ];

  return normalizeProject({
    manifest,
    nodes,
    edges,
    skills,
    layout,
    composites,
    customBlocks,
    registry: { blocks, composites: compositeRegistry },
    authoring,
    runtimeIntents
  });
}
