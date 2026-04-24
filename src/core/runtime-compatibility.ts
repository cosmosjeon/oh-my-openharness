import type { GraphNode, HarnessProject, NodeKind, RegistryBlock, RuntimeTarget } from './types';
import { RUNTIME_TARGETS } from './runtime-targets';

export type RuntimeCompatibilityStatus = 'supported' | 'warn' | 'error';
export type RuntimeProofLevel = 'host-installable' | 'fixture-roundtrip' | 'blocked-host-proof';

export interface RuntimeSupportMetadata {
  targetRuntime: RuntimeTarget;
  displayName: string;
  hostCommand: string;
  proofLevel: RuntimeProofLevel;
  proofDescription: string;
}

export interface RuntimeCompatibilityNode {
  id: string;
  kind: NodeKind;
  label: string;
  compatibleRuntimes: RuntimeTarget[];
  status: RuntimeCompatibilityStatus;
  message: string;
}

export interface RuntimeCompatibilityReport {
  targetRuntime: RuntimeTarget;
  runtime: RuntimeSupportMetadata;
  status: RuntimeCompatibilityStatus;
  nodes: RuntimeCompatibilityNode[];
  warnings: string[];
  errors: string[];
}

function uniqueRuntimes(runtimes: RuntimeTarget[]): RuntimeTarget[] {
  return [...new Set(runtimes)];
}

function registryBlock(project: HarnessProject, kind: NodeKind): RegistryBlock | undefined {
  return project.registry.blocks.find((block) => block.kind === kind);
}

function customBlockRuntimes(project: HarnessProject, node: GraphNode): RuntimeTarget[] | undefined {
  if (node.kind !== 'CustomBlock') return undefined;
  const customBlockId = typeof node.config?.customBlockId === 'string' ? node.config.customBlockId : undefined;
  const definition = customBlockId ? project.customBlocks.find((block) => block.id === customBlockId) : project.customBlocks[0];
  return definition?.runtimeTargets ? uniqueRuntimes(definition.runtimeTargets) : undefined;
}

export function runtimeSupportMetadata(targetRuntime: RuntimeTarget): RuntimeSupportMetadata {
  const descriptor = RUNTIME_TARGETS[targetRuntime];
  if (targetRuntime === 'claude-code') {
    return {
      targetRuntime,
      displayName: descriptor.displayName,
      hostCommand: descriptor.hostCommand,
      proofLevel: 'host-installable',
      proofDescription: 'Claude bundles include plugin/package install metadata plus fixture sandbox validation; real host proof is recorded separately when auth is available.'
    };
  }
  return {
    targetRuntime,
    displayName: descriptor.displayName,
    hostCommand: descriptor.hostCommand,
    proofLevel: 'fixture-roundtrip',
    proofDescription: `${descriptor.displayName} support is compile/export/import roundtrip verified with fixture sandbox scripts; host-specific install readiness remains a doctor/setup concern.`
  };
}

export function compatibleRuntimesForNode(project: HarnessProject, node: GraphNode): RuntimeTarget[] {
  const customRuntimes = customBlockRuntimes(project, node);
  if (customRuntimes) return customRuntimes;
  return uniqueRuntimes(registryBlock(project, node.kind)?.compatibleRuntimes ?? project.manifest.supportedRuntimes ?? [project.manifest.targetRuntime]);
}

export function runtimeCompatibilityReport(project: HarnessProject, targetRuntime: RuntimeTarget = project.manifest.targetRuntime): RuntimeCompatibilityReport {
  const warnings: string[] = [];
  const errors: string[] = [];
  const nodes = project.nodes.map((node): RuntimeCompatibilityNode => {
    const compatibleRuntimes = compatibleRuntimesForNode(project, node);
    if (!compatibleRuntimes.includes(targetRuntime)) {
      const message = `${node.kind} node ${node.id} is not compatible with ${targetRuntime}; compatible runtimes: ${compatibleRuntimes.join(', ') || 'none'}.`;
      errors.push(message);
      return { id: node.id, kind: node.kind, label: node.label, compatibleRuntimes, status: 'error', message };
    }
    return {
      id: node.id,
      kind: node.kind,
      label: node.label,
      compatibleRuntimes,
      status: 'supported',
      message: `${node.kind} is supported on ${targetRuntime}.`
    };
  });

  if (project.manifest.supportedRuntimes && !project.manifest.supportedRuntimes.includes(targetRuntime)) {
    warnings.push(`Project manifest does not list ${targetRuntime} in supportedRuntimes.`);
  }

  const status: RuntimeCompatibilityStatus = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'supported';
  return { targetRuntime, runtime: runtimeSupportMetadata(targetRuntime), status, nodes, warnings, errors };
}

export function assertRuntimeCompatibility(project: HarnessProject, targetRuntime: RuntimeTarget = project.manifest.targetRuntime): RuntimeCompatibilityReport {
  const report = runtimeCompatibilityReport(project, targetRuntime);
  if (report.errors.length > 0) {
    throw new Error(`Runtime compatibility check failed for ${targetRuntime}: ${report.errors.join(' | ')}`);
  }
  return report;
}
