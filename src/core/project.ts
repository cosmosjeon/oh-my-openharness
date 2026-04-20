import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HOOK_BLOCK_KINDS } from './registry';
import type {
  CustomBlockDefinition,
  GraphNode,
  HarnessManifest,
  HarnessProject,
  RuntimeIntent,
  SkillFile
} from './types';

const CURRENT_SCHEMA_VERSION = '0.1.0';

const PROJECT_FILES = {
  manifest: 'harness.json',
  layout: 'layout.json',
  runtime: 'runtime.json',
  graphDir: 'graph',
  nodes: join('graph', 'nodes.json'),
  edges: join('graph', 'edges.json'),
  composites: join('graph', 'composites.json'),
  skillsDir: 'skills',
  skillsIndex: join('skills', 'index.json'),
  customBlocksDir: 'custom-blocks',
  customBlocksIndex: join('custom-blocks', 'index.json'),
  compilerDir: 'compiler'
} as const;

interface SkillIndexEntry extends Omit<SkillFile, 'content'> {
  path: string;
}

function normalizeManifest(manifest: HarnessManifest): HarnessManifest {
  return {
    ...manifest,
    schemaVersion: manifest.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    supportedRuntimes: manifest.supportedRuntimes ?? [manifest.targetRuntime]
  };
}

function deriveRuntimeIntents(manifest: HarnessManifest, nodes: GraphNode[]): RuntimeIntent[] {
  const intents: RuntimeIntent[] = [];

  for (const node of nodes) {
    if (HOOK_BLOCK_KINDS.includes(node.kind)) {
      intents.push({
        id: `intent:${node.id}`,
        kind: 'hook',
        label: node.label,
        targetRuntime: manifest.targetRuntime,
        sourceNodeIds: [node.id],
        transport: 'stdio',
        safety: 'safe'
      });
      continue;
    }

    if (node.kind === 'MCPServer') {
      intents.push({
        id: `intent:${node.id}`,
        kind: 'mcp-server',
        label: node.label,
        targetRuntime: manifest.targetRuntime,
        sourceNodeIds: [node.id],
        transport: 'stdio',
        safety: 'confirm'
      });
      continue;
    }

    if (node.kind === 'StateRead' || node.kind === 'StateWrite') {
      intents.push({
        id: `intent:${node.id}`,
        kind: 'state',
        label: node.label,
        targetRuntime: manifest.targetRuntime,
        sourceNodeIds: [node.id],
        transport: 'in-memory',
        safety: 'safe'
      });
      continue;
    }

    if (node.kind === 'CustomBlock') {
      intents.push({
        id: `intent:${node.id}`,
        kind: 'custom-runtime',
        label: node.label,
        targetRuntime: manifest.targetRuntime,
        sourceNodeIds: [node.id],
        safety: 'confirm'
      });
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
    runtimeIntents: project.runtimeIntents ?? deriveRuntimeIntents(manifest, project.nodes),
    customBlocks: project.customBlocks ?? []
  };
}

async function readOptionalJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2));
}

export async function writeHarnessProject(baseDir: string, project: HarnessProject): Promise<string> {
  const normalizedProject = normalizeProject(project);
  await mkdir(baseDir, { recursive: true });
  await mkdir(join(baseDir, 'graph'), { recursive: true });
  await mkdir(join(baseDir, 'skills'), { recursive: true });
  await mkdir(join(baseDir, 'custom-blocks'), { recursive: true });
  await mkdir(join(baseDir, 'composites'), { recursive: true });
  await mkdir(join(baseDir, 'registry'), { recursive: true });
  await mkdir(join(baseDir, 'authoring'), { recursive: true });
  await mkdir(join(baseDir, 'compiler'), { recursive: true });

  await writeJson(join(baseDir, 'harness.json'), project.manifest);
  await writeJson(join(baseDir, 'graph', 'nodes.json'), project.nodes);
  await writeJson(join(baseDir, 'graph', 'edges.json'), project.edges);
  await writeJson(join(baseDir, 'layout.json'), project.layout);
  await writeJson(join(baseDir, 'composites', 'instances.json'), project.composites);
  await writeJson(join(baseDir, 'custom-blocks', 'definitions.json'), project.customBlocks);
  await writeJson(join(baseDir, 'registry', 'blocks.json'), project.registry.blocks);
  await writeJson(join(baseDir, 'registry', 'composites.json'), project.registry.composites);
  await writeJson(join(baseDir, 'authoring', 'decision.json'), project.authoring);

  const skillIndex: SkillIndexEntry[] = normalizedProject.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    path: skill.path ?? `${skill.name}.md`
  }));
  await writeFile(join(baseDir, PROJECT_FILES.skillsIndex), JSON.stringify(skillIndex, null, 2));

  for (const skill of normalizedProject.skills) {
    await writeFile(join(baseDir, PROJECT_FILES.skillsDir, skill.path ?? `${skill.name}.md`), skill.content);
  }

  return baseDir;
}

export async function loadHarnessProject(baseDir: string): Promise<HarnessProject> {
  const manifest = JSON.parse(await readFile(join(baseDir, 'harness.json'), 'utf8'));
  const nodes = JSON.parse(await readFile(join(baseDir, 'graph', 'nodes.json'), 'utf8'));
  const edges = JSON.parse(await readFile(join(baseDir, 'graph', 'edges.json'), 'utf8'));
  const layout = JSON.parse(await readFile(join(baseDir, 'layout.json'), 'utf8'));
  const composites = JSON.parse(await readFile(join(baseDir, 'composites', 'instances.json'), 'utf8'));
  const customBlocks = JSON.parse(await readFile(join(baseDir, 'custom-blocks', 'definitions.json'), 'utf8'));
  const blocks = JSON.parse(await readFile(join(baseDir, 'registry', 'blocks.json'), 'utf8'));
  const compositeRegistry = JSON.parse(await readFile(join(baseDir, 'registry', 'composites.json'), 'utf8'));
  const authoring = JSON.parse(await readFile(join(baseDir, 'authoring', 'decision.json'), 'utf8'));
  const skillContent = await readFile(join(baseDir, 'skills', `${manifest.name}-skill.md`), 'utf8');

  return {
    manifest,
    nodes,
    edges,
    layout,
    composites,
    customBlocks,
    registry: {
      blocks,
      composites: compositeRegistry
    },
    authoring,
    skills: [
      {
        id: 'skill-main',
        name: `${manifest.name}-skill`,
        description: 'Generated skill',
        content: skillContent
      }
    ],
    composites,
    customBlocks,
    registry,
    authoring
  } satisfies HarnessProject;
}
