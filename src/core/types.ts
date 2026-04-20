export type HookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop';

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
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

export interface HarnessManifest {
  name: string;
  version: string;
  description: string;
  targetRuntime: 'claude-code';
  createdAt: string;
  prompt: string;
}

export interface HarnessProject {
  manifest: HarnessManifest;
  nodes: GraphNode[];
  edges: GraphEdge[];
  skills: SkillFile[];
  layout: LayoutNode[];
}

export interface RegistryBlock {
  kind: NodeKind;
  description: string;
  ports: PortSpec[];
  compatibleRuntimes: Array<'claude-code' | 'opencode' | 'codex'>;
}

export interface CompositePattern {
  id: string;
  name: string;
  description: string;
  includes: NodeKind[];
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
}

export interface SandboxRunResult {
  sandboxDir: string;
  traceFile: string;
  htmlReport: string;
  events: TraceEvent[];
}
