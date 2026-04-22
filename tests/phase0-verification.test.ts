import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRiskConfirmations, generateHarnessProject } from '../src/core/generator';
import { writeHarnessProject } from '../src/core/project';
import { compileClaude } from '../src/compiler/claude';
import { validateProject } from '../src/sandbox/validate';

describe('Phase 0 verification coverage', () => {
  test('CLI new creates a working harness skeleton and adds a permission gate for risky prompts', async () => {
    const project = generateHarnessProject('verify-cli', 'Create a harness with approval flow, mcp server, state memory, and review loop');
    expect(project.nodes.some((node) => node.kind === 'Permission')).toBe(true);
    expect(project.authoring.confirmationRequests.length).toBeGreaterThan(0);
  });

  test('compileClaude writes a valid Claude package with required surfaces and optional MCP config', async () => {
    const out = await mkdtemp(join(tmpdir(), 'oh-my-openharness-compile-verify-'));
    const project = applyRiskConfirmations(generateHarnessProject('verify-compile', 'Create a harness with approval flow and mcp server'), true);
    const result = await compileClaude(project, out);
    const pluginRoot = join(out, '.claude-plugin');
    const plugin = JSON.parse(await readFile(join(pluginRoot, 'plugin.json'), 'utf8')) as { hooks: string; skills: string; mcpServers?: string };
    expect(plugin.hooks).toBe('./hooks/hooks.json');
    expect(plugin.skills).toBe('./skills');
    expect(plugin.mcpServers).toBe('./.mcp.json');
    expect(result.generatedFiles.some((file) => file.endsWith('trace-schema.json'))).toBe(true);
  });

  test('generated projects validate in isolated sandbox with structured trace output and no manual edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-phase0-'));
    const projectDir = join(root, 'verify-phase0');
    const project = applyRiskConfirmations(generateHarnessProject('verify-phase0', 'Create a review harness with approvals, state memory, MCP server support, and retry loop'), true);
    await writeHarnessProject(projectDir, project);
    const result = await validateProject(projectDir);
    expect(result.success).toBe(true);
    expect(result.events.some((event) => event.eventType === 'mcp-server')).toBe(true);
    expect(result.events.some((event) => event.eventType === 'loop-iteration')).toBe(true);
  });

  test('trace reports surface failure context for a GUI consumer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-phase0-failure-'));
    const projectDir = join(root, 'verify-phase0-failure');
    const project = applyRiskConfirmations(generateHarnessProject('verify-phase0-failure', 'Create a harness __FORCE_SANDBOX_FAILURE__'), true);
    await writeHarnessProject(projectDir, project);
    const result = await validateProject(projectDir, { failHook: 'UserPromptSubmit' });
    const html = await readFile(result.htmlReport, 'utf8');
    expect(result.success).toBe(false);
    expect(html).toContain('Error events');
    expect(html).toContain('Hook command failed');
  });
});
