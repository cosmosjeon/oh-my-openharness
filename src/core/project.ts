import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HarnessProject } from './types';

async function writeJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2));
}

export async function writeHarnessProject(baseDir: string, project: HarnessProject): Promise<string> {
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

  for (const skill of project.skills) {
    await writeFile(join(baseDir, 'skills', `${skill.name}.md`), skill.content);
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
