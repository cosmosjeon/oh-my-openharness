import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateHarnessProject } from '../src/core/generator';
import { writeHarnessProject } from '../src/core/project';
import { validateProject } from '../src/sandbox/validate';

describe('validateProject', () => {
  test('runs generated hooks in isolation and emits trace output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-project-'));
    const projectDir = join(root, 'demo');
    const project = generateHarnessProject('demo', 'Create a harness with review loop and approval');
    await writeHarnessProject(projectDir, project);
    const result = await validateProject(projectDir);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.htmlReport.endsWith('.html')).toBe(true);
  });
});
