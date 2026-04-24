import patternRegistry from './pattern-registry.json' with { type: 'json' };
import type { NodeKind } from '../../core/types';

export interface ReferencePatternSource {
  repo: string;
  relativePath: string;
  provenance: string;
}

export interface ReferencePattern {
  id: string;
  name: string;
  summary: string;
  capabilities: string[];
  keywords: string[];
  blockKinds: NodeKind[];
  source: ReferencePatternSource;
}

const REFERENCE_PATTERNS = (patternRegistry as ReferencePattern[]).map(cloneReferencePattern);

export function normalizeReferenceTerm(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (normalized.endsWith('ies') && normalized.length > 3) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith('s') && normalized.length > 3) return normalized.slice(0, -1);
  return normalized;
}

export function tokenizeReferenceTerms(value: string) {
  return value
    .split(/[^a-zA-Z0-9]+/g)
    .map((token) => normalizeReferenceTerm(token))
    .filter(Boolean);
}

export function listReferencePatterns(): ReferencePattern[] {
  return REFERENCE_PATTERNS.map(cloneReferencePattern);
}

export function getReferencePattern(id: string): ReferencePattern | undefined {
  const normalizedId = normalizeReferenceTerm(id);
  const pattern = REFERENCE_PATTERNS.find((candidate) => normalizeReferenceTerm(candidate.id) === normalizedId);
  return pattern ? cloneReferencePattern(pattern) : undefined;
}

export function listReferenceCapabilities(): string[] {
  return [...new Set(REFERENCE_PATTERNS.flatMap((pattern) => pattern.capabilities.map((capability) => normalizeReferenceTerm(capability))))].sort();
}

function cloneReferencePattern(pattern: ReferencePattern): ReferencePattern {
  return {
    ...pattern,
    capabilities: [...pattern.capabilities],
    keywords: [...pattern.keywords],
    blockKinds: [...pattern.blockKinds],
    source: { ...pattern.source }
  };
}
