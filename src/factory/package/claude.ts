import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const CLAUDE_HARNESS_MAKER_PACKAGE_NAME = 'harness-maker';
export const CLAUDE_HARNESS_MAKER_KIND = 'claude-native-harness-maker';
export const CLAUDE_FACTORY_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'] as const;
export const CLAUDE_HARNESS_MAKER_REQUIRED_SKILLS = [
  'harness-factory',
  'harness-interview',
  'harness-synthesize',
  'harness-build',
  'harness-preview',
  'harness-verify',
  'harness-reference-search'
] as const;

const COMPATIBILITY_SKILL_NAME = 'oh-my-openharness';
const DEFAULT_PRODUCT_NAME = 'oh-my-openharness';

type ClaudeFactoryHookEvent = typeof CLAUDE_FACTORY_HOOK_EVENTS[number];
type ClaudeHarnessMakerSkillName = typeof CLAUDE_HARNESS_MAKER_REQUIRED_SKILLS[number] | typeof COMPATIBILITY_SKILL_NAME;

export interface ClaudeHarnessMakerPackageOptions {
  packageRoot: string;
  version: string;
  productName?: string;
  runtimeCommand?: string;
  runtimeArgs?: string[];
  configRoot?: string;
  installRoot?: string;
  selectedRuntimes?: string[];
  installedAt?: string;
}

export interface ClaudeHarnessMakerPackageResult {
  packageRoot: string;
  pluginJsonPath: string;
  hooksConfigPath: string;
  stateContractPath: string;
  setupMetadataPath: string;
  generatedFiles: string[];
  manifestPaths: string[];
  skillPaths: Record<string, string>;
  hookScriptPaths: Record<string, string>;
}

function defaultRuntimeArgs(): string[] {
  return ['run', resolve('src', 'factory', 'hooks', 'cli.ts')];
}

function scriptNameForHook(hook: ClaudeFactoryHookEvent): string {
  return `${hook.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}.mjs`;
}

function hookScript(hook: ClaudeFactoryHookEvent, runtimeCommand: string, runtimeArgs: string[]): string {
  return `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const hookEventName = ${JSON.stringify(hook)};
const fallbackCommand = ${JSON.stringify(runtimeCommand)};
const fallbackArgs = ${JSON.stringify(runtimeArgs)};

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function runtimeArgsFromEnv() {
  const raw = process.env.HARNESS_FACTORY_CLI_ARGS;
  if (!raw) return fallbackArgs;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error('HARNESS_FACTORY_CLI_ARGS must be a JSON string array.');
  return parsed;
}

const stdin = await readStdin();
const command = process.env.HARNESS_FACTORY_CLI_COMMAND || fallbackCommand;
const args = runtimeArgsFromEnv();
const result = spawnSync(command, args, {
  input: stdin,
  encoding: 'utf8',
  cwd: process.env.HARNESS_FACTORY_CWD || process.cwd(),
  env: { ...process.env, HARNESS_FACTORY_HOOK_EVENT: hookEventName }
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: result.error.message, harnessFactory: { ok: false, hook: hookEventName, error: result.error.message } }, null, 2) + '\\n');
}
process.exit(result.status ?? (result.error ? 1 : 0));
`;
}

function skillDescription(skill: ClaudeHarnessMakerSkillName): string {
  const descriptions: Record<ClaudeHarnessMakerSkillName, string> = {
    'harness-factory': 'Coordinate the Claude-native Harness Factory from intake through verified package export.',
    'harness-interview': 'Run the Harness Factory interview to capture runtime, capability, safety, and workflow decisions.',
    'harness-synthesize': 'Turn confirmed interview decisions into a canonical harness graph and skill/hook specification.',
    'harness-build': 'Materialize a canonical oh-my-openharness project from the synthesized Factory specification.',
    'harness-preview': 'Preview generated harness graph, catalog, skills, and runtime surfaces before export.',
    'harness-verify': 'Run sandbox and runtime-shape verification for generated harnesses before handoff.',
    'harness-reference-search': 'Search local Harness Factory reference patterns and catalog entries during authoring.',
    'oh-my-openharness': 'Compatibility bridge for existing oh-my-openharness Claude setup workflows.'
  };
  return descriptions[skill];
}

function skillTitle(skill: ClaudeHarnessMakerSkillName): string {
  return skill
    .split('-')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
}

function skillContent(skill: ClaudeHarnessMakerSkillName): string {
  const title = skillTitle(skill);
  const description = skillDescription(skill);
  const compatibilityNote = skill === COMPATIBILITY_SKILL_NAME
    ? '\n## Compatibility\n\nThis skill preserves the historical `oh-my-openharness` Claude bridge while the harness-maker package exposes finer-grained Factory skills. Prefer `harness-factory` for new authoring flows.\n'
    : '';

  return `---
name: ${skill}
description: ${description}
---

# ${title}

${description}

## Orchestration instructions

- Keep the canonical harness project on disk as the source of truth.
- Route intake through the Harness Factory interview before build/export actions.
- Use the installed Factory hooks to preserve state, block unsafe out-of-order writes, and surface project materialization updates.
- Prefer preview and verification before exporting a generated harness to a host runtime.
- Do not bypass safety confirmations for risk-bearing permissions, destructive runtime changes, or policy changes.
${compatibilityNote}`;
}

function hooksConfig() {
  const hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string; timeout: number }> }>> = {};
  for (const hook of CLAUDE_FACTORY_HOOK_EVENTS) {
    hooks[hook] = [
      {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: `node "$CLAUDE_PLUGIN_ROOT"/scripts/${scriptNameForHook(hook)}`,
            timeout: 10
          }
        ]
      }
    ];
  }
  return { description: 'Claude-native Harness Factory hooks', hooks };
}

function stateContract(productName: string) {
  return {
    schemaVersion: 1,
    product: productName,
    packageName: CLAUDE_HARNESS_MAKER_PACKAGE_NAME,
    packageKind: CLAUDE_HARNESS_MAKER_KIND,
    stateRootEnv: 'HARNESS_FACTORY_STATE_DIR',
    defaultStateRoot: '.omx/factory-state',
    sessionIdFields: ['factory.sessionId', 'session_id', 'sessionId'],
    factoryInputField: 'factory',
    stages: ['intake', 'interview', 'drafting', 'built', 'verified', 'exported'],
    files: {
      sessionState: '<stateRoot>/<sessionId>.json'
    },
    hooks: [...CLAUDE_FACTORY_HOOK_EVENTS]
  };
}

function setupMetadata(options: Required<Pick<ClaudeHarnessMakerPackageOptions, 'packageRoot' | 'version'>> & Omit<ClaudeHarnessMakerPackageOptions, 'packageRoot' | 'version'>) {
  const productName = options.productName ?? DEFAULT_PRODUCT_NAME;
  return {
    product: productName,
    packageName: CLAUDE_HARNESS_MAKER_PACKAGE_NAME,
    packageKind: CLAUDE_HARNESS_MAKER_KIND,
    runtime: 'claude',
    version: options.version,
    selectedRuntimes: options.selectedRuntimes ?? ['claude'],
    installedAt: options.installedAt ?? new Date().toISOString(),
    ...(options.configRoot ? { configRoot: options.configRoot } : {}),
    installRoot: options.installRoot ?? options.packageRoot,
    skills: [...CLAUDE_HARNESS_MAKER_REQUIRED_SKILLS],
    compatibilitySkills: [COMPATIBILITY_SKILL_NAME],
    hooks: [...CLAUDE_FACTORY_HOOK_EVENTS],
    stateContract: 'state-contract.json',
    hooksConfig: 'hooks/hooks.json',
    contract: 'claude-native-harness-maker'
  };
}

export function claudeHarnessMakerInstallSurface(installRoot: string): string[] {
  return [
    join(installRoot, 'plugin.json'),
    join(installRoot, 'hooks', 'hooks.json'),
    join(installRoot, 'state-contract.json'),
    join(installRoot, 'install.json'),
    ...CLAUDE_FACTORY_HOOK_EVENTS.map((hook) => join(installRoot, 'scripts', scriptNameForHook(hook))),
    ...CLAUDE_HARNESS_MAKER_REQUIRED_SKILLS.map((skill) => join(installRoot, 'skills', skill, 'SKILL.md')),
    join(installRoot, 'skills', COMPATIBILITY_SKILL_NAME, 'SKILL.md')
  ];
}

export async function writeClaudeHarnessMakerPackage(options: ClaudeHarnessMakerPackageOptions): Promise<ClaudeHarnessMakerPackageResult> {
  const productName = options.productName ?? DEFAULT_PRODUCT_NAME;
  const packageRoot = options.packageRoot;
  const runtimeCommand = options.runtimeCommand ?? 'bun';
  const runtimeArgs = options.runtimeArgs ?? defaultRuntimeArgs();
  const skillsDir = join(packageRoot, 'skills');
  const hooksDir = join(packageRoot, 'hooks');
  const scriptsDir = join(packageRoot, 'scripts');
  const pluginJsonPath = join(packageRoot, 'plugin.json');
  const hooksConfigPath = join(hooksDir, 'hooks.json');
  const stateContractPath = join(packageRoot, 'state-contract.json');
  const setupMetadataPath = join(packageRoot, 'install.json');
  const generatedFiles = [pluginJsonPath, hooksConfigPath, stateContractPath, setupMetadataPath];
  const skillPaths: Record<string, string> = {};
  const hookScriptPaths: Record<string, string> = {};

  await mkdir(skillsDir, { recursive: true });
  await mkdir(hooksDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });

  const allSkills: ClaudeHarnessMakerSkillName[] = [...CLAUDE_HARNESS_MAKER_REQUIRED_SKILLS, COMPATIBILITY_SKILL_NAME];
  for (const skill of allSkills) {
    const skillDir = join(skillsDir, skill);
    await mkdir(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    await writeFile(skillPath, skillContent(skill));
    skillPaths[skill] = skillPath;
    generatedFiles.push(skillPath);
  }

  for (const hook of CLAUDE_FACTORY_HOOK_EVENTS) {
    const scriptPath = join(scriptsDir, scriptNameForHook(hook));
    await writeFile(scriptPath, hookScript(hook, runtimeCommand, runtimeArgs));
    await chmod(scriptPath, 0o755);
    hookScriptPaths[hook] = scriptPath;
    generatedFiles.push(scriptPath);
  }

  await writeFile(
    pluginJsonPath,
    JSON.stringify(
      {
        name: productName,
        packageName: CLAUDE_HARNESS_MAKER_PACKAGE_NAME,
        packageKind: CLAUDE_HARNESS_MAKER_KIND,
        version: options.version,
        description: 'Claude-native Harness Maker package for Factory-driven harness authoring',
        license: 'MIT',
        skills: './skills',
        hooks: './hooks/hooks.json',
        stateContract: './state-contract.json',
        setupMetadata: './install.json',
        scripts: Object.fromEntries(CLAUDE_FACTORY_HOOK_EVENTS.map((hook) => [hook, `./scripts/${scriptNameForHook(hook)}`])),
        requiredSkills: [...CLAUDE_HARNESS_MAKER_REQUIRED_SKILLS]
      },
      null,
      2
    )
  );
  await writeFile(hooksConfigPath, JSON.stringify(hooksConfig(), null, 2));
  await writeFile(stateContractPath, JSON.stringify(stateContract(productName), null, 2));
  await writeFile(setupMetadataPath, JSON.stringify(setupMetadata({ ...options, packageRoot, version: options.version, productName }), null, 2));

  return {
    packageRoot,
    pluginJsonPath,
    hooksConfigPath,
    stateContractPath,
    setupMetadataPath,
    generatedFiles,
    manifestPaths: claudeHarnessMakerInstallSurface(packageRoot),
    skillPaths,
    hookScriptPaths
  };
}
