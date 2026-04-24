import type { Edge, Node } from '@xyflow/react';
import type { GraphEdge, GraphNode, HarnessProject, LayoutNode, RegistryBlock, RuntimeCompatibilityLevel, RuntimeTarget, SkillFile } from '../../core/types';

export type ProjectPayload = Pick<
  HarnessProject,
  'manifest' | 'nodes' | 'edges' | 'layout' | 'skills' | 'composites' | 'customBlocks' | 'registry' | 'authoring' | 'runtimeIntents'
>;

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  kind: GraphNode['kind'];
  config?: Record<string, unknown>;
  compatibility: RuntimeCompatibilityEntry[];
  safety?: RegistryBlock['safety'];
}

export type HarnessFlowNode = Node<FlowNodeData>;
export type HarnessFlowEdge = Edge<{ label?: string }>;

export interface CatalogPayload {
  blocks: ProjectPayload['registry']['blocks'];
  composites: ProjectPayload['registry']['composites'];
}

export interface RuntimeCompatibilityEntry {
  runtime: RuntimeTarget;
  level: RuntimeCompatibilityLevel;
  reason: string;
}

export interface FactoryStateView {
  sessionId: string;
  stage: string;
  targetRuntime?: RuntimeTarget;
  openQuestions: unknown[];
  confirmedDecisions: unknown[];
  projectPath?: string;
  verification: { status: string };
}

export interface FactoryStatePayload {
  configured: boolean;
  stateRoot: string;
  sessionId: string;
  state?: FactoryStateView;
  error?: string;
}

export interface FactoryChatPayload {
  ok: boolean;
  route: string;
  reason: string;
  state?: FactoryStateView;
  question?: unknown;
  result?: unknown;
  error?: string;
}

export interface SkillUpdatePayload {
  skillId?: string;
  name?: string;
  content: string;
  description?: string;
}

export type SkillSummary = Pick<SkillFile, 'id' | 'name' | 'description' | 'content'>;

export interface LayoutSavePayload {
  layout: LayoutNode[];
}
