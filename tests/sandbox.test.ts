import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateHarnessProject } from '../src/core/generator';
import { writeHarnessProject } from '../src/core/project';
import { validateProject } from '../src/sandbox/validate';

describe('validateProject', () => {
  test('runs generated hooks in isolation and emits structured trace output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-project-'));
    const projectDir = join(root, 'demo');
    const project = generateHarnessProject('demo', 'Create a harness with review loop, approval, state memory, and mcp server');
    await writeHarnessProject(projectDir, project);

    const result = await validateProject(projectDir);
    const eventTypes = new Set(result.events.map((event) => String((event as unknown as Record<string, unknown>).eventType ?? '')));
    const reportHtml = await readFile(result.htmlReport, 'utf8');

    expect(result.traceFile.startsWith(result.sandboxDir)).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    expect(eventTypes.has('hook')).toBe(true);
    expect(eventTypes.has('branch')).toBe(true);
    expect(eventTypes.has('loop_iteration')).toBe(true);
    expect(eventTypes.has('state_mutation')).toBe(true);
    expect(eventTypes.has('runtime_ready')).toBe(true);
    expect(reportHtml).toContain('Event Type');
    expect(reportHtml).toContain('Permission gate requires approval');
  });

  test('surfaces hook failures with trace report context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-project-'));
    const projectDir = join(root, 'demo-fail');
    const project = generateHarnessProject('demo-fail', 'Create a harness __FORCE_SANDBOX_FAILURE__');
    await writeHarnessProject(projectDir, project);

    try {
      await validateProject(projectDir);
      throw new Error('expected validateProject to fail');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reportPath = message.match(/Trace report: (.*)\nTrace log:/)?.[1];
      expect(message).toContain('Forced sandbox failure');
      expect(reportPath).toBeTruthy();
      if (reportPath) {
        const reportHtml = await readFile(reportPath, 'utf8');
        expect(reportHtml).toContain('Forced sandbox failure');
        expect(reportHtml).toContain('Error events');
      }
    }
  });
});
