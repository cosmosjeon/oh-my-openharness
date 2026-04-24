import type { RuntimeTarget } from '../../core/types';
import { referenceSelectionsForCapabilities } from '../reference';
import type { HarnessFactoryState } from '../state';

export function enrichStateWithReferencePatterns(state: HarnessFactoryState, limit = 3): HarnessFactoryState {
  const selections = referenceSelectionsForCapabilities({
    intent: state.userIntent,
    capabilities: state.requestedCapabilities,
    targetRuntime: state.targetRuntime as RuntimeTarget | undefined,
    limit
  });
  const existing = new Set(state.referencePatterns.map((pattern) => pattern.id));
  return {
    ...state,
    referencePatterns: [...state.referencePatterns, ...selections.filter((selection) => !existing.has(selection.id))],
    updatedAt: new Date().toISOString()
  };
}
