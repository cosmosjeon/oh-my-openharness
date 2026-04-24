import type { Node } from '@xyflow/react';
import type { GraphNode, LayoutNode, RegistryBlock, RuntimeTarget } from '../../core/types';
import type { HarnessFlowEdge, HarnessFlowNode, ProjectPayload, RuntimeCompatibilityEntry } from './types';

function layoutById(layout: LayoutNode[]): Map<string, LayoutNode> {
  return new Map(layout.map((entry) => [entry.id, entry]));
}

export function registryBlockForNode(project: ProjectPayload, node: GraphNode): RegistryBlock | undefined {
  return project.registry.blocks.find((block) => block.kind === node.kind);
}

export function compatibilityForNode(project: ProjectPayload, node: GraphNode): RuntimeTarget[] {
  if (node.kind === 'CustomBlock') {
    const customBlockId = typeof node.config?.customBlockId === 'string' ? node.config.customBlockId : undefined;
    const definition = customBlockId ? project.customBlocks.find((block) => block.id === customBlockId) : project.customBlocks[0];
    if (definition?.runtimeTargets) return [...new Set(definition.runtimeTargets)];
  }
  const block = registryBlockForNode(project, node);
  if (block) return block.compatibleRuntimes;
  return project.runtimeIntents?.filter((intent) => intent.sourceNodeIds.includes(node.id)).map((intent) => intent.targetRuntime) ?? [];
}

export function runtimeCompatibilityForNode(project: ProjectPayload, node: GraphNode): RuntimeCompatibilityEntry[] {
  const compatible = compatibilityForNode(project, node);
  const runtimes: RuntimeTarget[] = ['claude-code', 'opencode', 'codex'];
  return runtimes.map((runtime) => ({
    runtime,
    level: compatible.includes(runtime) ? 'supported' : 'error',
    reason: compatible.includes(runtime)
      ? `${node.kind} is supported on ${runtime}.`
      : `${node.kind} is not compatible with ${runtime}.`
  }));
}

export function toReactFlowNodes(project: ProjectPayload): HarnessFlowNode[] {
  const positions = layoutById(project.layout);
  return project.nodes.map((node, index) => {
    const position = positions.get(node.id) ?? { id: node.id, x: 100 + index * 40, y: 100 + index * 40 };
    const block = registryBlockForNode(project, node);
    return {
      id: node.id,
      position: { x: position.x, y: position.y },
      data: {
        label: node.label,
        kind: node.kind,
        ...(node.config ? { config: node.config } : {}),
        compatibility: runtimeCompatibilityForNode(project, node),
        ...(block?.safety ? { safety: block.safety } : {})
      },
      type: 'default'
    };
  });
}

export function toReactFlowEdges(project: ProjectPayload): HarnessFlowEdge[] {
  return project.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    data: edge.label ? { label: edge.label } : {},
    animated: false
  }));
}

export function skillForFlowNode(project: ProjectPayload, node: HarnessFlowNode | null | undefined) {
  if (!node) return null;
  const configuredSkillId = node.data.config?.skillId;
  if (typeof configuredSkillId === 'string') {
    return project.skills.find((skill) => skill.id === configuredSkillId) ?? null;
  }
  return project.skills.find((skill) => skill.id === node.id || skill.name === node.data.label) ?? null;
}

export function serializeFlowLayout(nodes: Array<Pick<Node, 'id' | 'position'>>): LayoutNode[] {
  return nodes.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y }));
}

export function catalogFromProject(project: ProjectPayload) {
  return { blocks: project.registry.blocks, composites: project.registry.composites };
}
