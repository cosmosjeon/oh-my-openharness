import type { GraphEdge, GraphNode, RuntimeIntent, SkillFile } from '../../core/types';
import {
  createHarnessFactoryDraft,
  mergeHarnessFactoryDraftGraphSpec,
  type HarnessFactoryDraftGraphSpec,
  type HarnessFactoryDraftSpec
} from './draft-spec';
import { describeHarnessFactoryCapability, resolveBuiltinHarnessCapabilities, summarizeHarnessCapabilities } from './capability-mapping';

export interface HarnessFactoryGraphPlan extends HarnessFactoryDraftGraphSpec {
  summary: string[];
}

function cloneNode(node: GraphNode): GraphNode {
  return { ...node, config: node.config ? { ...node.config } : undefined };
}

function cloneEdge(edge: GraphEdge): GraphEdge {
  return { ...edge };
}

function cloneRuntimeIntent(intent: RuntimeIntent): RuntimeIntent {
  return { ...intent, sourceNodeIds: [...intent.sourceNodeIds] };
}

function cloneSkill(skill: SkillFile): SkillFile {
  return { ...skill };
}

function addNode(nodes: Map<string, GraphNode>, node: GraphNode) {
  nodes.set(node.id, cloneNode(node));
}

function addEdge(edges: Map<string, GraphEdge>, edge: GraphEdge) {
  edges.set(edge.id, cloneEdge(edge));
}

function createDefaultSkill(draft: HarnessFactoryDraftSpec, capabilityLabels: string[]): SkillFile {
  const capabilityLines =
    capabilityLabels.length === 0
      ? '- Baseline harness flow\n'
      : capabilityLabels.map((label) => `- ${label}`).join('\n');
  const decisionLines =
    draft.confirmedDecisions.length === 0
      ? '- No confirmed decisions yet\n'
      : draft.confirmedDecisions.map((decision) => `- ${decision.key}: ${JSON.stringify(decision.value)}`).join('\n');
  const referenceLines =
    draft.referencePatterns.length === 0
      ? '- No reference patterns attached yet\n'
      : draft.referencePatterns.map((pattern) => `- ${pattern.id} (${pattern.sourceRepo}) — ${pattern.why}`).join('\n');

  return {
    id: 'skill-main',
    name: `${draft.name}-factory-skill`,
    description: 'Harness Factory synthesized orchestration skill',
    content: `---\nname: ${draft.name}-factory-skill\ndescription: Harness Factory synthesized skill\n---\n\n# ${draft.name}\n\nUser intent: ${draft.prompt}\n\n## Target runtime\n- ${draft.targetRuntime}\n\n## Requested capabilities\n${capabilityLines}\n\n## Confirmed decisions\n${decisionLines}\n\n## Reference patterns\n${referenceLines}\n`
  };
}

function assertGraphIntegrity(graph: HarnessFactoryDraftGraphSpec) {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`Draft graph edge ${edge.id} references missing nodes (${edge.from} -> ${edge.to}).`);
    }
  }
  if (graph.skills.length === 0) {
    throw new Error('Draft graph must include at least one skill.');
  }
}

export function buildHarnessFactoryGraphPlan(input: HarnessFactoryDraftSpec): HarnessFactoryGraphPlan {
  const draft = createHarnessFactoryDraft(input);
  const capabilityIds = resolveBuiltinHarnessCapabilities(draft);
  const capabilityLabels = capabilityIds.map((capabilityId) => describeHarnessFactoryCapability(capabilityId).label);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  addNode(nodes, { id: 'session-start', kind: 'SessionStart', label: 'Session Start' });
  addNode(nodes, { id: 'system-prompt', kind: 'SystemPrompt', label: 'Factory System Prompt' });
  addNode(nodes, { id: 'user-prompt-submit', kind: 'UserPromptSubmit', label: 'User Prompt Submit' });
  addNode(nodes, { id: 'pre-tool-use', kind: 'PreToolUse', label: 'Pre Tool Use Guard' });
  addNode(nodes, { id: 'main-skill', kind: 'Skill', label: 'Synthesize Harness Draft', config: { skillId: 'skill-main' } });
  addNode(nodes, { id: 'sequence', kind: 'Sequence', label: 'Draft Build Sequence' });
  addNode(nodes, { id: 'state-write', kind: 'StateWrite', label: 'Persist Factory State' });
  addNode(nodes, { id: 'post-tool-use', kind: 'PostToolUse', label: 'Post Tool Use' });
  addNode(nodes, { id: 'stop', kind: 'Stop', label: 'Stop' });

  if (capabilityIds.includes('state-memory')) {
    addNode(nodes, { id: 'state-read', kind: 'StateRead', label: 'Restore Factory State' });
    addEdge(edges, { id: 'edge-session-state-read', from: 'session-start', to: 'state-read', label: 'load-state' });
    addEdge(edges, { id: 'edge-state-read-system', from: 'state-read', to: 'system-prompt', label: 'hydrate-context' });
  } else {
    addEdge(edges, { id: 'edge-session-system', from: 'session-start', to: 'system-prompt', label: 'initialize' });
  }

  addEdge(edges, { id: 'edge-system-submit', from: 'system-prompt', to: 'user-prompt-submit', label: 'ready' });
  addEdge(edges, { id: 'edge-submit-pre-tool', from: 'user-prompt-submit', to: 'pre-tool-use', label: 'validate-input' });
  addEdge(edges, { id: 'edge-pre-tool-skill', from: 'pre-tool-use', to: 'main-skill', label: 'dispatch' });

  let currentNodeId = 'main-skill';
  if (capabilityIds.includes('approval-gate')) {
    addNode(nodes, { id: 'permission-gate', kind: 'Permission', label: 'Permission Gate' });
    addNode(nodes, { id: 'approval-branch', kind: 'Condition', label: 'Approval Branch' });
    addEdge(edges, { id: 'edge-skill-permission', from: currentNodeId, to: 'permission-gate', label: 'requires-approval' });
    addEdge(edges, { id: 'edge-permission-branch', from: 'permission-gate', to: 'approval-branch', label: 'review' });
    addEdge(edges, { id: 'edge-branch-sequence', from: 'approval-branch', to: 'sequence', label: 'approved' });
    addEdge(edges, { id: 'edge-branch-stop', from: 'approval-branch', to: 'stop', label: 'blocked' });
    currentNodeId = 'sequence';
  } else {
    addEdge(edges, { id: 'edge-skill-sequence', from: currentNodeId, to: 'sequence', label: 'compose-graph' });
    currentNodeId = 'sequence';
  }

  if (capabilityIds.includes('subagent-delegation')) {
    addNode(nodes, { id: 'delegate-agent', kind: 'Agent', label: 'Delegate Specialist Agent' });
    addNode(nodes, { id: 'delegate-merge', kind: 'Merge', label: 'Merge Agent Output' });
    addEdge(edges, { id: 'edge-sequence-agent', from: currentNodeId, to: 'delegate-agent', label: 'delegate' });
    addEdge(edges, { id: 'edge-agent-merge', from: 'delegate-agent', to: 'delegate-merge', label: 'merge-results' });
    currentNodeId = 'delegate-merge';
  }

  if (capabilityIds.includes('mcp-server')) {
    addNode(nodes, { id: 'mcp-server', kind: 'MCPServer', label: 'MCP Server Registration' });
    addEdge(edges, { id: 'edge-current-mcp', from: currentNodeId, to: 'mcp-server', label: 'register-mcp' });
    currentNodeId = 'mcp-server';
  }

  if (capabilityIds.includes('review-loop')) {
    addNode(nodes, { id: 'review-loop', kind: 'Loop', label: 'Review Loop' });
    addNode(nodes, { id: 'review-branch', kind: 'Condition', label: 'Review Outcome Branch' });
    addEdge(edges, { id: 'edge-current-review', from: currentNodeId, to: 'review-loop', label: 'review' });
    addEdge(edges, { id: 'edge-review-branch', from: 'review-loop', to: 'review-branch', label: 'assess' });
    addEdge(edges, { id: 'edge-review-retry', from: 'review-branch', to: 'main-skill', label: 'needs-revision' });
    addEdge(edges, { id: 'edge-review-state-write', from: 'review-branch', to: 'state-write', label: 'approved' });
  } else {
    addEdge(edges, { id: 'edge-current-state-write', from: currentNodeId, to: 'state-write', label: 'persist-state' });
  }

  addEdge(edges, { id: 'edge-state-write-post-tool', from: 'state-write', to: 'post-tool-use', label: 'state-ready' });
  addEdge(edges, { id: 'edge-post-tool-stop', from: 'post-tool-use', to: 'stop', label: 'complete' });

  const baseGraph = {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    runtimeIntents: [] as RuntimeIntent[],
    skills: [createDefaultSkill(draft, capabilityLabels)]
  } satisfies HarnessFactoryDraftGraphSpec;
  const mergedGraph = mergeHarnessFactoryDraftGraphSpec(baseGraph, draft.graph);
  assertGraphIntegrity(mergedGraph);

  return {
    ...mergedGraph,
    summary: [
      `Draft graph synthesized for ${draft.name}`,
      `Capabilities: ${summarizeHarnessCapabilities(capabilityIds)}`,
      ...(draft.referencePatterns.length > 0 ? [`Reference patterns attached: ${draft.referencePatterns.length}`] : [])
    ]
  };
}
