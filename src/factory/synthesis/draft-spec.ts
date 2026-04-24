import { generateHarnessProject } from '../../core/generator';
import type { HarnessProject, RuntimeTarget } from '../../core/types';
import type { HarnessFactoryDraftGraphSpec, HarnessFactoryState } from '../state';

export interface DraftProjectOptions {
  name: string;
  targetRuntime?: RuntimeTarget;
}

export function buildFactoryPrompt(state: HarnessFactoryState): string {
  const parts = [state.userIntent];
  if (state.requestedCapabilities.length > 0) parts.push(`Requested capabilities: ${state.requestedCapabilities.join(', ')}`);
  if (state.referencePatterns.length > 0) parts.push(`Reference patterns: ${state.referencePatterns.map((pattern) => pattern.id).join(', ')}`);
  if (state.confirmedDecisions.length > 0) {
    parts.push(`Confirmed decisions: ${state.confirmedDecisions.map((decision) => `${decision.key}=${String(decision.value)}`).join('; ')}`);
  }
  return parts.join('\n');
}

export function draftGraphSpecFromProject(project: HarnessProject): HarnessFactoryDraftGraphSpec {
  return {
    nodes: project.nodes,
    edges: project.edges,
    runtimeIntents: project.runtimeIntents ?? [],
    skills: project.skills
  };
}

export function projectFromFactoryState(state: HarnessFactoryState, options: DraftProjectOptions): HarnessProject {
  const targetRuntime = options.targetRuntime ?? state.targetRuntime ?? 'claude-code';
  const project = generateHarnessProject(options.name, buildFactoryPrompt(state), targetRuntime);
  const hasExplicitDraft = state.draftGraphSpec.nodes.length > 0 && state.draftGraphSpec.edges.length > 0 && state.draftGraphSpec.skills.length > 0;
  if (!hasExplicitDraft) return project;
  return {
    ...project,
    nodes: state.draftGraphSpec.nodes,
    edges: state.draftGraphSpec.edges,
    skills: state.draftGraphSpec.skills,
    runtimeIntents: state.draftGraphSpec.runtimeIntents.length > 0 ? state.draftGraphSpec.runtimeIntents : project.runtimeIntents,
    manifest: {
      ...project.manifest,
      description: `Harness Factory draft for: ${state.userIntent}`
    }
  };
}

export function synthesizeDraftGraphSpec(state: HarnessFactoryState, options: DraftProjectOptions): HarnessFactoryDraftGraphSpec {
  return draftGraphSpecFromProject(projectFromFactoryState(state, options));
}
