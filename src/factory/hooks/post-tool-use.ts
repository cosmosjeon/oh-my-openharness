import { dirname, isAbsolute, normalize, resolve } from 'node:path';
import { withFactoryStateUpdate, type HarnessFactoryPreviewStatus, type HarnessFactoryState, type HarnessFactoryVerification } from '../state';
import { additionalContextOutput, summarizeFactoryState, type FactoryHookContext, type FactoryHookJsonOutput } from './runtime';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function resolveMaybePath(context: FactoryHookContext, value: string | undefined): string | undefined {
  if (!value) return undefined;
  return normalize(isAbsolute(value) ? value : resolve(context.cwd, value));
}

function toolInputPath(context: FactoryHookContext): string | undefined {
  const input = asRecord(context.payload.tool_input);
  return stringValue(input?.file_path) ?? stringValue(input?.path);
}

function projectRootFromFilePath(filePath: string): string | undefined {
  const normalized = normalize(filePath);
  if (normalized.endsWith('/manifest.yaml')) return dirname(normalized);
  for (const segment of ['/nodes/', '/composites/', '/custom-blocks/']) {
    const index = normalized.indexOf(segment);
    if (index > 0) return normalized.slice(0, index);
  }
  return undefined;
}

function projectPathFromPayload(context: FactoryHookContext): string | undefined {
  const response = asRecord(context.payload.tool_response);
  const explicitProjectPath = resolveMaybePath(context, stringValue(response?.projectDir))
    ?? resolveMaybePath(context, stringValue(response?.projectPath));
  if (explicitProjectPath) return explicitProjectPath;

  const inputPath = resolveMaybePath(context, toolInputPath(context));
  return inputPath ? projectRootFromFilePath(inputPath) : undefined;
}

function previewFromPayload(context: FactoryHookContext, state: HarnessFactoryState): HarnessFactoryPreviewStatus | undefined {
  const response = asRecord(context.payload.tool_response);
  const url = stringValue(response?.url);
  if (!url) return undefined;
  return { ...state.preview, url, status: 'open', lastOpenedAt: context.now };
}

function verificationFromPayload(context: FactoryHookContext, state: HarnessFactoryState): HarnessFactoryVerification | undefined {
  const response = asRecord(context.payload.tool_response);
  const ok = booleanValue(response?.ok);
  if (ok === undefined) return undefined;

  const summary = stringValue(response?.summary);
  const traceFile = resolveMaybePath(context, stringValue(response?.traceFile));
  const error = stringValue(response?.error);

  return {
    ...state.verification,
    status: ok ? 'passed' : 'failed',
    ok,
    lastRunAt: context.now,
    ...(summary ? { summary } : {}),
    ...(traceFile ? { traceFile } : {}),
    ...(error ? { error } : {})
  };
}

export async function handlePostToolUseHook(context: FactoryHookContext): Promise<FactoryHookJsonOutput> {
  const state = await context.loadOrCreateState();
  const projectPath = projectPathFromPayload(context);
  const preview = previewFromPayload(context, state);
  const verification = verificationFromPayload(context, state);

  const updates = {
    ...(projectPath ? { projectPath } : {}),
    ...(preview ? { preview } : {}),
    ...(verification ? { verification } : {})
  };
  const updated = Object.keys(updates).length > 0;
  const nextState = updated
    ? withFactoryStateUpdate(
        state,
        {
          ...(projectPath ? { projectPath, stage: 'built' as const } : {}),
          ...(preview ? { preview, stage: 'previewing' as const } : {}),
          ...(verification ? { verification, stage: 'verifying' as const } : {})
        },
        context.now
      )
    : state;

  const savedState = nextState === state ? state : await context.saveState(nextState);
  const summary = summarizeFactoryState(savedState);

  return additionalContextOutput(
    'PostToolUse',
    updated
      ? 'Harness Factory persisted recognized project/materialization state from the completed tool call.'
      : 'Harness Factory observed the completed tool call; no recognized project state update was needed.',
    {
      ok: true,
      hook: 'PostToolUse',
      updated,
      updates,
      state: summary
    }
  );
}
