import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { HOOK_BLOCK_KINDS, createRegistrySnapshot } from './registry';
import type { HarnessManifest, HarnessProject, LayoutNode, RuntimeIntent, SkillFile } from './types';

const CURRENT_SCHEMA_VERSION = '0.1.0';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNonEmptyString(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string.`);
  return value;
}

function validateContainedRelativePath(rootDir: string, candidate: string, label: string): string {
  const trimmed = assertNonEmptyString(candidate, label).trim();
  assert(!trimmed.includes('\0'), `${label} must not contain null bytes.`);
  const resolved = resolve(rootDir, trimmed);
  const pathRelative = relative(rootDir, resolved);
  assert(pathRelative !== '' && pathRelative !== '.', `${label} must point to a file within ${rootDir}.`);
  assert(!pathRelative.startsWith('..') && !isAbsolute(pathRelative), `${label} must stay within ${rootDir}.`);
  return pathRelative.replaceAll('\\', '/');
}

function resolveSkillFilePath(skillsDir: string, skill: Pick<SkillFile, 'name' | 'path'>): string {
  return validateContainedRelativePath(skillsDir, skill.path ?? `${skill.name}.md`, `Skill ${skill.name} path`);
}

async function assertNoSymlinkSegments(rootDir: string, relativePath: string, label: string): Promise<void> {
  const rootStat = await lstat(rootDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  assert(rootStat && !rootStat.isSymbolicLink(), `${label} must not use a symlinked root directory.`);

  let cursor = rootDir;
  for (const segment of relativePath.split('/').filter(Boolean)) {
    cursor = join(cursor, segment);
    const stat = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat && stat.isSymbolicLink()) {
      throw new Error(`${label} must not traverse symlinked path segments.`);
    }
  }
}

function assertValidProjectGraph(project: HarnessProject): void {
  const nodeIds = new Set<string>();
  for (const node of project.nodes) {
    assertNonEmptyString(node.id, 'Node id');
    assert(typeof node.label === 'string', `Node ${node.id} label must be a string.`);
    assert(!nodeIds.has(node.id), `Duplicate node id ${node.id} detected in canonical graph.`);
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of project.edges) {
    assertNonEmptyString(edge.id, 'Edge id');
    assertNonEmptyString(edge.from, `Edge ${edge.id} from`);
    assertNonEmptyString(edge.to, `Edge ${edge.id} to`);
    assert(typeof edge.label === 'string' || edge.label === undefined, `Edge ${edge.id} label must be a string when provided.`);
    assert(!edgeIds.has(edge.id), `Duplicate edge id ${edge.id} detected in canonical graph.`);
    assert(nodeIds.has(edge.from) && nodeIds.has(edge.to), `Edge ${edge.id} must connect live nodes.`);
    edgeIds.add(edge.id);
  }

  if (project.runtimeIntents) {
    const intentIds = new Set<string>();
    for (const intent of project.runtimeIntents) {
      assertNonEmptyString(intent.id, 'Runtime intent id');
      assert(typeof intent.label === 'string', `Runtime intent ${intent.id} label must be a string.`);
      assert(intent.sourceNodeIds.length > 0, `Runtime intent ${intent.id} must reference at least one source node.`);
      assert(new Set(intent.sourceNodeIds).size === intent.sourceNodeIds.length, `Runtime intent ${intent.id} source nodes must be unique.`);
      assert(intent.sourceNodeIds.every((nodeId) => nodeIds.has(nodeId)), `Runtime intent ${intent.id} must reference live nodes.`);
      assert(intent.targetRuntime === project.manifest.targetRuntime, `Runtime intent ${intent.id} must target ${project.manifest.targetRuntime}.`);
      assert(!intentIds.has(intent.id), `Duplicate runtime intent id ${intent.id} detected in canonical graph.`);
      intentIds.add(intent.id);
    }
  }

  assert(project.skills.length > 0, 'Canonical project must contain at least one skill.');
  const skillIds = new Set<string>();
  const skillNames = new Set<string>();
  const skillPaths = new Set<string>();
  for (const skill of project.skills) {
    assertNonEmptyString(skill.id, 'Skill id');
    assertNonEmptyString(skill.name, `Skill ${skill.id} name`);
    assert(typeof skill.description === 'string', `Skill ${skill.id} description must be a string.`);
    assert(typeof skill.content === 'string', `Skill ${skill.id} content must be a string.`);
    assert(!skillIds.has(skill.id), `Duplicate skill id ${skill.id} detected in canonical project.`);
    assert(!skillNames.has(skill.name), `Duplicate skill name ${skill.name} detected in canonical project.`);
    skillIds.add(skill.id);
    skillNames.add(skill.name);
    const normalizedPath = (skill.path ?? `${skill.name}.md`).replaceAll('\\', '/');
    assert(!skillPaths.has(normalizedPath), `Duplicate skill path ${normalizedPath} detected in canonical project.`);
    skillPaths.add(normalizedPath);
  }
}

export function computeGraphHash(manifest: Pick<HarnessManifest, 'name' | 'targetRuntime' | 'prompt'>, nodes: HarnessProject['nodes'], edges: HarnessProject['edges']): string {
  return Bun.hash(
    JSON.stringify({
      name: manifest.name,
      targetRuntime: manifest.targetRuntime,
      prompt: manifest.prompt,
      nodes: nodes.map(({ id, kind, label, config }) => ({ id, kind, label, config })),
      edges: edges.map(({ id, from, to, label }) => ({ id, from, to, label }))
    })
  ).toString(16);
}

function defaultLayoutForIndex(index: number): LayoutNode {
  return {
    id: '',
    x: 80 + (index % 4) * 220,
    y: 120 + Math.floor(index / 4) * 160
  };
}

function normalizeLayout(layout: HarnessProject['layout'], nodes: HarnessProject['nodes']): HarnessProject['layout'] {
  const byId = new Map(layout.map((item) => [item.id, item]));
  return nodes.map((node, index) => {
    const existing = byId.get(node.id);
    if (existing) return { id: node.id, x: existing.x, y: existing.y };
    const fallback = defaultLayoutForIndex(index);
    return { id: node.id, x: fallback.x, y: fallback.y };
  });
}

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
  const manifest = {
    ...normalizeManifest(project.manifest),
    graphHash: computeGraphHash(project.manifest, project.nodes, project.edges)
  };
  const layout = normalizeLayout(project.layout, project.nodes);
  const normalizedProject = {
    ...project,
    manifest,
    layout,
    composites: project.composites ?? [],
    customBlocks: project.customBlocks ?? [],
    registry: project.registry ?? createRegistrySnapshot(),
    runtimeIntents: project.runtimeIntents ?? deriveRuntimeIntents(manifest, project.nodes)
  };
  assertValidProjectGraph(normalizedProject);
  return normalizedProject;
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
  const skillsDir = join(baseDir, 'skills');
  await mkdir(join(baseDir, 'graph'), { recursive: true });
  await mkdir(skillsDir, { recursive: true });
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

  const skillIndex = normalized.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    path: resolveSkillFilePath(skillsDir, skill)
  }));
  assert(new Set(skillIndex.map((skill) => skill.path)).size === skillIndex.length, 'Skill paths must be unique within the project skills directory.');
  await writeFile(join(skillsDir, 'index.json'), JSON.stringify(skillIndex, null, 2));
  for (const skill of normalized.skills) {
    const relativeSkillPath = resolveSkillFilePath(skillsDir, skill);
    const absoluteSkillPath = join(skillsDir, relativeSkillPath);
    await mkdir(dirname(absoluteSkillPath), { recursive: true });
    await assertNoSymlinkSegments(skillsDir, relativeSkillPath, `Skill ${skill.name} path`);
    await writeFile(absoluteSkillPath, skill.content);
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
  const skillsDir = join(baseDir, 'skills');
  const skillIndex = ((await readOptionalJson(join(skillsDir, 'index.json'))) ?? []) as Array<Omit<SkillFile, 'content'> & { path: string }>;
  const skills =
    skillIndex.length > 0
      ? await Promise.all(
          skillIndex.map(async (entry) => {
            const relativeSkillPath = resolveSkillFilePath(skillsDir, entry);
            await assertNoSymlinkSegments(skillsDir, relativeSkillPath, `Skill ${entry.name} path`);
            return {
              id: entry.id,
              name: entry.name,
              description: entry.description,
              path: relativeSkillPath,
              content: await readFile(join(skillsDir, relativeSkillPath), 'utf8')
            };
          })
        )
      : [
          {
            id: 'skill-main',
            name: `${manifest.name}-skill`,
            description: 'Generated skill',
            path: resolveSkillFilePath(skillsDir, { name: `${manifest.name}-skill` }),
            content: await readFile(join(skillsDir, resolveSkillFilePath(skillsDir, { name: `${manifest.name}-skill` })), 'utf8')
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
