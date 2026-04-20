import type {
  CompositePattern,
  RegistryBlock,
  RegistryCategory,
  RuntimeIntentKind,
  RuntimeTarget,
  SafetyLevel
} from './types';

const DEFAULT_PORTS: RegistryBlock['ports'] = [
  { id: 'in', label: 'In', direction: 'input' },
  { id: 'out', label: 'Out', direction: 'output' }
];

const ALL_RUNTIMES: RuntimeTarget[] = ['claude-code', 'opencode', 'codex'];

type BlockTuple = [
  kind: RegistryBlock['kind'],
  description: string,
  category?: RegistryCategory,
  safety?: SafetyLevel,
  compatibleRuntimes?: RuntimeTarget[],
  supportsCustomConfig?: boolean
];

const BLOCK_TUPLES: BlockTuple[] = [
  ['SessionStart', 'Session start hook', 'hook', 'safe'],
  ['UserPromptSubmit', 'Prompt submit hook', 'hook', 'safe'],
  ['PreToolUse', 'Pre-tool hook', 'hook', 'safe'],
  ['PostToolUse', 'Post-tool hook', 'hook', 'safe'],
  ['Stop', 'Stop hook', 'hook', 'safe'],
  ['Skill', 'Reusable skill content', 'authoring', 'safe'],
  ['Agent', 'Sub-agent delegation', 'authoring', 'safe'],
  ['Condition', 'Conditional routing', 'control-flow', 'safe'],
  ['Loop', 'Retry or iteration loop', 'control-flow', 'safe'],
  ['StateRead', 'Read persisted state', 'state', 'safe'],
  ['StateWrite', 'Write persisted state', 'state', 'safe'],
  ['MCPServer', 'MCP registration or usage', 'runtime', 'confirm'],
  ['SystemPrompt', 'System prompt injection', 'authoring', 'safe'],
  ['Permission', 'Permission gate', 'safety', 'confirm'],
  ['Merge', 'Branch merge', 'control-flow', 'safe'],
  ['Sequence', 'Linear orchestration', 'control-flow', 'safe'],
  ['CustomBlock', 'Opaque generated logic block', 'runtime', 'confirm', ALL_RUNTIMES, true]
];

export const BLOCK_REGISTRY: RegistryBlock[] = BLOCK_TUPLES.map(
  ([kind, description, category = 'authoring', safety = 'safe', compatibleRuntimes = ALL_RUNTIMES, supportsCustomConfig = false]) => ({
    kind,
    description,
    category,
    safety,
    ports: DEFAULT_PORTS.map((port) => ({ ...port })),
    compatibleRuntimes,
    supportsCustomConfig
  })
);

export const HOOK_BLOCK_KINDS = BLOCK_REGISTRY.filter((block) => block.category === 'hook').map((block) => block.kind);

const INTENT_KINDS = {
  permissionGate: ['mcp-server'] satisfies RuntimeIntentKind[],
  reviewLoop: ['hook'] satisfies RuntimeIntentKind[],
  sessionInitBundle: ['hook', 'state'] satisfies RuntimeIntentKind[],
  ralphLoop: ['hook', 'state'] satisfies RuntimeIntentKind[],
  subagentDelegation: ['hook'] satisfies RuntimeIntentKind[],
  mcpRegistration: ['mcp-server'] satisfies RuntimeIntentKind[]
};

export const COMPOSITE_PATTERNS: CompositePattern[] = [
  { id: 'permission-gate', name: 'Permission Gate', description: 'Risky operations require explicit review', includes: ['Permission', 'Condition', 'Sequence'], intentKinds: INTENT_KINDS.permissionGate },
  { id: 'review-loop', name: 'Review Loop', description: 'Generate, review, and retry until good enough', includes: ['Skill', 'Loop', 'Condition'], intentKinds: INTENT_KINDS.reviewLoop },
  { id: 'session-init-bundle', name: 'Session Init Bundle', description: 'Initialize prompts, state, and memory at session start', includes: ['SessionStart', 'SystemPrompt', 'StateWrite'], intentKinds: INTENT_KINDS.sessionInitBundle },
  { id: 'ralph-loop', name: 'Ralph Loop', description: 'Persistent verify-fix loop', includes: ['Loop', 'Condition', 'Skill'], intentKinds: INTENT_KINDS.ralphLoop },
  { id: 'subagent-delegation', name: 'Subagent Delegation', description: 'Delegate to agents then merge results', includes: ['Agent', 'Merge', 'Sequence'], intentKinds: INTENT_KINDS.subagentDelegation },
  { id: 'mcp-registration', name: '3-Tier MCP Registration', description: 'Attach MCP server and gate its usage', includes: ['MCPServer', 'Permission', 'Sequence'], intentKinds: INTENT_KINDS.mcpRegistration }
];

export function createRegistrySnapshot() {
  return {
    blocks: BLOCK_REGISTRY.map((block) => ({ ...block, ports: block.ports.map((port) => ({ ...port })), compatibleRuntimes: [...block.compatibleRuntimes] })),
    composites: COMPOSITE_PATTERNS.map((pattern) => ({ ...pattern, includes: [...pattern.includes], intentKinds: pattern.intentKinds ? [...pattern.intentKinds] : undefined }))
  };
}
