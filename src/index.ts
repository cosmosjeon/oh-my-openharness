import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { basename, join, resolve } from 'node:path';
import { BLOCK_REGISTRY, COMPOSITE_PATTERNS } from './core/registry';
import { applyRiskConfirmations, generateHarnessProject } from './core/generator';
import { loadHarnessProject, writeHarnessProject } from './core/project';
import { compileClaude } from './compiler/claude';
import { validateProject } from './sandbox/validate';

type ParsedArgs = { command?: string; flags: Map<string, string>; booleans: Set<string> };

function usage() {
  console.log(`harness-editor <command> [options]\n\nCommands:\n  chat [--name <name>] [--dir <dir>]\n  new --name <name> --prompt <prompt> [--dir <dir>] [--confirm-risk]\n  compile --project <dir> [--out <dir>]\n  sandbox --project <dir> [--out <dir>] [--fail-hook <hook>]\n  catalog\n  demo --name <name> --prompt <prompt> [--dir <dir>]`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) booleans.add(key);
    else {
      flags.set(key, next);
      index += 1;
    }
  }
  return { command, flags, booleans };
}

function requiresConfirmationMessage(confirmations: Array<{ id: string; kind: string; message: string }>) {
  return ['Generation requires confirmation before proceeding:', ...confirmations.map((item) => `- [${item.kind}] ${item.message} (${item.id})`), 'Re-run with --confirm-risk or use the interactive `chat` command.'].join('\n');
}

async function createProject(name: string, prompt: string, dir: string, confirmRisk: boolean) {
  const target = resolve(dir, name);
  let project = generateHarnessProject(name, prompt);
  if (project.authoring.confirmationRequests.length > 0 && !confirmRisk) throw new Error(requiresConfirmationMessage(project.authoring.confirmationRequests));
  if (confirmRisk) project = applyRiskConfirmations(project, true);
  await writeHarnessProject(target, project);
  console.log(JSON.stringify({ projectDir: target, summary: project.authoring.summary, confirmations: project.authoring.confirmationRequests, traceIntent: project.authoring.traceIntent }, null, 2));
  return target;
}

async function compileProject(projectDir: string, outDir?: string) {
  const project = await loadHarnessProject(resolve(projectDir));
  const unresolved = project.authoring.confirmationRequests.filter((request) => !request.confirmed);
  if (unresolved.length > 0) throw new Error(requiresConfirmationMessage(unresolved));
  const resolvedOut = resolve(outDir ?? join(projectDir, 'compiler', 'claude-code'));
  await mkdir(resolvedOut, { recursive: true });
  const result = await compileClaude(project, resolvedOut);
  console.log(JSON.stringify(result, null, 2));
}

async function sandboxProject(projectDir: string, outDir?: string, failHook?: string) {
  const result = await validateProject(resolve(projectDir), { ...(outDir ? { outDir: resolve(outDir) } : {}), ...(failHook ? { failHook } : {}) });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

async function catalog() {
  console.log(JSON.stringify({ blocks: BLOCK_REGISTRY, composites: COMPOSITE_PATTERNS }, null, 2));
}

async function chat(defaultName: string, defaultDir: string) {
  if (!input.isTTY || !output.isTTY) {
    console.log('Harness Editor Phase 0 CLI is ready. Run `harness-editor chat` in a TTY or use `new --prompt ...`.');
    return;
  }

  const rl = createInterface({ input, output });
  try {
    console.log('Harness Editor Phase 0 — CLI-first harness-maker');
    const name = (await rl.question(`Harness name (${defaultName}): `)).trim() || defaultName;
    const prompt = (await rl.question('Describe the harness you want to generate: ')).trim();
    const dir = (await rl.question(`Project directory (${defaultDir}): `)).trim() || defaultDir;
    if (!prompt) throw new Error('A harness intent prompt is required.');

    let project = generateHarnessProject(name, prompt);
    if (project.authoring.confirmationRequests.length > 0) {
      for (const request of project.authoring.confirmationRequests) {
        const answer = (await rl.question(`${request.message} [y/N]: `)).trim().toLowerCase();
        if (answer !== 'y' && answer !== 'yes') {
          console.log(`Cancelled generation because ${request.id} was not approved.`);
          return;
        }
      }
      project = applyRiskConfirmations(project, true);
    }

    const target = resolve(dir, name);
    await writeHarnessProject(target, project);
    console.log(`Created ${target}`);
    console.log(`Next steps:\n  harness-editor compile --project ${target}\n  harness-editor sandbox --project ${target}`);
  } finally {
    rl.close();
  }
}

async function demo(name: string, prompt: string, dir: string) {
  const projectDir = resolve(dir, name);
  await createProject(name, prompt, dir, true);
  await compileProject(projectDir);
  await sandboxProject(projectDir);
}

const parsed = parseArgs(process.argv.slice(2));
const name = parsed.flags.get('name') ?? basename(process.cwd());
const prompt = parsed.flags.get('prompt') ?? 'Create a basic harness';
const dir = parsed.flags.get('dir') ?? '.harness-editor';
const projectDir = parsed.flags.get('project');
const outDir = parsed.flags.get('out');
const confirmRisk = parsed.booleans.has('confirm-risk') || parsed.flags.get('confirm-risk') === 'true';
const failHook = parsed.flags.get('fail-hook');

if (!parsed.command) {
  await chat(name, dir);
} else {
  switch (parsed.command) {
    case 'chat':
      await chat(name, dir);
      break;
    case 'new':
      await createProject(name, prompt, dir, confirmRisk);
      break;
    case 'compile':
      if (!projectDir) throw new Error('--project is required');
      await compileProject(projectDir, outDir);
      break;
    case 'sandbox':
      if (!projectDir) throw new Error('--project is required');
      await sandboxProject(projectDir, outDir, failHook);
      break;
    case 'catalog':
      await catalog();
      break;
    case 'demo':
      await demo(name, prompt, dir);
      break;
    default:
      usage();
      process.exit(1);
  }
}
