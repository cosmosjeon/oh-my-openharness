import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileClaude } from '../src/compiler/claude';
import { compileCodex } from '../src/compiler/codex';
import { compileOpenCode } from '../src/compiler/opencode';
import { generateHarnessProject } from '../src/core/generator';

describe('compileClaude', () => {
  test('writes a Claude plugin package with colocated hooks, skills, and scripts', async () => {
    const out = await mkdtemp(join(tmpdir(), 'oh-my-openharness-compile-'));
    const project = generateHarnessProject('compile-sample', 'Create a review harness with approval, state memory, and mcp server');
    const result = await compileClaude(project, out);

    const pluginJsonPath = join(out, '.claude-plugin', 'plugin.json');
    const hooksJsonPath = join(out, '.claude-plugin', 'hooks', 'hooks.json');
    const pluginJson = JSON.parse(await readFile(pluginJsonPath, 'utf8')) as { skills: string; mcpServers?: string };
    const hooksJson = JSON.parse(await readFile(hooksJsonPath, 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };

    expect(result.generatedFiles.some((file) => file === pluginJsonPath)).toBe(true);
    expect(result.generatedFiles.some((file) => file === hooksJsonPath)).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('.claude-plugin/skills/compile-sample-skill/SKILL.md'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('.claude-plugin/scripts/SessionStart.mjs'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('.claude-plugin/.mcp.json'))).toBe(true);
    expect(pluginJson.skills).toBe('./skills');
    expect(pluginJson.mcpServers).toBe('./.mcp.json');
    expect(hooksJson.hooks.SessionStart[0]?.hooks[0]?.command).toContain('$CLAUDE_PLUGIN_ROOT');
  });

  test('embeds canonical node ids and validation metadata into generated trace scripts', async () => {
    const out = await mkdtemp(join(tmpdir(), 'oh-my-openharness-compile-ids-'));
    const project = generateHarnessProject('compile-ids', 'Create a review harness with approval flow');
    const result = await compileClaude(project, out);
    const script = await readFile(join(result.pluginRoot, 'scripts', 'SessionStart.mjs'), 'utf8');
    const validationManifest = JSON.parse(await readFile(result.validationManifestPath, 'utf8')) as {
      steps: Array<{ hook: string; nodeId: string; command: string }>;
    };

    expect(script).toContain('sessionstart-1');
    expect(script).toContain('graphHash');
    expect(validationManifest.steps.find((step) => step.hook === 'SessionStart')?.nodeId).toBe('sessionstart-1');
  });
});

describe('runtime-specific compilers', () => {
  test('writes an OpenCode-native authoring bundle and validation manifest', async () => {
    const out = await mkdtemp(join(tmpdir(), 'oh-my-openharness-opencode-compile-'));
    const project = generateHarnessProject('compile-opencode', 'Create a harness with review loop and state memory', 'opencode');
    const result = await compileOpenCode(project, out);
    const config = JSON.parse(await readFile(join(result.pluginRoot, 'oh-my-openharness.jsonc'), 'utf8')) as { targetRuntime: string; hostCommand: string };
    const exportManifest = JSON.parse(await readFile(result.exportManifestPath, 'utf8')) as { runtime: string; runtimeAdapter: string[] };

    expect(result.runtime).toBe('opencode');
    expect(config.targetRuntime).toBe('opencode');
    expect(config.hostCommand).toContain('opencode');
    expect(exportManifest.runtime).toBe('opencode');
    expect(exportManifest.runtimeAdapter).toContain('skills/');
    expect(result.generatedFiles.some((file) => file.endsWith('.opencode/skills/compile-opencode-skill/SKILL.md'))).toBe(true);
  });

  test('writes a Codex-native authoring bundle and validation manifest', async () => {
    const out = await mkdtemp(join(tmpdir(), 'oh-my-openharness-codex-compile-'));
    const project = generateHarnessProject('compile-codex', 'Create a harness with review loop and state memory', 'codex');
    const result = await compileCodex(project, out);
    const config = JSON.parse(await readFile(join(result.pluginRoot, 'oh-my-openharness.json'), 'utf8')) as { targetRuntime: string; hostCommand: string };
    const exportManifest = JSON.parse(await readFile(result.exportManifestPath, 'utf8')) as { runtime: string; runtimeAdapter: string[] };

    expect(result.runtime).toBe('codex');
    expect(config.targetRuntime).toBe('codex');
    expect(config.hostCommand).toContain('codex');
    expect(exportManifest.runtime).toBe('codex');
    expect(exportManifest.runtimeAdapter).toContain('prompts/');
    expect(result.generatedFiles.some((file) => file.endsWith('.codex/skills/compile-codex-skill/SKILL.md'))).toBe(true);
  });
});
