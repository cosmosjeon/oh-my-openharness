import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  RuntimeCapabilityMatrixEntry,
  RuntimeDoctorEntry,
  RuntimeDoctorReport,
  RuntimeSetupPlan,
  SetupApplyResult,
  SetupChange,
  SetupRuntime,
  SetupSupportLevel
} from './types';

const PRODUCT_NAME = 'oh-my-openharness';
const CLAUDE_SKILL_DIR = join('skills', 'oh-my-openharness');
const RUNTIME_SKILL_NAME = 'oh-my-openharness';
const RUNTIME_ORDER: SetupRuntime[] = ['claude', 'opencode', 'codex'];

interface RuntimeDescriptor {
  runtime: SetupRuntime;
  displayName: string;
  supportLevel: SetupSupportLevel;
  binaryCandidates: string[];
  configEnvVar: string;
  configRoot: string;
  installRoot: string;
  installSurface: string[];
  mutationSurface: string[];
  approvalSemantics: string;
  rollbackBehavior: string[];
  proofMethod: string;
  provenanceType: RuntimeCapabilityMatrixEntry['provenanceType'];
  evidenceFiles: string[];
  suggestedNextCommand: string;
}

function defaultConfigRoot(runtime: SetupRuntime): string {
  switch (runtime) {
    case 'claude':
      return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
    case 'opencode':
      return process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), '.config', 'opencode');
    case 'codex':
      return process.env.CODEX_HOME ?? join(homedir(), '.codex');
  }
}

function runtimeDescriptor(runtime: SetupRuntime): RuntimeDescriptor {
  const configRoot = defaultConfigRoot(runtime);
  if (runtime === 'claude') {
    const installRoot = join(configRoot, 'plugins', PRODUCT_NAME);
    return {
      runtime,
      displayName: 'Claude',
      supportLevel: 'supported',
      binaryCandidates: ['claude'],
      configEnvVar: 'CLAUDE_CONFIG_DIR',
      configRoot,
      installRoot,
      installSurface: [
        join(installRoot, 'plugin.json'),
        join(installRoot, 'hooks', 'hooks.json'),
        join(installRoot, CLAUDE_SKILL_DIR, 'SKILL.md'),
        join(installRoot, 'install.json')
      ],
      mutationSurface: [
        `${configRoot}/plugins/${PRODUCT_NAME}`,
        `${configRoot}/plugins/${PRODUCT_NAME}/hooks/hooks.json`,
        `${configRoot}/plugins/${PRODUCT_NAME}/${CLAUDE_SKILL_DIR}/SKILL.md`
      ],
      approvalSemantics: 'One summary approval gate covers Claude plugin bundle writes.',
      rollbackBehavior: [`Remove ${installRoot} to roll back the Claude setup surface.`],
      proofMethod: 'Confirm the Claude plugin bundle exists, then run doctor to separate install shape from host readiness.',
      provenanceType: 'extracted',
      evidenceFiles: [
        '.omx/plans/oh-my-openharness/REFERENCE/claude-runtime-baseline.md',
        'oh-my-claudecode/src/installer/index.ts',
        'oh-my-claudecode/src/installer/hooks.ts'
      ],
      suggestedNextCommand: 'claude'
    };
  }

  if (runtime === 'opencode') {
    const installRoot = join(configRoot, 'skills', RUNTIME_SKILL_NAME);
    return {
      runtime,
      displayName: 'OpenCode',
      supportLevel: 'supported',
      binaryCandidates: ['opencode', 'oh-my-opencode'],
      configEnvVar: 'OPENCODE_CONFIG_DIR',
      configRoot,
      installRoot,
      installSurface: [join(installRoot, 'SKILL.md'), join(configRoot, `${PRODUCT_NAME}.jsonc`)],
      mutationSurface: [installRoot, join(configRoot, `${PRODUCT_NAME}.jsonc`)],
      approvalSemantics: 'One summary approval gate covers the OpenCode skill bundle and runtime bridge config.',
      rollbackBehavior: [`Delete ${installRoot} and ${join(configRoot, `${PRODUCT_NAME}.jsonc`)} to remove the OpenCode authoring bridge.`],
      proofMethod: 'Confirm the OMOH OpenCode skill bundle exists, then verify host readiness separately by launching OpenCode with the installed skill.',
      provenanceType: 'extracted',
      evidenceFiles: [
        '.omx/plans/oh-my-openharness/REFERENCE/opencode-runtime-baseline.md',
        'oh-my-openagent/README.md',
        'oh-my-openagent/docs/reference/features.md',
        'oh-my-openagent/src/plugin-interface.ts'
      ],
      suggestedNextCommand: 'opencode'
    };
  }

  const installRoot = join(configRoot, 'skills', RUNTIME_SKILL_NAME);
  return {
    runtime,
    displayName: 'Codex',
    supportLevel: 'supported',
    binaryCandidates: ['codex'],
    configEnvVar: 'CODEX_HOME',
    configRoot,
    installRoot,
    installSurface: [join(installRoot, 'SKILL.md'), join(configRoot, 'prompts', `${PRODUCT_NAME}.md`), join(configRoot, `${PRODUCT_NAME}.json`)],
    mutationSurface: [installRoot, join(configRoot, 'prompts', `${PRODUCT_NAME}.md`), join(configRoot, `${PRODUCT_NAME}.json`)],
    approvalSemantics: 'One summary approval gate covers the Codex skill bundle, prompt bridge, and runtime config.',
    rollbackBehavior: [`Delete ${installRoot}, ${join(configRoot, 'prompts', `${PRODUCT_NAME}.md`)}, and ${join(configRoot, `${PRODUCT_NAME}.json`)} to remove the Codex authoring bridge.`],
    proofMethod: 'Confirm the OMOH Codex skill bundle and prompt bridge exist, then verify host readiness separately with `codex`.',
    provenanceType: 'extracted',
    evidenceFiles: [
      '.omx/plans/oh-my-openharness/REFERENCE/codex-runtime-baseline.md',
      'oh-my-codex/templates/catalog-manifest.json',
      'oh-my-codex/src/config/mcp-registry.ts',
      'oh-my-codex/src/scripts/codex-native-hook.ts'
    ],
    suggestedNextCommand: 'codex'
  };
}

function detectBinaryPath(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const detected = Bun.which(candidate);
    if (detected) return detected;
  }
  return undefined;
}

function installShapeExists(descriptor: RuntimeDescriptor): boolean {
  return descriptor.installSurface.every((path) => existsSync(path));
}

function toCapabilityEntry(descriptor: RuntimeDescriptor): RuntimeCapabilityMatrixEntry {
  const binaryPath = detectBinaryPath(descriptor.binaryCandidates);
  const installSurfacePresent = installShapeExists(descriptor);
  const installStatus = installSurfacePresent
    ? descriptor.supportLevel === 'supported'
      ? 'configured'
      : 'scaffolded'
    : binaryPath
      ? 'ready-to-apply'
      : 'missing-binary';
  return {
    runtime: descriptor.runtime,
    displayName: descriptor.displayName,
    supportLevel: descriptor.supportLevel,
    binaryCandidates: [...descriptor.binaryCandidates],
    binaryDetected: Boolean(binaryPath),
    ...(binaryPath ? { binaryPath } : {}),
    configEnvVar: descriptor.configEnvVar,
    configRoot: descriptor.configRoot,
    installRoot: descriptor.installRoot,
    installSurface: [...descriptor.installSurface],
    mutationSurface: [...descriptor.mutationSurface],
    approvalSemantics: descriptor.approvalSemantics,
    rollbackBehavior: [...descriptor.rollbackBehavior],
    proofMethod: descriptor.proofMethod,
    provenanceType: descriptor.provenanceType,
    evidenceFiles: [...descriptor.evidenceFiles],
    installStatus
  };
}

function plannedWrites(entry: RuntimeCapabilityMatrixEntry): SetupChange[] {
  if (entry.installStatus === 'configured' || entry.installStatus === 'scaffolded' || entry.installStatus === 'missing-binary') return [];
  if (entry.runtime === 'claude') {
    return [
      { runtime: entry.runtime, path: entry.installRoot, kind: 'mkdir', risk: 'risky', reason: 'Create the Claude plugin root for OMOH.' },
      { runtime: entry.runtime, path: join(entry.installRoot, 'hooks', 'hooks.json'), kind: 'write', risk: 'risky', reason: 'Write the OMOH Claude hook manifest.' },
      { runtime: entry.runtime, path: join(entry.installRoot, 'plugin.json'), kind: 'write', risk: 'risky', reason: 'Write the OMOH Claude plugin manifest.' },
      { runtime: entry.runtime, path: join(entry.installRoot, CLAUDE_SKILL_DIR, 'SKILL.md'), kind: 'write', risk: 'risky', reason: 'Install the OMOH Claude setup skill.' },
      { runtime: entry.runtime, path: join(entry.installRoot, 'install.json'), kind: 'write', risk: 'risky', reason: 'Persist the OMOH Claude install snapshot.' }
    ];
  }
  if (entry.runtime === 'opencode') {
    return [
      { runtime: entry.runtime, path: entry.installRoot, kind: 'mkdir', risk: 'risky', reason: 'Create the OpenCode skill root for OMOH.' },
      { runtime: entry.runtime, path: join(entry.installRoot, 'SKILL.md'), kind: 'write', risk: 'risky', reason: 'Install the OMOH OpenCode skill bridge.' },
      { runtime: entry.runtime, path: join(entry.configRoot, `${PRODUCT_NAME}.jsonc`), kind: 'write', risk: 'risky', reason: 'Write the OMOH OpenCode runtime bridge config.' }
    ];
  }
  return [
    { runtime: entry.runtime, path: entry.installRoot, kind: 'mkdir', risk: 'risky', reason: 'Create the Codex skill root for OMOH.' },
    { runtime: entry.runtime, path: join(entry.installRoot, 'SKILL.md'), kind: 'write', risk: 'risky', reason: 'Install the OMOH Codex skill bridge.' },
    { runtime: entry.runtime, path: join(entry.configRoot, 'prompts', `${PRODUCT_NAME}.md`), kind: 'write', risk: 'risky', reason: 'Write the OMOH Codex prompt bridge.' },
    { runtime: entry.runtime, path: join(entry.configRoot, `${PRODUCT_NAME}.json`), kind: 'write', risk: 'risky', reason: 'Persist the OMOH Codex runtime bridge config.' }
  ];
}

function buildSummary(selectedRuntimes: SetupRuntime[], riskyWrites: SetupChange[], capabilityMatrix?: RuntimeCapabilityMatrixEntry[]): string {
  const runtimeList = selectedRuntimes.join(', ');
  const scaffolded = (capabilityMatrix ?? []).filter((entry) => entry.supportLevel === 'scaffold').map((entry) => entry.displayName);
  const scaffoldNote = scaffolded.length > 0 ? ` Scaffold-only runtimes: ${scaffolded.join(', ')}.` : '';
  return riskyWrites.length === 0
    ? `Selected runtimes: ${runtimeList}. No pending setup writes.${scaffoldNote}`
    : `Selected runtimes: ${runtimeList}. ${riskyWrites.length} risky write(s) are grouped behind one summary approval gate.${scaffoldNote}`;
}

export function parseSetupRuntimes(value: string): SetupRuntime[] {
  const requested = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length === 0) throw new Error('At least one runtime must be selected.');

  const unique = [...new Set(requested)];
  const invalid = unique.filter((item): item is string => !RUNTIME_ORDER.includes(item as SetupRuntime));
  if (invalid.length > 0) throw new Error(`Unsupported runtime selection: ${invalid.join(', ')}`);
  return unique as SetupRuntime[];
}

export function buildSetupPlan(selectedRuntimes: SetupRuntime[]): RuntimeSetupPlan {
  const capabilityMatrix = selectedRuntimes.map((runtime) => toCapabilityEntry(runtimeDescriptor(runtime)));
  const riskyWrites = capabilityMatrix.flatMap((entry) => plannedWrites(entry));
  return {
    productName: PRODUCT_NAME,
    selectedRuntimes: [...selectedRuntimes],
    capabilityMatrix,
    safeReads: [
      'Detect the active Bun runtime',
      'Resolve runtime config roots from environment/defaults',
      'Detect runtime binaries on PATH',
      'Inspect existing OMOH install surfaces'
    ],
    riskyWrites,
    approvalRequired: riskyWrites.length > 0,
    approvalMode: riskyWrites.length > 0 ? 'summary' : 'none',
    summary: buildSummary(selectedRuntimes, riskyWrites, capabilityMatrix)
  };
}

function ensureSupportedForApply(plan: RuntimeSetupPlan) {
  const missing = plan.capabilityMatrix.filter((entry) => !entry.binaryDetected).map((entry) => entry.displayName);
  if (missing.length > 0) throw new Error(`Missing runtime prerequisite(s): ${missing.join(', ')}`);
}

function claudeSkillContent(selectedRuntimes: SetupRuntime[], configRoot: string): string {
  return `---\nname: oh-my-openharness\ndescription: OMOH Claude setup bridge\n---\n\n# oh-my-openharness\n\nThis Claude runtime was configured by OMOH Phase 1 setup.\n\n## Selected runtimes\n- ${selectedRuntimes.join(', ')}\n\n## Config root\n- ${configRoot}\n\n## Contract\n- Real authoring remains inside Claude Code.\n- OMOH owns setup, orchestration, browser editing, and export.\n- This Phase 1 bridge proves the Claude install surface and will be widened in later phases.\n`;
}

function opencodeSkillContent(selectedRuntimes: SetupRuntime[], configRoot: string): string {
  return `---\nname: ${PRODUCT_NAME}\ndescription: OMOH OpenCode authoring bridge\n---\n\n# ${PRODUCT_NAME}\n\nThis OpenCode runtime was configured by OMOH for host-native authoring.\n\n## Selected runtimes\n- ${selectedRuntimes.join(', ')}\n\n## Config root\n- ${configRoot}\n\n## Contract\n- Real authoring happens inside OpenCode.\n- Choose the runtime target before writing runtime-specific artifacts.\n- Export and validation stay anchored to the canonical OMOH project on disk.\n`;
}

function codexSkillContent(selectedRuntimes: SetupRuntime[], configRoot: string): string {
  return `---\nname: ${PRODUCT_NAME}\ndescription: OMOH Codex authoring bridge\n---\n\n# ${PRODUCT_NAME}\n\nThis Codex runtime was configured by OMOH for host-native authoring.\n\n## Selected runtimes\n- ${selectedRuntimes.join(', ')}\n\n## Config root\n- ${configRoot}\n\n## Contract\n- Real authoring happens inside Codex.\n- Choose the runtime target before writing runtime-specific artifacts.\n- Export and validation stay anchored to the canonical OMOH project on disk.\n`;
}

async function writeClaudeBundle(entry: RuntimeCapabilityMatrixEntry, selectedRuntimes: SetupRuntime[], version: string) {
  await mkdir(join(entry.installRoot, 'hooks'), { recursive: true });
  await mkdir(join(entry.installRoot, CLAUDE_SKILL_DIR), { recursive: true });
  await writeFile(
    join(entry.installRoot, 'plugin.json'),
    JSON.stringify(
      {
        name: PRODUCT_NAME,
        version,
        description: 'OMOH Claude setup bridge',
        hooks: './hooks/hooks.json',
        skills: './skills'
      },
      null,
      2
    )
  );
  await writeFile(
    join(entry.installRoot, 'hooks', 'hooks.json'),
    JSON.stringify(
      {
        description: 'OMOH Phase 1 Claude setup bridge',
        hooks: {}
      },
      null,
      2
    )
  );
  await writeFile(join(entry.installRoot, CLAUDE_SKILL_DIR, 'SKILL.md'), claudeSkillContent(selectedRuntimes, entry.configRoot));
  await writeFile(
    join(entry.installRoot, 'install.json'),
    JSON.stringify(
      {
        product: PRODUCT_NAME,
        runtime: entry.runtime,
        supportLevel: entry.supportLevel,
        selectedRuntimes,
        installedAt: new Date().toISOString(),
        configRoot: entry.configRoot,
        installRoot: entry.installRoot,
        provenanceType: entry.provenanceType,
        evidenceFiles: entry.evidenceFiles
      },
      null,
      2
    )
  );
}

async function writeSetupSnapshot(entry: RuntimeCapabilityMatrixEntry, selectedRuntimes: SetupRuntime[], version: string) {
  await mkdir(entry.configRoot, { recursive: true });
  await writeFile(
    entry.installRoot,
    JSON.stringify(
      {
        product: PRODUCT_NAME,
        runtime: entry.runtime,
        version,
        supportLevel: entry.supportLevel,
        selectedRuntimes,
        installedAt: new Date().toISOString(),
        configRoot: entry.configRoot,
        installRoot: entry.installRoot,
        proofMethod: entry.proofMethod,
        rollbackBehavior: entry.rollbackBehavior,
        provenanceType: entry.provenanceType,
        evidenceFiles: entry.evidenceFiles
      },
      null,
      2
    )
  );
}

async function writeOpenCodeBundle(entry: RuntimeCapabilityMatrixEntry, selectedRuntimes: SetupRuntime[], version: string) {
  await mkdir(entry.installRoot, { recursive: true });
  await writeFile(join(entry.installRoot, 'SKILL.md'), opencodeSkillContent(selectedRuntimes, entry.configRoot));
  await writeFile(
    join(entry.configRoot, `${PRODUCT_NAME}.jsonc`),
    JSON.stringify(
      {
        product: PRODUCT_NAME,
        runtime: entry.runtime,
        version,
        supportLevel: entry.supportLevel,
        selectedRuntimes,
        installedAt: new Date().toISOString(),
        skills: [`skills/${RUNTIME_SKILL_NAME}/SKILL.md`],
        hostCommand: 'opencode',
        contract: 'host-native-authoring'
      },
      null,
      2
    )
  );
}

async function writeCodexBundle(entry: RuntimeCapabilityMatrixEntry, selectedRuntimes: SetupRuntime[], version: string) {
  await mkdir(entry.installRoot, { recursive: true });
  await mkdir(join(entry.configRoot, 'prompts'), { recursive: true });
  await writeFile(join(entry.installRoot, 'SKILL.md'), codexSkillContent(selectedRuntimes, entry.configRoot));
  await writeFile(
    join(entry.configRoot, 'prompts', `${PRODUCT_NAME}.md`),
    `# ${PRODUCT_NAME}\n\nCodex prompt bridge for OMOH host-native authoring.\n\nSelected runtimes: ${selectedRuntimes.join(', ')}\n`
  );
  await writeFile(
    join(entry.configRoot, `${PRODUCT_NAME}.json`),
    JSON.stringify(
      {
        product: PRODUCT_NAME,
        runtime: entry.runtime,
        version,
        supportLevel: entry.supportLevel,
        selectedRuntimes,
        installedAt: new Date().toISOString(),
        skills: [`skills/${RUNTIME_SKILL_NAME}/SKILL.md`],
        prompt: `prompts/${PRODUCT_NAME}.md`,
        hostCommand: 'codex',
        contract: 'host-native-authoring'
      },
      null,
      2
    )
  );
}

export async function applySetupPlan(plan: RuntimeSetupPlan, version: string, approvedBySummaryGate = false): Promise<SetupApplyResult> {
  ensureSupportedForApply(plan);
  if (plan.approvalRequired && !approvedBySummaryGate) throw new Error('Summary approval is required before applying OMOH setup writes.');
  const appliedWrites: SetupChange[] = [...plan.riskyWrites];

  for (const entry of plan.capabilityMatrix) {
    if (entry.installStatus === 'configured' || entry.installStatus === 'scaffolded') continue;
    if (entry.runtime === 'claude') {
      await writeClaudeBundle(entry, plan.selectedRuntimes, version);
    } else if (entry.runtime === 'opencode') {
      await writeOpenCodeBundle(entry, plan.selectedRuntimes, version);
    } else if (entry.runtime === 'codex') {
      await writeCodexBundle(entry, plan.selectedRuntimes, version);
    } else {
      await writeSetupSnapshot(entry, plan.selectedRuntimes, version);
    }
  }

  const refreshed = buildSetupPlan(plan.selectedRuntimes);
  return {
    productName: PRODUCT_NAME,
    selectedRuntimes: [...plan.selectedRuntimes],
    capabilityMatrix: refreshed.capabilityMatrix,
    appliedWrites,
    approvalRequired: plan.approvalRequired,
    approvalMode: plan.approvalMode,
    summary: buildSummary(plan.selectedRuntimes, [], refreshed.capabilityMatrix)
  };
}

function installShapeCheck(entry: RuntimeCapabilityMatrixEntry): RuntimeDoctorEntry['installShape'] {
  if (entry.installStatus === 'configured') {
    return {
      status: 'ok',
      details: [`Install shape is present at ${entry.installRoot}.`]
    };
  }
  if (entry.installStatus === 'scaffolded') {
    return {
      status: 'warning',
      details: [`Scaffold snapshot is present at ${entry.installRoot}, but ${entry.displayName} integration remains scaffold-only in Phase 1.`]
    };
  }
  if (entry.installStatus === 'missing-binary') {
    return {
      status: 'warning',
      details: [`Install shape is not present at ${entry.installRoot}.`]
    };
  }
  return {
    status: 'warning',
    details: [`Install shape has not been applied yet for ${entry.displayName}.`]
  };
}

function hostReadinessCheck(entry: RuntimeCapabilityMatrixEntry, descriptor: RuntimeDescriptor): RuntimeDoctorEntry['hostReadiness'] {
  if (!entry.binaryDetected) {
    return {
      status: 'error',
      details: [`Runtime binary not found on PATH. Expected one of: ${descriptor.binaryCandidates.join(', ')}.`]
    };
  }

  if (entry.installStatus === 'scaffolded') {
    return {
      status: 'warning',
      details: [`OMOH recorded a scaffold snapshot only. Verify real ${descriptor.displayName} integration in a later phase with \`${descriptor.suggestedNextCommand}\`.`]
    };
  }

  if (entry.installStatus !== 'configured') {
    return {
      status: 'warning',
      details: ['Runtime binary is available, but the OMOH install surface is not configured yet.']
    };
  }

  return {
    status: 'warning',
    details: [`Install shape looks healthy. Verify host readiness separately with \`${descriptor.suggestedNextCommand}\`.`]
  };
}

export function buildDoctorReport(selectedRuntimes: SetupRuntime[]): RuntimeDoctorReport {
  const entries = selectedRuntimes.map((runtime) => {
    const descriptor = runtimeDescriptor(runtime);
    const capability = toCapabilityEntry(descriptor);
    return {
      runtime,
      displayName: descriptor.displayName,
      supportLevel: descriptor.supportLevel,
      binaryDetected: capability.binaryDetected,
      ...(capability.binaryPath ? { binaryPath: capability.binaryPath } : {}),
      configRoot: descriptor.configRoot,
      installRoot: descriptor.installRoot,
      installShape: installShapeCheck(capability),
      hostReadiness: hostReadinessCheck(capability, descriptor),
      suggestedNextCommand: descriptor.suggestedNextCommand
    } satisfies RuntimeDoctorEntry;
  });

  return {
    productName: PRODUCT_NAME,
    bun: {
      available: Boolean(Bun.version),
      version: Bun.version
    },
    selectedRuntimes: [...selectedRuntimes],
    runtimes: entries
  };
}
