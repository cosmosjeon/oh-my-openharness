import { join, resolve } from 'node:path';
import { createHarnessFactoryStore, type HarnessFactoryState, type HarnessFactoryStore } from '../state';
import type { RuntimeTarget } from '../../core/types';
import { parseHookStdin, stringifyHookOutput, type HookPayload } from './io';
import { handlePostToolUseHook } from './post-tool-use';
import { handlePreToolUseHook } from './pre-tool-use';
import { handleSessionStartHook } from './session-start';
import { handleUserPromptSubmitHook } from './user-prompt-submit';

export type FactoryHookEventName = 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse';

export interface FactoryHookFactoryInput {
  stateRoot?: string;
  sessionId?: string;
  userIntent?: string;
  targetRuntime?: RuntimeTarget;
  requestedCapabilities?: string[];
}

export interface FactoryHookRuntimePayload extends HookPayload {
  hook_event_name?: FactoryHookEventName | string;
  session_id?: string;
  sessionId?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  factory?: FactoryHookFactoryInput;
}

export interface FactoryHookStateSummary {
  sessionId: string;
  stage: HarnessFactoryState['stage'];
  userIntent: string;
  targetRuntime?: RuntimeTarget;
  requestedCapabilities: string[];
  openQuestionCount: number;
  confirmedDecisionCount: number;
  projectPath?: string;
  verificationStatus: HarnessFactoryState['verification']['status'];
}

export interface FactoryHookContext {
  payload: FactoryHookRuntimePayload;
  hookName: FactoryHookEventName;
  sessionId: string;
  stateRoot: string;
  cwd: string;
  store: HarnessFactoryStore;
  now: string;
  loadOrCreateState(): Promise<HarnessFactoryState>;
  saveState(state: HarnessFactoryState): Promise<HarnessFactoryState>;
}

export interface FactoryHookProcessResult {
  exitCode: number;
  stdout: string;
}

export type FactoryHookJsonOutput = Record<string, unknown>;

const SUPPORTED_HOOKS = new Set<FactoryHookEventName>(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  return strings.length > 0 ? strings : undefined;
}

function factoryInput(payload: FactoryHookRuntimePayload): FactoryHookFactoryInput {
  return asRecord(payload.factory) as FactoryHookFactoryInput | undefined ?? {};
}

function resolveHookName(payload: FactoryHookRuntimePayload): FactoryHookEventName | undefined {
  const hookName = stringValue(payload.hook_event_name);
  return hookName && SUPPORTED_HOOKS.has(hookName as FactoryHookEventName) ? hookName as FactoryHookEventName : undefined;
}

function resolveSessionId(payload: FactoryHookRuntimePayload): string {
  const factory = factoryInput(payload);
  return stringValue(factory.sessionId) ?? stringValue(payload.session_id) ?? stringValue(payload.sessionId) ?? 'default';
}

function resolveCwd(payload: FactoryHookRuntimePayload): string {
  return resolve(stringValue(payload.cwd) ?? process.cwd());
}

function resolveStateRoot(payload: FactoryHookRuntimePayload): string {
  const factory = factoryInput(payload);
  return resolve(stringValue(factory.stateRoot) ?? process.env.HARNESS_FACTORY_STATE_DIR ?? join(resolveCwd(payload), '.omx', 'factory-state'));
}

function initialUserIntent(payload: FactoryHookRuntimePayload, sessionId: string): string {
  const factory = factoryInput(payload);
  return stringValue(factory.userIntent) ?? stringValue(payload.prompt) ?? `Harness Factory session ${sessionId}`;
}

function initialTargetRuntime(payload: FactoryHookRuntimePayload): RuntimeTarget | undefined {
  const value = stringValue(factoryInput(payload).targetRuntime);
  return value === 'claude-code' || value === 'opencode' || value === 'codex' ? value : undefined;
}

function initialCapabilities(payload: FactoryHookRuntimePayload): string[] | undefined {
  return stringArrayValue(factoryInput(payload).requestedCapabilities);
}

function isMissingStateError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function summarizeFactoryState(state: HarnessFactoryState): FactoryHookStateSummary {
  return {
    sessionId: state.sessionId,
    stage: state.stage,
    userIntent: state.userIntent,
    ...(state.targetRuntime ? { targetRuntime: state.targetRuntime } : {}),
    requestedCapabilities: state.requestedCapabilities,
    openQuestionCount: state.openQuestions.length,
    confirmedDecisionCount: state.confirmedDecisions.length,
    ...(state.projectPath ? { projectPath: state.projectPath } : {}),
    verificationStatus: state.verification.status
  };
}

export function additionalContextOutput(hookName: FactoryHookEventName, additionalContext: string, harnessFactory: Record<string, unknown>): FactoryHookJsonOutput {
  return {
    hookSpecificOutput: {
      hookEventName: hookName,
      additionalContext
    },
    harnessFactory
  };
}

export function createFactoryHookContext(payload: FactoryHookRuntimePayload, now = new Date().toISOString()): FactoryHookContext {
  const hookName = resolveHookName(payload);
  if (!hookName) throw new Error(`Unsupported Factory hook event: ${String(payload.hook_event_name ?? 'missing')}`);

  const sessionId = resolveSessionId(payload);
  const stateRoot = resolveStateRoot(payload);
  const cwd = resolveCwd(payload);
  const store = createHarnessFactoryStore(stateRoot);

  return {
    payload,
    hookName,
    sessionId,
    stateRoot,
    cwd,
    store,
    now,
    async loadOrCreateState() {
      try {
        return await store.load(sessionId);
      } catch (error) {
        if (!isMissingStateError(error)) throw error;
        const targetRuntime = initialTargetRuntime(payload);
        const requestedCapabilities = initialCapabilities(payload);
        return store.create({
          sessionId,
          userIntent: initialUserIntent(payload, sessionId),
          ...(targetRuntime ? { targetRuntime } : {}),
          ...(requestedCapabilities ? { requestedCapabilities } : {})
        });
      }
    },
    async saveState(state) {
      return store.save(state);
    }
  };
}

export async function handleFactoryHook(payload: FactoryHookRuntimePayload, now = new Date().toISOString()): Promise<FactoryHookJsonOutput> {
  const context = createFactoryHookContext(payload, now);

  switch (context.hookName) {
    case 'SessionStart':
      return handleSessionStartHook(context);
    case 'UserPromptSubmit':
      return handleUserPromptSubmitHook(context);
    case 'PreToolUse':
      return handlePreToolUseHook(context);
    case 'PostToolUse':
      return handlePostToolUseHook(context);
  }
}

export async function handleFactoryHookStdin(raw: string, now = new Date().toISOString()): Promise<FactoryHookProcessResult> {
  const parsed = parseHookStdin(raw);
  if (!parsed.ok) {
    return {
      exitCode: 0,
      stdout: stringifyHookOutput({
        decision: 'block',
        reason: parsed.error.message,
        harnessFactory: { ok: false, error: parsed.error.message, rawPayloadPreview: parsed.error.rawPayloadPreview }
      })
    };
  }

  try {
    const output = await handleFactoryHook(parsed.payload as FactoryHookRuntimePayload, now);
    return { exitCode: 0, stdout: stringifyHookOutput(output) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 0,
      stdout: stringifyHookOutput({
        decision: 'block',
        reason: message,
        harnessFactory: { ok: false, error: message }
      })
    };
  }
}
