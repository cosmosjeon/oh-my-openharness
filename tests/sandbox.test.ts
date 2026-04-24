import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRiskConfirmations, generateHarnessProject } from '../src/core/generator';
import { writeHarnessProject } from '../src/core/project';
import { validateProject } from '../src/sandbox/validate';

describe('validateProject', () => {
  test('runs generated hooks in isolation and emits structured trace output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-project-'));
    const projectDir = join(root, 'demo');
    const project = applyRiskConfirmations(
      generateHarnessProject('demo', 'Create a harness with review loop, approval, state memory, and mcp server'),
      true
    );
    await writeHarnessProject(projectDir, project);

    const result = await validateProject(projectDir);
    const eventTypes = new Set(result.events.map((event) => event.eventType));
    const reportHtml = await readFile(result.htmlReport, 'utf8');

    expect(result.traceFile).toContain('/sandbox/trace.jsonl');
    expect(result.installDir.length).toBeGreaterThan(0);
    expect(result.success).toBe(true);
    expect(eventTypes.has('hook-activation')).toBe(true);
    expect(eventTypes.has('branch-selection')).toBe(true);
    expect(eventTypes.has('loop-iteration')).toBe(true);
    expect(eventTypes.has('state-transition')).toBe(true);
    expect(eventTypes.has('mcp-server')).toBe(true);
    expect(reportHtml).toContain('Event Type');
    expect(reportHtml).toContain('Permission gate requires approval');
  });

  test('surfaces hook failures with trace report context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-project-'));
    const projectDir = join(root, 'demo-fail');
    const project = applyRiskConfirmations(generateHarnessProject('demo-fail', 'Create a harness __FORCE_SANDBOX_FAILURE__'), true);
    await writeHarnessProject(projectDir, project);

    const result = await validateProject(projectDir, { failHook: 'UserPromptSubmit' });
    expect(result.success).toBe(false);
    expect(result.failure?.message).toContain('Hook command failed');
    const reportHtml = await readFile(result.htmlReport, 'utf8');
    expect(reportHtml).toContain('Error events');
    expect(reportHtml).toContain('Hook command failed');
  });

  test('localizes forced hook failure to a canonical graph node', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-project-'));
    const projectDir = join(root, 'demo-localized-fail');
    const project = applyRiskConfirmations(generateHarnessProject('demo-localized-fail', 'Create a harness with approval and review loop'), true);
    await writeHarnessProject(projectDir, project);

    const result = await validateProject(projectDir, { failHook: 'UserPromptSubmit' });
    const nodeIds = new Set(project.nodes.map((node) => node.id));
    const failure = [...result.events].reverse().find((event) => event.status === 'error' && nodeIds.has(event.nodeId));

    expect(result.success).toBe(false);
    expect(failure?.hook).toBe('UserPromptSubmit');
    expect(failure?.eventType).toBe('failure');
    expect(nodeIds.has(failure!.nodeId)).toBe(true);
  });

  test('maps MCP server trace event to the canonical MCP node', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oh-my-openharness-project-'));
    const projectDir = join(root, 'demo-mcp');
    const project = applyRiskConfirmations(generateHarnessProject('demo-mcp', 'Create a harness with mcp server and review loop'), true);
    await writeHarnessProject(projectDir, project);

    const result = await validateProject(projectDir);
    const mcpNode = project.nodes.find((node) => node.kind === 'MCPServer')!;
    const mcpEvent = result.events.find((event) => event.eventType === 'mcp-server');

    expect(result.success).toBe(true);
    expect(mcpEvent?.nodeId).toBe(mcpNode.id);
  });
});
