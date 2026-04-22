import type { RuntimeTarget, SetupRuntime } from './types';

export interface RuntimeTargetDescriptor {
  target: RuntimeTarget;
  setupRuntime: SetupRuntime;
  displayName: string;
  authoringNoun: string;
  compileDirName: string;
  hostCommand: string;
}

export const RUNTIME_TARGETS: Record<RuntimeTarget, RuntimeTargetDescriptor> = {
  'claude-code': {
    target: 'claude-code',
    setupRuntime: 'claude',
    displayName: 'Claude',
    authoringNoun: 'Claude Code',
    compileDirName: 'claude-code',
    hostCommand: 'claude'
  },
  opencode: {
    target: 'opencode',
    setupRuntime: 'opencode',
    displayName: 'OpenCode',
    authoringNoun: 'OpenCode',
    compileDirName: 'opencode',
    hostCommand: 'opencode'
  },
  codex: {
    target: 'codex',
    setupRuntime: 'codex',
    displayName: 'Codex',
    authoringNoun: 'Codex',
    compileDirName: 'codex',
    hostCommand: 'codex'
  }
};

const RUNTIME_TARGET_ALIAS: Record<string, RuntimeTarget> = {
  claude: 'claude-code',
  'claude-code': 'claude-code',
  opencode: 'opencode',
  codex: 'codex'
};

export function parseRuntimeTarget(value: string | undefined, fallback: RuntimeTarget = 'claude-code'): RuntimeTarget {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  const resolved = RUNTIME_TARGET_ALIAS[normalized];
  if (!resolved) throw new Error(`Unsupported runtime target: ${value}`);
  return resolved;
}

export function runtimeTargetFromSetupRuntime(runtime: SetupRuntime): RuntimeTarget {
  return runtime === 'claude' ? 'claude-code' : runtime;
}

export function setupRuntimeFromTarget(target: RuntimeTarget): SetupRuntime {
  return RUNTIME_TARGETS[target].setupRuntime;
}

export function describeRuntimeTarget(target: RuntimeTarget): RuntimeTargetDescriptor {
  return RUNTIME_TARGETS[target];
}
