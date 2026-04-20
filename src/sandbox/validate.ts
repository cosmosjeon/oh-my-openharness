import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadHarnessProject } from '../core/project';
import type { SandboxRunResult, TraceEvent } from '../core/types';
import { compileClaude } from '../compiler/claude';
import { renderTraceHtml } from '../web/report';

const SAMPLE_PAYLOADS: Record<string, string> = {
  SessionStart: JSON.stringify({ session: 'sandbox-start' }),
  UserPromptSubmit: JSON.stringify({ prompt: 'sandbox prompt' }),
  PreToolUse: JSON.stringify({ tool: 'Write' }),
  PostToolUse: JSON.stringify({ tool: 'Write', ok: true }),
  Stop: JSON.stringify({ reason: 'done' })
};

export async function validateProject(projectDir: string, outDir?: string): Promise<SandboxRunResult> {
  const sandboxDir = await mkdtemp(join(tmpdir(), 'harness-editor-'));
  const compileDir = outDir ?? join(sandboxDir, 'compiled');
  await mkdir(compileDir, { recursive: true });

  const project = await loadHarnessProject(projectDir);
  await compileClaude(project, compileDir);

  const traceFile = join(sandboxDir, 'trace.jsonl');
  const scriptsDir = join(compileDir, 'scripts');
  for (const [hook, payload] of Object.entries(SAMPLE_PAYLOADS)) {
    const scriptPath = join(scriptsDir, `${hook}.mjs`);
    try {
      await access(scriptPath);
    } catch {
      continue;
    }
    const result = spawnSync('node', [scriptPath], {
      env: { ...process.env, HARNESS_EDITOR_TRACE_FILE: traceFile },
      input: payload,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(`Sandbox hook failed for ${hook}: ${result.stderr || result.stdout}`);
    }
  }

  const mcpServerScript = join(scriptsDir, 'mcp-server.mjs');
  try {
    await access(mcpServerScript);
    const mcpResult = spawnSync('node', [mcpServerScript], {
      env: { ...process.env, HARNESS_EDITOR_TRACE_FILE: traceFile },
      encoding: 'utf8'
    });
    if (mcpResult.status !== 0) {
      throw new Error(`Sandbox MCP server failed: ${mcpResult.stderr || mcpResult.stdout}`);
    }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Sandbox MCP server failed')) {
      // missing MCP server is fine
    } else {
      throw error;
    }
  }

  const rawTrace = await readFile(traceFile, 'utf8');
  const events = rawTrace
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEvent);
  const failure = events.find((event) => event.status === 'error');

  const htmlReport = join(sandboxDir, 'trace-report.html');
  await writeFile(htmlReport, renderTraceHtml(project.manifest.name, events));

  return {
    sandboxDir,
    installDir: compileDir,
    traceFile,
    htmlReport,
    events,
    success: !failure,
    failure
  };
}
