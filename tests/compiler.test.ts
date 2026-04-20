import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateHarnessProject } from '../src/core/generator';
import { compileClaude } from '../src/compiler/claude';

describe('compileClaude', () => {
  test('writes a Claude plugin package with hooks and skills', async () => {
    const out = await mkdtemp(join(tmpdir(), 'harness-editor-compile-'));
    const project = generateHarnessProject('compile-sample', 'Create a review harness with approval and mcp server');
    const result = await compileClaude(project, out);
    expect(result.generatedFiles.some((file) => file.endsWith('plugin.json'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('hooks.json'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('SKILL.md'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('.mcp.json'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('mcp-server.mjs'))).toBe(true);
  });
});
