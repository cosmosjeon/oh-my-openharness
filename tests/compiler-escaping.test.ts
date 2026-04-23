import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpServerScript, scriptForHook } from '../src/compiler/runtime-common';
import type { HarnessProject, TraceEvent } from '../src/core/types';

function createProject(): HarnessProject {
  return {
    manifest: {
      name: 'proj "quoted" \\\\ slash\nline',
      version: '0.0.0',
      description: 'escaping regression fixture',
      targetRuntime: 'codex',
      supportedRuntimes: ['codex'],
      createdAt: '2026-04-23T00:00:00.000Z',
      prompt: 'prompt body',
      graphHash: 'graph "hash" \\\\ slash\nline'
    },
    nodes: [
      { id: 'session "id" \\\\ slash\nline', kind: 'SessionStart', label: 'Session "label" \\\\ slash\nline' },
      { id: 'prompt "id" \\\\ slash\nline', kind: 'UserPromptSubmit', label: 'Prompt "label" \\\\ slash\nline' },
      { id: 'skill "id" \\\\ slash\nline', kind: 'Skill', label: 'Skill "label" \\\\ slash\nline' },
      { id: 'mcp "id" \\\\ slash\nline', kind: 'MCPServer', label: 'MCP "label" \\\\ slash\nline' }
    ],
    edges: [],
    skills: [],
    layout: [],
    composites: [],
    customBlocks: [],
    registry: { blocks: [], composites: [] },
    authoring: {
      summary: 'escaping regression fixture',
      warnings: [],
      confirmationRequests: [],
      compatibleRuntimes: ['codex'],
      traceIntent: []
    },
    runtimeIntents: []
  };
}

async function writeScript(filename: string, script: string) {
  const dir = await mkdtemp(join(tmpdir(), 'omoh-compiler-escaping-'));
  const scriptPath = join(dir, filename);
  await writeFile(scriptPath, script);
  return { dir, scriptPath, traceFile: join(dir, 'trace.jsonl') };
}

async function readTrace(traceFile: string): Promise<TraceEvent[]> {
  const contents = await readFile(traceFile, 'utf8');
  return contents
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEvent);
}

describe('runtime script escaping', () => {
  test('scriptForHook safely serializes quoted project names, ids, and labels into generated JS', async () => {
    const project = createProject();
    const { scriptPath, traceFile } = await writeScript('UserPromptSubmit.mjs', scriptForHook('UserPromptSubmit', project, 'codex'));

    const result = spawnSync('node', [scriptPath], {
      input: JSON.stringify({ prompt: 'payload "quote" \\\\ slash\nline' }),
      env: { ...process.env, OMOH_TRACE_FILE: traceFile },
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ continue: true, hook: 'UserPromptSubmit', traceCount: 2, runtime: 'codex' });

    const [hookEvent, skillEvent] = await readTrace(traceFile);
    expect(hookEvent).toMatchObject({
      hook: 'UserPromptSubmit',
      nodeId: 'prompt "id" \\\\ slash\nline',
      message: 'proj "quoted" \\\\ slash\nline:UserPromptSubmit'
    });
    expect(skillEvent).toMatchObject({
      hook: 'UserPromptSubmit',
      nodeId: 'skill "id" \\\\ slash\nline',
      message: 'Skill activated: Skill "label" \\\\ slash\nline'
    });
  });

  test('mcpServerScript safely serializes quoted project names and ids into generated JS', async () => {
    const project = createProject();
    const { scriptPath, traceFile } = await writeScript('mcp-server.mjs', mcpServerScript(project, 'codex'));

    const result = spawnSync('node', [scriptPath], {
      env: { ...process.env, OMOH_TRACE_FILE: traceFile },
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      name: 'proj "quoted" \\\\ slash\nline-generated',
      status: 'ready',
      mode: 'stdio',
      runtime: 'codex'
    });

    const [serverEvent] = await readTrace(traceFile);
    expect(serverEvent).toMatchObject({
      hook: 'MCPServer',
      nodeId: 'mcp "id" \\\\ slash\nline',
      eventType: 'mcp-server',
      message: 'proj "quoted" \\\\ slash\nline:MCPServer',
      metadata: {
        graphHash: 'graph "hash" \\\\ slash\nline',
        runtime: 'codex'
      }
    });
  });
});
