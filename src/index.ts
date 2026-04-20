import { mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { generateHarnessProject } from './core/generator';
import { writeHarnessProject } from './core/project';
import { compileClaude } from './compiler/claude';
import { validateProject } from './sandbox/validate';

function usage() {
  console.log(`harness-editor <command> [options]\n\nCommands:\n  new --name <name> --prompt <prompt> [--dir <dir>]\n  compile --project <dir> [--out <dir>]\n  sandbox --project <dir> [--out <dir>]\n  demo --name <name> --prompt <prompt> [--dir <dir>]`);
}

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith('--')) {
      flags.set(token.slice(2), rest[i + 1] ?? '');
      i += 1;
    }
  }
  return { command, flags };
}

async function createProject(name: string, prompt: string, dir: string) {
  const target = resolve(dir, name);
  const project = generateHarnessProject(name, prompt);
  await writeHarnessProject(target, project);
  console.log(target);
}

async function compileProject(projectDir: string, outDir?: string) {
  const { loadHarnessProject } = await import('./core/project');
  const project = await loadHarnessProject(resolve(projectDir));
  const resolvedOut = resolve(outDir ?? join(projectDir, 'compiler', 'claude-code'));
  await mkdir(resolvedOut, { recursive: true });
  const result = await compileClaude(project, resolvedOut);
  console.log(JSON.stringify(result, null, 2));
}

async function sandboxProject(projectDir: string, outDir?: string) {
  const result = await validateProject(resolve(projectDir), outDir ? resolve(outDir) : undefined);
  console.log(JSON.stringify(result, null, 2));
}

async function demo(name: string, prompt: string, dir: string) {
  const projectDir = resolve(dir, name);
  await createProject(name, prompt, dir);
  await compileProject(projectDir);
  await sandboxProject(projectDir);
}

const { command, flags } = parseArgs(process.argv.slice(2));
if (!command) {
  usage();
  process.exit(1);
}

const name = flags.get('name') ?? basename(process.cwd());
const prompt = flags.get('prompt') ?? 'Create a basic harness';
const dir = flags.get('dir') ?? '.harness-editor';
const projectDir = flags.get('project');
const outDir = flags.get('out');

switch (command) {
  case 'new':
    await createProject(name, prompt, dir);
    break;
  case 'compile':
    if (!projectDir) throw new Error('--project is required');
    await compileProject(projectDir, outDir);
    break;
  case 'sandbox':
    if (!projectDir) throw new Error('--project is required');
    await sandboxProject(projectDir, outDir);
    break;
  case 'demo':
    await demo(name, prompt, dir);
    break;
  default:
    usage();
    process.exit(1);
}
