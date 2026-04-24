import { isAbsolute, normalize, resolve } from 'node:path';
import { isReadyToDraft } from '../interview';
import { additionalContextOutput, summarizeFactoryState, type FactoryHookContext, type FactoryHookJsonOutput } from './runtime';

const MUTATION_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'mcp__filesystem__write_file', 'mcp__filesystem__edit_file']);
const CANONICAL_DIRS = ['/nodes/', '/composites/', '/custom-blocks/'];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toolName(context: FactoryHookContext): string {
  return stringValue(context.payload.tool_name) ?? 'unknown';
}

function toolInputPath(context: FactoryHookContext): string | undefined {
  const input = asRecord(context.payload.tool_input);
  return stringValue(input?.file_path) ?? stringValue(input?.path);
}

function resolveToolPath(context: FactoryHookContext): string | undefined {
  const value = toolInputPath(context);
  if (!value) return undefined;
  return normalize(isAbsolute(value) ? value : resolve(context.cwd, value));
}

function isMutationTool(name: string): boolean {
  return MUTATION_TOOLS.has(name) || (name.startsWith('mcp__') && (name.endsWith('__write_file') || name.endsWith('__edit_file')));
}

function isCanonicalProjectPath(targetPath: string, projectPath?: string): boolean {
  const normalized = normalize(targetPath);
  if (projectPath && (normalized === normalize(projectPath) || normalized.startsWith(`${normalize(projectPath)}/`))) return true;
  if (normalized.endsWith('/manifest.yaml')) return true;
  return CANONICAL_DIRS.some((segment) => normalized.includes(segment));
}

export async function handlePreToolUseHook(context: FactoryHookContext): Promise<FactoryHookJsonOutput> {
  const state = await context.loadOrCreateState();
  const name = toolName(context);
  const targetPath = resolveToolPath(context);
  const mutationTool = isMutationTool(name);
  const canonicalPath = targetPath ? isCanonicalProjectPath(targetPath, state.projectPath) : false;
  const ready = isReadyToDraft(state);
  const summary = summarizeFactoryState(state);

  if (mutationTool && canonicalPath && !ready) {
    const reason = 'Harness Factory blocked an out-of-order canonical project mutation because target runtime/capability decisions are not complete.';
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
        additionalContext: reason
      },
      harnessFactory: {
        ok: false,
        hook: 'PreToolUse',
        guard: 'blocked',
        reason,
        toolName: name,
        ...(targetPath ? { path: targetPath } : {}),
        state: summary
      }
    };
  }

  return additionalContextOutput(
    'PreToolUse',
    mutationTool && canonicalPath
      ? 'Harness Factory guard observed a canonical project mutation after readiness; allow normal permission flow.'
      : 'Harness Factory guard found no out-of-order canonical project mutation.',
    {
      ok: true,
      hook: 'PreToolUse',
      guard: 'allow',
      toolName: name,
      ...(targetPath ? { path: targetPath } : {}),
      state: summary
    }
  );
}
