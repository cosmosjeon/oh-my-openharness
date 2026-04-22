import { spawnSync } from 'node:child_process';
import { describeRuntimeTarget } from './runtime-targets';
import type { HarnessProject, RuntimeTarget } from './types';

export interface HostAuthoringResult {
  runtime: RuntimeTarget;
  summary: string;
  emphasis: string[];
  warnings: string[];
  rawOutput: string;
  command: string;
}

function hostPrompt(prompt: string, runtime: RuntimeTarget): string {
  const runtimeName = describeRuntimeTarget(runtime).authoringNoun;
  return [
    `You are authoring inside ${runtimeName} for oh-my-openharness.`,
    'Return ONLY valid JSON with this exact shape:',
    '{"summary":"string","emphasis":["string"],"warnings":["string"]}',
    'Use concise strings. Do not include markdown fences or extra commentary.',
    `User request: ${prompt}`
  ].join(' ');
}

function commandForRuntime(runtime: RuntimeTarget, prompt: string): { command: string; args: string[] } {
  const compiledPrompt = hostPrompt(prompt, runtime);
  switch (runtime) {
    case 'claude-code':
      return { command: 'claude', args: ['-p', compiledPrompt] };
    case 'opencode':
      return { command: 'opencode', args: ['--pure', 'run', compiledPrompt] };
    case 'codex':
      return { command: 'codex', args: ['exec', compiledPrompt] };
  }
}

function parseJsonLine(text: string): { summary: string; emphasis?: string[]; warnings?: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of [...lines].reverse()) {
    try {
      const parsed = JSON.parse(line) as { summary: string; emphasis?: string[]; warnings?: string[] };
      if (typeof parsed.summary === 'string') return parsed;
    } catch {}
  }
  throw new Error('Host authoring output did not contain a valid JSON payload.');
}

export function invokeHostAuthoring(runtime: RuntimeTarget, prompt: string): HostAuthoringResult {
  const spec = commandForRuntime(runtime, prompt);
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.OPENCODE_CONFIG_DIR;
  delete env.CODEX_HOME;
  const result = spawnSync(spec.command, spec.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    maxBuffer: 10 * 1024 * 1024
  });
  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (result.status !== 0) throw new Error(`Host authoring command failed: ${spec.command} ${spec.args.join(' ')}\n${rawOutput}`);
  const parsed = parseJsonLine(rawOutput);
  return {
    runtime,
    summary: parsed.summary,
    emphasis: parsed.emphasis ?? [],
    warnings: parsed.warnings ?? [],
    rawOutput,
    command: `${spec.command} ${spec.args.join(' ')}`
  };
}

export function applyHostAuthoring(project: HarnessProject, authoring: HostAuthoringResult): HarnessProject {
  const skill = project.skills[0];
  return {
    ...project,
    skills: skill
      ? [
          {
            ...skill,
            content: `${skill.content}\n## Host-native authoring guidance\n- Runtime: ${describeRuntimeTarget(authoring.runtime).authoringNoun}\n- Summary: ${authoring.summary}\n- Emphasis: ${authoring.emphasis.join(', ') || 'none'}\n`
          },
          ...project.skills.slice(1)
        ]
      : project.skills,
    authoring: {
      ...project.authoring,
      summary: authoring.summary,
      warnings: [...new Set([`Host authoring runtime: ${describeRuntimeTarget(authoring.runtime).authoringNoun}`, ...authoring.warnings, ...project.authoring.warnings])]
    }
  };
}
