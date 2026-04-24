import type { BuiltinHarnessCapabilityId, HarnessFactoryDraftSpec, HarnessFactoryReferencePattern } from './draft-spec';

export interface HarnessFactoryCapabilityDefinition {
  id: BuiltinHarnessCapabilityId;
  label: string;
  description: string;
  keywords: string[];
}

export const HARNESS_FACTORY_CAPABILITIES: HarnessFactoryCapabilityDefinition[] = [
  {
    id: 'approval-gate',
    label: 'Approval Gate',
    description: 'Require an explicit approval branch before risky or build-bearing work continues.',
    keywords: ['approval', 'approve', 'permission', 'gate', 'review before', 'confirm']
  },
  {
    id: 'state-memory',
    label: 'State Memory',
    description: 'Persist and restore conversation or harness state between interactions.',
    keywords: ['state', 'memory', 'persist', 'checkpoint', 'restore']
  },
  {
    id: 'mcp-server',
    label: 'MCP Server',
    description: 'Attach MCP server registration or MCP-backed tool usage to the generated harness.',
    keywords: ['mcp', 'server', 'tooling', 'tools']
  },
  {
    id: 'review-loop',
    label: 'Review Loop',
    description: 'Iterate until review or verification criteria are satisfied.',
    keywords: ['review loop', 'retry', 'loop', 'iterate', 'review', 'verify']
  },
  {
    id: 'subagent-delegation',
    label: 'Subagent Delegation',
    description: 'Delegate bounded work to agents, then merge the results back into the main flow.',
    keywords: ['subagent', 'delegate', 'delegation', 'agent', 'parallel']
  }
];

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function matchCapabilityId(value: string): BuiltinHarnessCapabilityId | undefined {
  const normalized = normalizeToken(value);
  if (!normalized) return undefined;

  const exact = HARNESS_FACTORY_CAPABILITIES.find((capability) => capability.id === normalized);
  if (exact) return exact.id;

  return HARNESS_FACTORY_CAPABILITIES.find((capability) => capability.keywords.some((keyword) => normalized.includes(keyword)))?.id;
}

function textsFromReferencePatterns(referencePatterns: HarnessFactoryReferencePattern[]): string[] {
  return referencePatterns.flatMap((pattern) => [pattern.id, pattern.capability ?? '', pattern.why, pattern.sourceRepo]);
}

export function describeHarnessFactoryCapability(capabilityId: BuiltinHarnessCapabilityId): HarnessFactoryCapabilityDefinition {
  const capability = HARNESS_FACTORY_CAPABILITIES.find((entry) => entry.id === capabilityId);
  if (!capability) throw new Error(`Unknown harness factory capability: ${capabilityId}`);
  return capability;
}

export function inferBuiltinHarnessCapabilities(input: {
  userIntent: string;
  requestedCapabilities?: string[];
  referencePatterns?: HarnessFactoryReferencePattern[];
}): BuiltinHarnessCapabilityId[] {
  const detected = new Set<BuiltinHarnessCapabilityId>();
  const searchSpace = [
    input.userIntent,
    ...(input.requestedCapabilities ?? []),
    ...textsFromReferencePatterns(input.referencePatterns ?? [])
  ];

  for (const value of searchSpace) {
    const match = matchCapabilityId(value);
    if (match) detected.add(match);
  }

  return HARNESS_FACTORY_CAPABILITIES.map((capability) => capability.id).filter((capabilityId) => detected.has(capabilityId));
}

export function resolveBuiltinHarnessCapabilities(draft: HarnessFactoryDraftSpec): BuiltinHarnessCapabilityId[] {
  const resolved = new Set<BuiltinHarnessCapabilityId>();

  for (const capability of draft.capabilities) {
    const match = matchCapabilityId(capability.id) ?? matchCapabilityId(capability.label);
    if (match) resolved.add(match);
  }

  for (const capabilityId of inferBuiltinHarnessCapabilities({
    userIntent: draft.prompt,
    requestedCapabilities: draft.requestedCapabilities,
    referencePatterns: draft.referencePatterns
  })) {
    resolved.add(capabilityId);
  }

  return HARNESS_FACTORY_CAPABILITIES.map((capability) => capability.id).filter((capabilityId) => resolved.has(capabilityId));
}

export function summarizeHarnessCapabilities(capabilityIds: BuiltinHarnessCapabilityId[]): string {
  if (capabilityIds.length === 0) return 'baseline harness flow';
  return capabilityIds.map((capabilityId) => describeHarnessFactoryCapability(capabilityId).label).join(', ');
}
