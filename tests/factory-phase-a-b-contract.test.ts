import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();
const reviewDocPath = join(repoRoot, 'docs', 'harness-factory-phase-a-b-review.md');
const registryPath = join(repoRoot, 'src', 'factory', 'reference', 'pattern-registry.json');

function runCli(args: string[]) {
  return spawnSync('bun', ['run', 'src/index.ts', ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8'
  });
}

async function pathExists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else files.push(fullPath);
  }

  return files.sort();
}

function parseModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const fromRegex = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const regex of [fromRegex, dynamicImportRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) specifiers.push(match[1]!);
  }

  return specifiers;
}

function referencesFactoryNamespace(specifier: string) {
  return (
    specifier === './factory' ||
    specifier === '../factory' ||
    specifier.endsWith('/factory') ||
    specifier.includes('/factory/')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function hasSourceRepo(entry: Record<string, unknown>) {
  if (typeof entry.sourceRepo === 'string' && entry.sourceRepo.length > 0) return true;

  const sourceRepos = entry.sourceRepos;
  if (Array.isArray(sourceRepos) && sourceRepos.some((source) => isRecord(source) && typeof source.repo === 'string' && source.repo.length > 0)) return true;

  const source = entry.source;
  if (isRecord(source) && typeof source.repo === 'string' && source.repo.length > 0) return true;

  const provenance = entry.provenance;
  if (isRecord(provenance) && typeof provenance.repo === 'string' && provenance.repo.length > 0) return true;

  return false;
}

function hasCapability(entry: Record<string, unknown>) {
  if (typeof entry.capability === 'string' && entry.capability.length > 0) return true;
  if (toStringArray(entry.capabilities).length > 0) return true;
  if (toStringArray(entry.tags).length > 0) return true;
  return false;
}

function hasSummary(entry: Record<string, unknown>) {
  const candidates = [entry.summary, entry.description, entry.why, entry.notes];
  return candidates.some((value) => typeof value === 'string' && value.length > 0);
}

describe('Harness Factory Phase A+B contract', () => {
  test('CLI still advertises the stable substrate commands during the additive factory slice', () => {
    const result = runCli(['unknown-command']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Commands:');
    for (const command of ['new', 'author', 'serve', 'sandbox', 'export']) {
      expect(result.stdout).toMatch(new RegExp(`^\\s+${command}\\b`, 'm'));
    }
  });

  test('non-factory source files do not import the factory namespace during Phase A+B', async () => {
    const sourceFiles = (await listFiles(join(repoRoot, 'src'))).filter((file) => {
      const relativePath = relative(repoRoot, file).split('\\').join('/');
      return relativePath.endsWith('.ts') && !relativePath.startsWith('src/factory/');
    });

    expect(sourceFiles.length).toBeGreaterThan(0);

    for (const file of sourceFiles) {
      const source = await readFile(file, 'utf8');
      const specifiers = parseModuleSpecifiers(source);
      expect(specifiers.some(referencesFactoryNamespace), relative(repoRoot, file)).toBe(false);
    }
  });

  test('Phase B registry contract is documented now and activates automatically once the registry exists', async () => {
    const review = await readFile(reviewDocPath, 'utf8');
    for (const phrase of [
      'pattern-registry.json',
      'approval gate',
      'review loop',
      'MCP registration',
      'memory persistence',
      'retry loop',
      'subagent delegation'
    ]) {
      expect(review).toContain(phrase);
    }

    if (!(await pathExists(registryPath))) return;

    const registry = JSON.parse(await readFile(registryPath, 'utf8')) as unknown;
    expect(Array.isArray(registry)).toBe(true);

    const entries = registry as unknown[];
    expect(entries.length).toBeGreaterThanOrEqual(6);

    for (const entry of entries) {
      expect(isRecord(entry)).toBe(true);
      const record = entry as Record<string, unknown>;
      expect(typeof record.id).toBe('string');
      expect((record.id as string).length).toBeGreaterThan(0);
      expect(hasSourceRepo(record)).toBe(true);
      expect(hasCapability(record)).toBe(true);
      expect(hasSummary(record)).toBe(true);
    }

    const registryText = JSON.stringify(entries).toLowerCase();
    for (const keyword of ['approval', 'review', 'mcp', 'memory', 'retry']) expect(registryText).toContain(keyword);
    expect(/subagent|delegation/.test(registryText)).toBe(true);
  });
});
