export type HookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop';

export type RuntimeTarget = 'claude-code' | 'opencode' | 'codex';
export type RegistryCategory = 'hook' | 'authoring' | 'control-flow' | 'state' | 'runtime' | 'safety';
export type SafetyLevel = 'safe' | 'confirm';
export type RuntimeIntentKind = 'hook' | 'mcp-server' | 'state' | 'custom-runtime';

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
  supportedRuntimes?: RuntimeTarget[];
  createdAt: string;
  prompt: string;
  graphHash?: string;
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
  runtimeTargets?: RuntimeTarget[];
}

export interface AuthoringDecision {
  summary: string;
  warnings: string[];
  confirmationRequests: ConfirmationRequest[];
  compatibleRuntimes: RuntimeTarget[];
  traceIntent: TraceEvent['eventType'][];
}

export interface RegistryBlock {
  kind: NodeKind;
  description: string;
  category: RegistryCategory;
  safety: SafetyLevel;
  ports: PortSpec[];
  compatibleRuntimes: RuntimeTarget[];
  supportsCustomConfig?: boolean;
}

export interface CompositePattern {
  id: string;
  name: string;
  description: string;
  includes: NodeKind[];
  intentKinds?: RuntimeIntentKind[];
}

export interface RegistrySnapshot {
  blocks: RegistryBlock[];
  composites: CompositePattern[];
}

export interface RuntimeIntent {
  id: string;
  kind: RuntimeIntentKind;
  label: string;
  targetRuntime: RuntimeTarget;
  sourceNodeIds: string[];
  transport?: 'stdio' | 'in-memory';
  safety: SafetyLevel;
}

export interface HostAuthoringNodeUpdate {
  id: string;
  kind?: NodeKind;
  label?: string;
  config?: Record<string, unknown>;
}

export interface HostAuthoringEdgeUpdate {
  id: string;
  from?: string;
  to?: string;
  label?: string;
}

export interface HostAuthoringRuntimeIntentUpdate {
  id: string;
  kind?: RuntimeIntentKind;
  label?: string;
  targetRuntime?: RuntimeTarget;
  sourceNodeIds?: string[];
  transport?: 'stdio' | 'in-memory';
  safety?: SafetyLevel;
}

export interface HostAuthoringSkillUpdate {
  id?: string;
  name?: string;
  description?: string;
  content?: string;
  appendContent?: string;
}

export interface HostAuthoringGraphDelta {
  manifest?: {
    description?: string;
  };
  nodes?: {
    add?: GraphNode[];
    update?: HostAuthoringNodeUpdate[];
    remove?: string[];
  };
  edges?: {
    add?: GraphEdge[];
    update?: HostAuthoringEdgeUpdate[];
    remove?: string[];
  };
  runtimeIntents?: {
    add?: RuntimeIntent[];
    update?: HostAuthoringRuntimeIntentUpdate[];
    remove?: string[];
  };
  skills?: {
    add?: SkillFile[];
    update?: HostAuthoringSkillUpdate[];
    remove?: string[];
  };
}

export interface HostAuthoringPayload {
  summary: string;
  emphasis: string[];
  warnings: string[];
  graphDelta?: HostAuthoringGraphDelta;
}

export type SetupRuntime = 'claude' | 'opencode' | 'codex';
export type SetupProvenanceType = 'extracted' | 'adapted' | 'novel';
export type SetupSupportLevel = 'supported' | 'scaffold';

export interface SetupChange {
  runtime: SetupRuntime;
  path: string;
  kind: 'mkdir' | 'write';
  risk: 'safe' | 'risky';
  reason: string;
}

export interface RuntimeCapabilityMatrixEntry {
  runtime: SetupRuntime;
  displayName: string;
  supportLevel: SetupSupportLevel;
  binaryCandidates: string[];
  binaryDetected: boolean;
  binaryPath?: string;
  configEnvVar: string;
  configRoot: string;
  installRoot: string;
  installSurface: string[];
  mutationSurface: string[];
  approvalSemantics: string;
  rollbackBehavior: string[];
  proofMethod: string;
  provenanceType: SetupProvenanceType;
  evidenceFiles: string[];
  installStatus: 'configured' | 'scaffolded' | 'ready-to-apply' | 'missing-binary' | 'planned';
}

export interface RuntimeSetupPlan {
  productName: string;
  selectedRuntimes: SetupRuntime[];
  capabilityMatrix: RuntimeCapabilityMatrixEntry[];
  safeReads: string[];
  riskyWrites: SetupChange[];
  approvalRequired: boolean;
  approvalMode: 'summary' | 'none';
  summary: string;
}

export interface SetupApplyResult {
  productName: string;
  selectedRuntimes: SetupRuntime[];
  capabilityMatrix: RuntimeCapabilityMatrixEntry[];
  appliedWrites: SetupChange[];
  approvalRequired: boolean;
  approvalMode: 'summary' | 'none';
  summary: string;
}

export interface RuntimeDoctorCheck {
  status: 'ok' | 'warning' | 'error';
  details: string[];
}

export interface RuntimeDoctorEntry {
  runtime: SetupRuntime;
  displayName: string;
  supportLevel: SetupSupportLevel;
  binaryDetected: boolean;
  binaryPath?: string;
  configRoot: string;
  installRoot: string;
  installShape: RuntimeDoctorCheck;
  hostReadiness: RuntimeDoctorCheck;
  suggestedNextCommand: string;
}

export interface RuntimeDoctorReport {
  productName: string;
  bun: {
    available: boolean;
    version?: string;
  };
  selectedRuntimes: SetupRuntime[];
  runtimes: RuntimeDoctorEntry[];
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
  runtimeIntents?: RuntimeIntent[];
}

export interface CompileResult {
  outDir: string;
  pluginRoot: string;
  runtime: RuntimeTarget;
  traceSchemaPath: string;
  validationManifestPath: string;
  exportManifestPath: string;
  generatedFiles: string[];
}

export interface RuntimeValidationStep {
  hook: string;
  command: string;
  args?: string[];
  nodeId: string;
}

export interface RuntimeValidationManifest {
  runtime: RuntimeTarget;
  runtimeRoot: string;
  traceSchemaPath: string;
  steps: RuntimeValidationStep[];
  mcpServers?: Array<{ name: string; command: string; args?: string[]; nodeId: string }>;
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
  validation?: {
    manifest: RuntimeValidationManifest;
    traceSchema: {
      version: number;
      eventTypes: ReadonlyArray<TraceEvent['eventType']>;
      requiredFields: ReadonlyArray<keyof TraceEvent>;
      requiredMetadata: ReadonlyArray<string>;
      expectedEventTypes?: ReadonlyArray<TraceEvent['eventType']>;
    };
    eventTypeCounts: Partial<Record<TraceEvent['eventType'], number>>;
    missingEventTypes: TraceEvent['eventType'][];
    violations: string[];
  };
}
