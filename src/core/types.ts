export type HookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop';

export type RuntimeTarget = 'claude-code' | 'opencode' | 'codex';

export type NodeKind =
  | HookEvent
  | 'Skill'
  | 'Agent'
  | 'Condition'
  | 'Loop'
  | 'StateRead'
  | 'StateWrite'
  | 'MCPServer'
  | 'SystemPrompt'
  | 'Permission'
  | 'Merge'
  | 'Sequence'
  | 'CustomBlock';

export interface PortSpec {
  id: string;
  label: string;
  direction: 'input' | 'output';
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  config?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface SkillFile {
  id: string;
  name: string;
  description: string;
  content: string;
  path?: string;
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

export interface HarnessManifest {
  schemaVersion?: string;
  name: string;
  version: string;
  description: string;
  targetRuntime: RuntimeTarget;
  createdAt: string;
  prompt: string;
}

export interface ConfirmationRequest {
  id: string;
  kind: 'risk-bearing-permission' | 'safety-policy-change' | 'destructive-runtime';
  reason: string;
  message: string;
  confirmed: boolean;
}

export interface CompositeInstance {
  id: string;
  patternId: string;
  label: string;
  expandedNodeIds: string[];
}

export interface CustomBlockDefinition {
  id: string;
  label: string;
  description: string;
  opaque: true;
  ports: PortSpec[];
}

export interface AuthoringDecision {
  summary: string;
  warnings: string[];
  confirmationRequests: ConfirmationRequest[];
  compatibleRuntimes: RuntimeTarget[];
  traceIntent: string[];
}

export interface RegistrySnapshot {
  blocks: RegistryBlock[];
  composites: CompositePattern[];
}

export interface HarnessProject {
  manifest: HarnessManifest;
  nodes: GraphNode[];
  edges: GraphEdge[];
  skills: SkillFile[];
  layout: LayoutNode[];
  composites: CompositeInstance[];
  customBlocks: CustomBlockDefinition[];
  registry: RegistrySnapshot;
  authoring: AuthoringDecision;
}

export interface RegistryBlock {
  kind: NodeKind;
  description: string;
  category: RegistryCategory;
  ports: PortSpec[];
  compatibleRuntimes: RuntimeTarget[];
}

export interface CompositePattern {
  id: string;
  name: string;
  description: string;
  includes: NodeKind[];
  intentKinds?: RuntimeIntentKind[];
}

export interface CompileResult {
  outDir: string;
  pluginRoot: string;
  generatedFiles: string[];
}

export interface TraceEvent {
  timestamp: string;
  hook: string;
  nodeId: string;
  status: 'ok' | 'error';
  message: string;
  eventType:
    | 'hook-activation'
    | 'branch-selection'
    | 'state-transition'
    | 'loop-iteration'
    | 'custom-block'
    | 'failure'
    | 'mcp-server';
  metadata?: Record<string, unknown>;
}

export interface SandboxRunResult {
  sandboxDir: string;
  installDir: string;
  traceFile: string;
  htmlReport: string;
  events: TraceEvent[];
  success: boolean;
  failure?: TraceEvent;
}
