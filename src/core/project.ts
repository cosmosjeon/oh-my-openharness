import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HarnessProject } from './types';

export async function writeHarnessProject(baseDir: string, project: HarnessProject): Promise<string> {
  await mkdir(baseDir, { recursive: true });
  await mkdir(join(baseDir, 'graph'), { recursive: true });
  await mkdir(join(baseDir, 'skills'), { recursive: true });
  await mkdir(join(baseDir, 'custom-blocks'), { recursive: true });
  await mkdir(join(baseDir, 'compiler'), { recursive: true });

  await writeFile(join(baseDir, 'harness.json'), JSON.stringify(project.manifest, null, 2));
  await writeFile(join(baseDir, 'graph', 'nodes.json'), JSON.stringify(project.nodes, null, 2));
  await writeFile(join(baseDir, 'graph', 'edges.json'), JSON.stringify(project.edges, null, 2));
  await writeFile(join(baseDir, 'layout.json'), JSON.stringify(project.layout, null, 2));
  await writeFile(join(baseDir, 'graph', 'composites.json'), JSON.stringify(project.composites, null, 2));
  await writeFile(join(baseDir, 'custom-blocks', 'definitions.json'), JSON.stringify(project.customBlocks, null, 2));
  await writeFile(join(baseDir, 'graph', 'registry.snapshot.json'), JSON.stringify(project.registry, null, 2));
  await writeFile(join(baseDir, 'authoring.decisions.json'), JSON.stringify(project.authoring, null, 2));

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
  const composites = JSON.parse(await readFile(join(baseDir, 'graph', 'composites.json'), 'utf8'));
  const customBlocks = JSON.parse(await readFile(join(baseDir, 'custom-blocks', 'definitions.json'), 'utf8'));
  const registry = JSON.parse(await readFile(join(baseDir, 'graph', 'registry.snapshot.json'), 'utf8'));
  const authoring = JSON.parse(await readFile(join(baseDir, 'authoring.decisions.json'), 'utf8'));
  const skillContent = await readFile(join(baseDir, 'skills', `${manifest.name}-skill.md`), 'utf8');

  return {
    manifest,
    nodes,
    edges,
    layout,
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
