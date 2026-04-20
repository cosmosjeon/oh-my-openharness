import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRiskConfirmations, generateHarnessProject } from '../src/core/generator';
import { compileClaude } from '../src/compiler/claude';
import { generateHarnessProject } from '../src/core/generator';

describe('compileClaude', () => {
  test('writes a Claude plugin package with hooks, skills, and trace schema', async () => {
    const out = await mkdtemp(join(tmpdir(), 'harness-editor-compile-'));
    const project = applyRiskConfirmations(
      generateHarnessProject('compile-sample', 'Create a review harness with approval and mcp server'),
      true
    );
    const result = await compileClaude(project, out);
    expect(result.generatedFiles.some((file) => file.endsWith('plugin.json'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('hooks.json'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('SKILL.md'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('trace-schema.json'))).toBe(true);

    const plugin = JSON.parse(await readFile(join(out, '.claude-plugin', 'plugin.json'), 'utf8')) as {
      hooks: string;
      mcpServers?: string;
    };
    expect(plugin.hooks).toBe('./hooks/hooks.json');
    expect(plugin.mcpServers).toBe('./.mcp.json');
  });
});
