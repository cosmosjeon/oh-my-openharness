import { createRegistrySnapshot, HOOK_BLOCK_KINDS } from '../../core/registry';
import { applyRiskConfirmations, refreshDerivedProject } from '../../core/generator';
import type { HarnessManifest, HarnessProject, LayoutNode, RuntimeIntent, SkillFile } from '../../core/types';
import { buildHarnessFactoryGraphPlan } from '../synthesis/graph-plan';
import { createHarnessFactoryDraft, type HarnessFactoryDraftSpec } from '../synthesis/draft-spec';

export interface DraftToProjectOptions {
  createdAt?: string;
  version?: string;
  confirmRisk?: boolean;
}

function deriveRuntimeIntents(manifest: HarnessManifest, nodes: HarnessProject['nodes']): RuntimeIntent[] {
  const intents: RuntimeIntent[] = [];
  for (const node of nodes) {
    if (HOOK_BLOCK_KINDS.includes(node.kind)) {
      intents.push({ id: `intent:${node.id}`, kind: 'hook', label: node.label, targetRuntime: manifest.targetRuntime, sourceNodeIds: [node.id], transport: 'stdio', safety: 'safe' });
    } else if (node.kind === 'MCPServer') {
      intents.push({ id: `intent:${node.id}`, kind: 'mcp-server', label: node.label, targetRuntime: manifest.targetRuntime, sourceNodeIds: [node.id], transport: 'stdio', safety: 'confirm' });
    } else if (node.kind === 'StateRead' || node.kind === 'StateWrite') {
      intents.push({ id: `intent:${node.id}`, kind: 'state', label: node.label, targetRuntime: manifest.targetRuntime, sourceNodeIds: [node.id], transport: 'in-memory', safety: 'safe' });
    } else if (node.kind === 'CustomBlock') {
      intents.push({ id: `intent:${node.id}`, kind: 'custom-runtime', label: node.label, targetRuntime: manifest.targetRuntime, sourceNodeIds: [node.id], safety: 'confirm' });
    }
  }
  return intents;
}

function mergeRuntimeIntents(base: RuntimeIntent[], overrides: RuntimeIntent[]): RuntimeIntent[] {
  const byId = new Map<string, RuntimeIntent>();
  for (const intent of [...base, ...overrides]) {
    byId.set(intent.id, { ...intent, sourceNodeIds: [...intent.sourceNodeIds] });
  }
  return [...byId.values()];
}

function normalizeLayout(nodes: HarnessProject['nodes']): LayoutNode[] {
  return nodes.map((node, index) => ({
    id: node.id,
    x: 80 + (index % 4) * 220,
    y: 120 + Math.floor(index / 4) * 160
  }));
}

function cloneSkills(skills: SkillFile[]): SkillFile[] {
  return skills.map((skill) => ({ ...skill }));
}

function buildManifest(draft: HarnessFactoryDraftSpec, options: DraftToProjectOptions): HarnessManifest {
  return {
    schemaVersion: '0.1.0',
    name: draft.name,
    version: options.version ?? '0.1.0',
    description: draft.description ?? draft.summary,
    targetRuntime: draft.targetRuntime,
    supportedRuntimes: [draft.targetRuntime],
    createdAt: options.createdAt ?? new Date().toISOString(),
    prompt: draft.prompt
  };
}

export function draftToProject(input: HarnessFactoryDraftSpec, options: DraftToProjectOptions = {}): HarnessProject {
  const draft = createHarnessFactoryDraft(input);
  const graphPlan = buildHarnessFactoryGraphPlan(draft);
  const manifest = buildManifest(draft, options);
  const runtimeIntents = mergeRuntimeIntents(deriveRuntimeIntents(manifest, graphPlan.nodes), graphPlan.runtimeIntents);

  const project: HarnessProject = {
    manifest,
    nodes: graphPlan.nodes,
    edges: graphPlan.edges,
    skills: cloneSkills(graphPlan.skills),
    layout: normalizeLayout(graphPlan.nodes),
    composites: [],
    customBlocks: [],
    registry: createRegistrySnapshot(),
    authoring: {
      summary: draft.summary,
      warnings: [],
      confirmationRequests: [],
      compatibleRuntimes: [draft.targetRuntime],
      traceIntent: ['hook-activation', 'failure']
    },
    runtimeIntents
  };

  const refreshed = refreshDerivedProject(project);
  return options.confirmRisk ? applyRiskConfirmations(refreshed, true) : refreshed;
}
