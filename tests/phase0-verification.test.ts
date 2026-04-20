import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileClaude } from '../src/compiler/claude';
import { generateHarnessProject } from '../src/core/generator';
import { loadHarnessProject, writeHarnessProject } from '../src/core/project';
import type { TraceEvent } from '../src/core/types';
import { validateProject } from '../src/sandbox/validate';
import { renderTraceHtml } from '../src/web/report';

function runCli(args: string[], cwd: string) {
  return spawnSync('bun', ['run', 'src/index.ts', ...args], {
    cwd,
    encoding: 'utf8'
  });
}

describe('Phase 0 verification coverage', () => {
  test('CLI new creates a working harness skeleton and adds a permission gate for risky prompts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-cli-'));
    const result = runCli(
      [
        'new',
        '--name',
        'cli-phase0',
        '--prompt',
        'Create a harness with approval flow, risky permissions, and mcp server',
        '--dir',
        root
      ],
      process.cwd()
    );

    expect(result.status).toBe(0);

    const projectDir = result.stdout.trim();
    expect(projectDir).toBe(join(root, 'cli-phase0'));

    const project = await loadHarnessProject(projectDir);
    expect(project.nodes.some((node) => node.kind === 'Permission')).toBe(true);
    expect(project.nodes.some((node) => node.kind === 'MCPServer')).toBe(true);
  });

  test('compileClaude writes a valid Claude package with required surfaces and optional MCP config', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'harness-editor-compile-verify-'));
    const project = generateHarnessProject(
      'compile-verify',
      'Create a review harness with approval flow, mcp server, and retry loop'
    );

    const result = await compileClaude(project, outDir);
    const pluginJson = JSON.parse(await readFile(join(result.pluginRoot, 'plugin.json'), 'utf8'));
    const hooksJson = JSON.parse(await readFile(join(outDir, 'hooks', 'hooks.json'), 'utf8'));
    const mcpJson = JSON.parse(await readFile(join(outDir, '.mcp.json'), 'utf8'));

    expect(pluginJson.name).toBe(project.manifest.name);
    expect(pluginJson.skills).toBe('./skills/');
    expect(pluginJson.mcpServers).toBe('./.mcp.json');
    expect(hooksJson.description).toContain(project.manifest.name);
    expect(Object.keys(hooksJson.hooks)).toEqual(['SessionStart', 'UserPromptSubmit', 'Stop']);
    expect(mcpJson.mcpServers[`${project.manifest.name}-generated`].command).toBe('node');
    expect(result.generatedFiles.some((file) => file.endsWith('scripts/SessionStart.mjs'))).toBe(true);
    expect(result.generatedFiles.some((file) => file.endsWith('scripts/mcp-server.mjs'))).toBe(true);
  });

  test('generated projects validate in isolated sandbox with structured trace output and no manual edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-editor-sandbox-verify-'));
    const projectDir = join(root, 'phase0-demo');
    const project = generateHarnessProject(
      'phase0-demo',
      'Create a harness with review loop, approval flow, and mcp server'
    );

    await writeHarnessProject(projectDir, project);
    const result = await validateProject(projectDir);

    expect(result.sandboxDir).not.toBe(projectDir);
    expect(result.sandboxDir.startsWith(projectDir)).toBe(false);
    expect(result.events.length).toBeGreaterThanOrEqual(4);
    expect(result.events.some((event) => event.hook === 'SessionStart')).toBe(true);
    expect(result.events.some((event) => event.hook === 'UserPromptSubmit')).toBe(true);
    expect(result.events.some((event) => event.hook === 'Stop')).toBe(true);
    expect(result.events.some((event) => event.hook === 'MCPServer')).toBe(true);

    for (const event of result.events) {
      expect(typeof event.timestamp).toBe('string');
      expect(typeof event.hook).toBe('string');
      expect(typeof event.nodeId).toBe('string');
      expect(['ok', 'error']).toContain(event.status);
      expect(typeof event.message).toBe('string');
    }
  });

  test('trace reports surface failure context for a GUI consumer', () => {
    const events: TraceEvent[] = [
      {
        timestamp: '2026-04-20T12:00:00.000Z',
        hook: 'PostToolUse',
        nodeId: 'review-loop',
        status: 'error',
        message: 'review-loop failed: permission denied'
      }
    ];

    const html = renderTraceHtml('phase0-demo', events);
    expect(html).toContain('phase0-demo Runtime Trace');
    expect(html).toContain('review-loop');
    expect(html).toContain('error');
    expect(html).toContain('permission denied');
  });
});
