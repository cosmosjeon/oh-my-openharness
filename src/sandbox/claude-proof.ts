import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ClaudeHostSandboxProof {
  ok: boolean;
  status: 'blocked' | 'passed' | 'failed';
  runtime: 'claude-code';
  projectDir: string;
  reason: string;
  artifactPath?: string;
  command?: string;
}

function isRealProofEnabled() {
  return process.env.HARNESS_REAL_CLAUDE_PROOF === '1';
}

function claudeVersion(): { ok: boolean; output: string } {
  const result = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  };
}

export async function proveClaudeHostSandbox(projectDir: string): Promise<ClaudeHostSandboxProof> {
  const resolvedProjectDir = resolve(projectDir);
  const proofRoot = await mkdtemp(join(tmpdir(), 'oh-my-openharness-claude-proof-'));
  await mkdir(proofRoot, { recursive: true });
  const artifactPath = join(proofRoot, 'claude-host-proof.json');

  if (!isRealProofEnabled()) {
    const proof: ClaudeHostSandboxProof = {
      ok: false,
      status: 'blocked',
      runtime: 'claude-code',
      projectDir: resolvedProjectDir,
      reason: 'Real Claude host sandbox proof is disabled. Set HARNESS_REAL_CLAUDE_PROOF=1 on an authenticated Claude Code host to attempt release proof; V1 100% cannot be claimed from synthetic replay alone.',
      artifactPath
    };
    await writeFile(artifactPath, JSON.stringify(proof, null, 2));
    return proof;
  }

  const version = claudeVersion();
  if (!version.ok) {
    const proof: ClaudeHostSandboxProof = {
      ok: false,
      status: 'blocked',
      runtime: 'claude-code',
      projectDir: resolvedProjectDir,
      reason: `Claude CLI is unavailable or not authenticated for isolated host proof: ${version.output || 'claude --version failed'}`,
      artifactPath,
      command: 'claude --version'
    };
    await writeFile(artifactPath, JSON.stringify(proof, null, 2));
    return proof;
  }

  const proof: ClaudeHostSandboxProof = {
    ok: false,
    status: 'blocked',
    runtime: 'claude-code',
    projectDir: resolvedProjectDir,
    reason: `Claude CLI is present (${version.output}), but this automated release lane does not have a noninteractive authenticated real-host runner configured. Record this blocker rather than claiming V1 100% from synthetic hook replay.`,
    artifactPath,
    command: 'claude --version'
  };
  await writeFile(artifactPath, JSON.stringify(proof, null, 2));
  return proof;
}
