import packageJson from '../package.json' with { type: 'json' };
import { mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { applyRiskConfirmations, generateHarnessProject } from './core/generator';
import { BLOCK_REGISTRY, COMPOSITE_PATTERNS } from './core/registry';
import { applyHostAuthoring, invokeHostAuthoring } from './core/host-authoring';
import { importSeedProject } from './core/import-seed';
import { describeRuntimeTarget, parseRuntimeTarget } from './core/runtime-targets';
import { buildDoctorReport, buildSetupPlan, applySetupPlan, parseSetupRuntimes } from './core/runtime-setup';
import { loadHarnessProject, writeHarnessProject } from './core/project';
import type { RuntimeDoctorReport, RuntimeSetupPlan, RuntimeTarget, SetupRuntime } from './core/types';
import { compileProjectForRuntime } from './compiler';
import { exportProjectBundle } from './compiler/export';
import { validateProject } from './sandbox/validate';
import { startHarnessEditorServer } from './web/server';

const PRODUCT_NAME = 'oh-my-openharness';

type ParsedArgs = { command?: string; flags: Map<string, string>; booleans: Set<string> };

function usage() {
  console.log(`${PRODUCT_NAME} <command> [options]

Commands:
  setup [--runtimes <claude,opencode,codex>] [--yes] [--dry-run] [--json]
  doctor [--runtimes <claude,opencode,codex>] [--json]
  chat [--name <name>] [--dir <dir>] [--runtime <claude-code,opencode,codex>]
  author --name <name> --prompt <prompt> [--dir <dir>] [--runtime <claude-code,opencode,codex>] [--confirm-risk]
  new --name <name> --prompt <prompt> [--dir <dir>] [--runtime <claude-code,opencode,codex>] [--confirm-risk]
  import --from <dir> [--name <name>] [--dir <dir>] [--runtime <claude-code,opencode,codex>]
  compile --project <dir> [--out <dir>]
  export --project <dir> [--out <dir>]
  sandbox --project <dir> [--out <dir>] [--fail-hook <hook>]
  serve --project <dir> [--port <port>] [--host <host>] [--trace <file>]
  catalog
  demo --name <name> --prompt <prompt> [--dir <dir>]

`);
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
  return [
    'Generation requires confirmation before proceeding:',
    ...confirmations.map((item) => `- [${item.kind}] ${item.message} (${item.id})`),
    `Re-run with --confirm-risk or use the interactive \`chat\` command.`
  ].join('\n');
}

function missingRuntimeNames(plan: RuntimeSetupPlan): string[] {
  return plan.capabilityMatrix.filter((entry) => !entry.binaryDetected).map((entry) => entry.displayName);
}

function setupApprovalMessage(plan: RuntimeSetupPlan) {
  return [
    'OMOH setup requires one summary approval before writing runtime config:',
    ...plan.riskyWrites.map((change) => `- [${change.runtime}] ${change.kind.toUpperCase()} ${change.path} — ${change.reason}`),
    `Re-run with --yes, use --dry-run to inspect only, or start the interactive ${PRODUCT_NAME} wizard in a TTY.`
  ].join('\n');
}

function formatSetupPlan(plan: RuntimeSetupPlan): string {
  const lines = [
    `${PRODUCT_NAME} setup summary`,
    `Selected runtimes: ${plan.selectedRuntimes.join(', ')}`,
    `Approval mode: ${plan.approvalMode}`,
    `Safe reads: ${plan.safeReads.join('; ')}`
  ];

  for (const entry of plan.capabilityMatrix) {
    lines.push(
      '',
      `[${entry.displayName}] support=${entry.supportLevel} installStatus=${entry.installStatus}`,
      `  config root: ${entry.configRoot}`,
      `  install root: ${entry.installRoot}`,
      `  binary: ${entry.binaryDetected ? entry.binaryPath : `missing (${entry.binaryCandidates.join(', ')})`}`,
      `  approval: ${entry.approvalSemantics}`,
      `  rollback: ${entry.rollbackBehavior.join(' | ')}`,
      `  proof: ${entry.proofMethod}`
    );
  }

  if (plan.riskyWrites.length > 0) {
    lines.push('', 'Pending risky writes:');
    for (const write of plan.riskyWrites) lines.push(`  - [${write.runtime}] ${write.kind} ${write.path}`);
  } else {
    lines.push('', 'No pending risky writes.');
  }

  return lines.join('\n');
}

function formatDoctorReport(report: RuntimeDoctorReport): string {
  const lines = [`${PRODUCT_NAME} doctor`, `Bun: ${report.bun.available ? `ok (${report.bun.version})` : 'missing'}`];
  for (const runtime of report.runtimes) {
    lines.push(
      '',
      `[${runtime.displayName}] support=${runtime.supportLevel}`,
      `  config root: ${runtime.configRoot}`,
      `  install root: ${runtime.installRoot}`,
      `  binary: ${runtime.binaryDetected ? runtime.binaryPath : 'missing'}`,
      `  install shape: ${runtime.installShape.status} — ${runtime.installShape.details.join(' ')}`,
      `  host readiness: ${runtime.hostReadiness.status} — ${runtime.hostReadiness.details.join(' ')}`,
      `  next check: ${runtime.suggestedNextCommand}`
    );
  }
  return lines.join('\n');
}

async function requestSummaryApproval(plan: RuntimeSetupPlan): Promise<boolean> {
  if (!input.isTTY || !output.isTTY) return false;
  const rl = createInterface({ input, output });
  try {
    console.log(formatSetupPlan(plan));
    const answer = (await rl.question('\nApply these setup writes? [y/N]: ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function createProject(name: string, prompt: string, dir: string, confirmRisk: boolean, targetRuntime: RuntimeTarget) {
  const target = resolve(dir, name);
  let project = generateHarnessProject(name, prompt, targetRuntime);
  if (project.authoring.confirmationRequests.length > 0 && !confirmRisk) throw new Error(requiresConfirmationMessage(project.authoring.confirmationRequests));
  if (confirmRisk) project = applyRiskConfirmations(project, true);
  await writeHarnessProject(target, project);
  console.log(JSON.stringify({ projectDir: target, summary: project.authoring.summary, confirmations: project.authoring.confirmationRequests, traceIntent: project.authoring.traceIntent }, null, 2));
  return target;
}

async function authorProject(name: string, prompt: string, dir: string, confirmRisk: boolean, targetRuntime: RuntimeTarget) {
  const target = resolve(dir, name);
  const hostAuthoring = invokeHostAuthoring(targetRuntime, prompt);
  let project = applyHostAuthoring(generateHarnessProject(name, prompt, targetRuntime), hostAuthoring);
  if (project.authoring.confirmationRequests.length > 0 && !confirmRisk) throw new Error(requiresConfirmationMessage(project.authoring.confirmationRequests));
  if (confirmRisk) project = applyRiskConfirmations(project, true);
  await writeHarnessProject(target, project);
  console.log(JSON.stringify({ projectDir: target, summary: project.authoring.summary, confirmations: project.authoring.confirmationRequests, traceIntent: project.authoring.traceIntent, hostAuthoring: { runtime: hostAuthoring.runtime, command: hostAuthoring.command } }, null, 2));
  return target;
}

async function compileProject(projectDir: string, outDir?: string) {
  const project = await loadHarnessProject(resolve(projectDir));
  const unresolved = project.authoring.confirmationRequests.filter((request) => !request.confirmed);
  if (unresolved.length > 0) throw new Error(requiresConfirmationMessage(unresolved));
  const runtimeDescriptor = describeRuntimeTarget(project.manifest.targetRuntime);
  const resolvedOut = resolve(outDir ?? join(projectDir, 'compiler'));
  await mkdir(resolvedOut, { recursive: true });
  const result = await compileProjectForRuntime(project, resolvedOut);
  console.log(JSON.stringify({ ...result, runtimeDisplayName: runtimeDescriptor.displayName }, null, 2));
}

async function exportProject(projectDir: string, outDir?: string) {
  const project = await loadHarnessProject(resolve(projectDir));
  const runtimeDescriptor = describeRuntimeTarget(project.manifest.targetRuntime);
  const resolvedOut = resolve(outDir ?? join(projectDir, 'export', runtimeDescriptor.compileDirName));
  await mkdir(resolvedOut, { recursive: true });
  const result = await exportProjectBundle(resolve(projectDir), project, resolvedOut);
  console.log(JSON.stringify({ ...result, runtimeDisplayName: runtimeDescriptor.displayName }, null, 2));
}

async function sandboxProject(projectDir: string, outDir?: string, failHook?: string) {
  const result = await validateProject(resolve(projectDir), { ...(outDir ? { outDir: resolve(outDir) } : {}), ...(failHook ? { failHook } : {}) });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

async function catalog() {
  console.log(JSON.stringify({ blocks: BLOCK_REGISTRY, composites: COMPOSITE_PATTERNS }, null, 2));
}

async function serveProject(projectDir: string, portValue?: string, host?: string, tracePath?: string) {
  const port = portValue ? Number(portValue) : 0;
  if (portValue && !Number.isFinite(port)) throw new Error('--port must be a number');
  const handle = await startHarnessEditorServer({ projectDir: resolve(projectDir), port: port || 0, host, ...(tracePath ? { tracePath: resolve(tracePath) } : {}) });
  console.log(JSON.stringify({ url: handle.url, host: handle.host, port: handle.port, projectDir: resolve(projectDir) }, null, 2));
  const shutdown = async () => {
    try {
      await handle.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function chat(defaultName: string, defaultDir: string, defaultRuntime: RuntimeTarget) {
  if (!input.isTTY || !output.isTTY) {
    console.log(`${PRODUCT_NAME} compatibility generator is ready. Run \`${PRODUCT_NAME} chat\` in a TTY or use \`new --prompt ...\`.`);
    return;
  }

  const rl = createInterface({ input, output });
  try {
    console.log(`${PRODUCT_NAME} — project generation flow`);
    const name = (await rl.question(`Harness name (${defaultName}): `)).trim() || defaultName;
    const prompt = (await rl.question('Describe the harness you want to generate: ')).trim();
    const runtimeAnswer = (await rl.question(`Target runtime (${defaultRuntime}): `)).trim();
    const dir = (await rl.question(`Project directory (${defaultDir}): `)).trim() || defaultDir;
    if (!prompt) throw new Error('A harness intent prompt is required.');

    const targetRuntime = parseRuntimeTarget(runtimeAnswer || defaultRuntime, defaultRuntime);
    let project = generateHarnessProject(name, prompt, targetRuntime);
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
    console.log(`Next steps:\n  ${PRODUCT_NAME} compile --project ${target}\n  ${PRODUCT_NAME} sandbox --project ${target}`);
  } finally {
    rl.close();
  }
}

function selectedRuntimes(raw: string | undefined, fallback: SetupRuntime[]): SetupRuntime[] {
  return raw ? parseSetupRuntimes(raw) : fallback;
}

async function runSetup(selected: SetupRuntime[], approveWrites: boolean, dryRun: boolean, json: boolean) {
  const plan = buildSetupPlan(selected);
  const missingBinaries = missingRuntimeNames(plan);

  if (json && dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (missingBinaries.length > 0) {
    if (json) console.log(JSON.stringify({ ...plan, error: `Missing runtime prerequisite(s): ${missingBinaries.join(', ')}` }, null, 2));
    else {
      console.error(formatSetupPlan(plan));
      console.error(`\nMissing runtime prerequisite(s): ${missingBinaries.join(', ')}`);
    }
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    if (json) console.log(JSON.stringify(plan, null, 2));
    else console.log(formatSetupPlan(plan));
    return;
  }

  let approved = approveWrites;
  if (plan.approvalRequired && !approved) {
    approved = await requestSummaryApproval(plan);
    if (!approved) {
      if (json) console.log(JSON.stringify({ ...plan, error: 'Setup approval was not granted.' }, null, 2));
      else console.error(setupApprovalMessage(plan));
      process.exitCode = 1;
      return;
    }
  }

  const result = await applySetupPlan(plan, packageJson.version, approved);
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatSetupPlan(buildSetupPlan(selected)));
}

async function runDoctor(selected: SetupRuntime[], json: boolean) {
  const report = buildDoctorReport(selected);
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatDoctorReport(report));
}

async function launchDefaultMode() {
  if (!input.isTTY || !output.isTTY) {
    console.log(`${PRODUCT_NAME} setup is ready. Run \`${PRODUCT_NAME} setup --runtimes claude\` or use a TTY to start the wizard.`);
    return;
  }

  let selected: SetupRuntime[] = ['claude'];
  const rl = createInterface({ input, output });
  try {
    console.log(`${PRODUCT_NAME} Phase 1 setup wizard`);
    const answer = (await rl.question('Select runtimes (claude, opencode, codex) [claude]: ')).trim();
    selected = selectedRuntimes(answer || 'claude', ['claude']);
  } finally {
    rl.close();
  }
  await runSetup(selected, false, false, false);
}

async function demo(name: string, prompt: string, dir: string, targetRuntime: RuntimeTarget) {
  const projectDir = resolve(dir, name);
  await createProject(name, prompt, dir, true, targetRuntime);
  await compileProject(projectDir);
  await sandboxProject(projectDir);
}

const parsed = parseArgs(process.argv.slice(2));
const name = parsed.flags.get('name') ?? basename(process.cwd());
const prompt = parsed.flags.get('prompt') ?? 'Create a basic harness';
const dir = parsed.flags.get('dir') ?? '.oh-my-openharness';
const projectDir = parsed.flags.get('project');
const outDir = parsed.flags.get('out');
const confirmRisk = parsed.booleans.has('confirm-risk') || parsed.flags.get('confirm-risk') === 'true';
const failHook = parsed.flags.get('fail-hook');
const port = parsed.flags.get('port');
const host = parsed.flags.get('host');
const tracePath = parsed.flags.get('trace');
const runtimes = parsed.flags.get('runtimes');
const runtimeFlag = parsed.flags.get('runtime');
const runtime = parseRuntimeTarget(runtimeFlag);
const json = parsed.booleans.has('json');
const dryRun = parsed.booleans.has('dry-run');
const approveWrites = parsed.booleans.has('yes');
const importFrom = parsed.flags.get('from');

if (!parsed.command) {
  await launchDefaultMode();
} else {
  switch (parsed.command) {
    case 'setup':
      await runSetup(selectedRuntimes(runtimes, ['claude']), approveWrites, dryRun, json);
      break;
    case 'doctor':
      await runDoctor(selectedRuntimes(runtimes, ['claude', 'opencode', 'codex']), json);
      break;
    case 'chat':
      await chat(name, dir, runtime);
      break;
    case 'new':
      await createProject(name, prompt, dir, confirmRisk, runtime);
      break;
    case 'author':
      await authorProject(name, prompt, dir, confirmRisk, runtime);
      break;
    case 'import':
      if (!importFrom) throw new Error('--from is required');
      {
        const project = await importSeedProject({ sourceDir: importFrom, ...(runtimeFlag ? { runtime: runtimeFlag } : {}), name });
        const target = resolve(dir, name);
        await writeHarnessProject(target, project);
        console.log(JSON.stringify({ projectDir: target, importedFrom: resolve(importFrom), targetRuntime: project.manifest.targetRuntime, summary: project.authoring.summary }, null, 2));
      }
      break;
    case 'compile':
      if (!projectDir) throw new Error('--project is required');
      await compileProject(projectDir, outDir);
      break;
    case 'export':
      if (!projectDir) throw new Error('--project is required');
      await exportProject(projectDir, outDir);
      break;
    case 'sandbox':
      if (!projectDir) throw new Error('--project is required');
      await sandboxProject(projectDir, outDir, failHook);
      break;
    case 'catalog':
      await catalog();
      break;
    case 'serve':
      if (!projectDir) throw new Error('--project is required');
      await serveProject(projectDir, port, host, tracePath);
      break;
    case 'demo':
      await demo(name, prompt, dir, runtime);
      break;
    default:
      usage();
      process.exit(1);
  }
}
