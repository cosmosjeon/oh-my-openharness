import { loadHarnessProject } from '../../core/project';
import type { HarnessFactoryActionFailure, HarnessFactoryActionName, HarnessFactoryState } from '../state';

export type FactoryActionErrorCategory = 'missing-project' | 'invalid-state' | 'substrate-error' | 'sandbox-failure';

export interface FactoryActionFailureInput {
  action: HarnessFactoryActionName;
  error: unknown;
  category: FactoryActionErrorCategory;
  timestamp: string;
  state: HarnessFactoryState;
  projectPath?: string;
  graphHash?: string;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

export async function graphHashForProject(projectPath?: string): Promise<string | undefined> {
  if (!projectPath) return undefined;
  try {
    return (await loadHarnessProject(projectPath)).manifest.graphHash;
  } catch {
    return undefined;
  }
}

export function createFactoryActionFailure(input: FactoryActionFailureInput): HarnessFactoryActionFailure {
  const stack = errorStack(input.error);
  const projectPath = input.projectPath ?? input.state.projectPath;
  return {
    action: input.action,
    message: errorMessage(input.error),
    category: input.category,
    timestamp: input.timestamp,
    ...(stack ? { stack } : {}),
    ...(projectPath ? { projectPath } : {}),
    ...(input.graphHash ? { graphHash: input.graphHash } : {})
  };
}
