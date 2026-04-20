import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

function runCli(args: string[]) {
  return spawnSync('bun', ['run', 'src/index.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
}

describe('CLI entrypoint', () => {
  test('starts the Phase 0 CLI without requiring a subcommand in non-interactive mode', () => {
    const result = runCli([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Harness Editor Phase 0 CLI is ready');
  });

  test('blocks risky generation unless confirmation is provided', () => {
    const result = runCli(['new', '--name', 'risky-cli', '--prompt', 'Create a harness with full access and bypass safety']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Generation requires confirmation before proceeding');
    expect(result.stderr).toContain('confirm-risk-permissions');
  });
});
