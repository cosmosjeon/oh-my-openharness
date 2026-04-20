import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileClaude } from '../src/compiler/claude';
import { generateHarnessProject } from '../src/core/generator';

describe('compileClaude', () => {
  test('writes a Claude plugin package with colocated hooks, skills, scripts, and trace schema', async () => {
    const out = await mkdtemp(join(tmpdir(), 'harness-editor-compile-'));
    const project = generateHarnessProject('compile-sample', 'Create a review harness with approval, state memory, and mcp server');
    const result = await compileClaude(project, out);

    const pluginJsonPath = join(out, '.claude-plugin', 'plugin.json');
    const hooksJsonPath = join(out, '.claude-plugin', 'hooks', 'hooks.json');
    const pluginJson = JSON.parse(await readFile(pluginJsonPath, 'utf8')) as { skills: string; hooks: string; mcpServers?: string };
    const hooksJson = JSON.parse(await readFile(hooksJsonPath, 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };

    expect(result.generatedFiles.some((file) => file === pluginJsonPath)).toBe(true);
    expect(result.generatedFiles.some((file) => file === hooksJsonPath)).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('.claude-plugin/skills/compile-sample-skill/SKILL.md'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('.claude-plugin/scripts/SessionStart.mjs'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('.claude-plugin/trace-schema.json'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('.claude-plugin/.mcp.json'))).toBe(true);
    expect(pluginJson.skills).toBe('./skills');
    expect(pluginJson.hooks).toBe('./hooks/hooks.json');
    expect(pluginJson.mcpServers).toBe('./.mcp.json');
    expect(hooksJson.hooks.SessionStart[0]?.hooks[0]?.command).toContain('$CLAUDE_PLUGIN_ROOT');
  });
});
