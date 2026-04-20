import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRiskConfirmations, generateHarnessProject } from '../src/core/generator';
import { writeHarnessProject } from '../src/core/project';
import { validateProject } from '../src/sandbox/validate';

describe('validateProject', () => {
  test('runs generated hooks in isolation and emits structured trace output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-project-'));
    const projectDir = join(root, 'demo');
    const project = applyRiskConfirmations(
      generateHarnessProject('demo', 'Create a harness with review loop and approval'),
      true
    );
    await writeHarnessProject(projectDir, project);

    const result = await validateProject(projectDir);
    expect(result.success).toBe(true);
    expect(result.sandboxDir).not.toBe(result.installDir);
    expect(result.events.some((event) => event.eventType === 'hook-activation')).toBe(true);
    expect(result.events.some((event) => event.eventType === 'branch-selection')).toBe(true);
    expect(result.events.some((event) => event.eventType === 'loop-iteration')).toBe(true);
    expect(result.events.some((event) => event.eventType === 'state-transition')).toBe(true);
    expect(result.htmlReport.endsWith('.html')).toBe(true);
  });

  test('surfaces failing hooks with enough context for a future GUI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-project-'));
    const projectDir = join(root, 'demo');
    const project = applyRiskConfirmations(generateHarnessProject('demo', 'Create a basic harness'), true);
    await writeHarnessProject(projectDir, project);
    const result = await validateProject(projectDir, { failHook: 'PreToolUse' });
    expect(result.success).toBe(false);
    expect(result.failure?.eventType).toBe('failure');
    expect(String(result.failure?.metadata?.stderr ?? '')).toContain('Injected failure');
  });
});
