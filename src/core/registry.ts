import type { CompositePattern, RegistryBlock } from './types';

export const BLOCK_REGISTRY: RegistryBlock[] = [
  ['SessionStart', 'Session start hook'],
  ['UserPromptSubmit', 'Prompt submit hook'],
  ['PreToolUse', 'Pre-tool hook'],
  ['PostToolUse', 'Post-tool hook'],
  ['Stop', 'Stop hook'],
  ['Skill', 'Reusable skill content'],
  ['Agent', 'Sub-agent delegation'],
  ['Condition', 'Conditional routing'],
  ['Loop', 'Retry or iteration loop'],
  ['StateRead', 'Read persisted state'],
  ['StateWrite', 'Write persisted state'],
  ['MCPServer', 'MCP registration or usage'],
  ['SystemPrompt', 'System prompt injection'],
  ['Permission', 'Permission gate'],
  ['Merge', 'Branch merge'],
  ['Sequence', 'Linear orchestration'],
  ['CustomBlock', 'Opaque generated logic block']
].map(([kind, description]) => ({
  kind: kind as RegistryBlock['kind'],
  description,
  ports: [
    { id: 'in', label: 'In', direction: 'input' },
    { id: 'out', label: 'Out', direction: 'output' }
  ],
  compatibleRuntimes: ['claude-code', 'opencode', 'codex']
}));

export const COMPOSITE_PATTERNS: CompositePattern[] = [
  {
    id: 'permission-gate',
    name: 'Permission Gate',
    description: 'Risky operations require explicit review',
    includes: ['Permission', 'Condition', 'Sequence']
  },
  {
    id: 'review-loop',
    name: 'Review Loop',
    description: 'Generate, review, and retry until good enough',
    includes: ['Skill', 'Loop', 'Condition']
  },
  {
    id: 'session-init-bundle',
    name: 'Session Init Bundle',
    description: 'Initialize prompts, state, and memory at session start',
    includes: ['SessionStart', 'SystemPrompt', 'StateWrite']
  },
  {
    id: 'ralph-loop',
    name: 'Ralph Loop',
    description: 'Persistent verify-fix loop',
    includes: ['Loop', 'Condition', 'Skill']
  },
  {
    id: 'subagent-delegation',
    name: 'Subagent Delegation',
    description: 'Delegate to agents then merge results',
    includes: ['Agent', 'Merge', 'Sequence']
  },
  {
    id: 'mcp-registration',
    name: '3-Tier MCP Registration',
    description: 'Attach MCP server and gate its usage',
    includes: ['MCPServer', 'Permission', 'Sequence']
  }
];
