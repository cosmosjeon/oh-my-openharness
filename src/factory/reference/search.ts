import type { RuntimeTarget } from '../../core/types';
import { REFERENCE_PATTERN_REGISTRY, type ReferencePatternRecord } from './catalog';

export interface ReferencePatternSearchInput {
  intent?: string;
  capabilities?: string[];
  targetRuntime?: RuntimeTarget;
  limit?: number;
}

export interface ReferencePatternMatch {
  pattern: ReferencePatternRecord;
  score: number;
  why: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(values: string[]): Set<string> {
  return new Set(values.map(normalize).filter(Boolean));
}

export function findReferencePatterns(input: ReferencePatternSearchInput): ReferencePatternMatch[] {
  const intent = normalize(input.intent ?? '');
  const requested = tokenize(input.capabilities ?? []);
  const limit = input.limit ?? 3;

  return REFERENCE_PATTERN_REGISTRY.map((pattern) => {
    let score = 0;
    const reasons: string[] = [];

    for (const capability of pattern.capabilities) {
      if (requested.has(normalize(capability))) {
        score += 4;
        reasons.push(`capability:${capability}`);
      }
    }

    if (requested.has(pattern.category)) {
      score += 5;
      reasons.push(`category:${pattern.category}`);
    }

    for (const keyword of pattern.intentKeywords) {
      if (intent.includes(normalize(keyword))) {
        score += 2;
        reasons.push(`keyword:${keyword}`);
      }
    }

    if (input.targetRuntime && pattern.runtimeTargets.includes(input.targetRuntime)) {
      score += 1;
      reasons.push(`runtime:${input.targetRuntime}`);
    }

    return {
      pattern,
      score,
      why: reasons.length > 0 ? reasons.join(', ') : 'fallback: seeded reference pattern'
    };
  })
    .filter((match) => match.score > 0 || requested.size === 0 && intent.length === 0)
    .sort((a, b) => b.score - a.score || a.pattern.id.localeCompare(b.pattern.id))
    .slice(0, limit);
}

export function referenceSelectionsForCapabilities(input: ReferencePatternSearchInput) {
  return findReferencePatterns(input).map((match) => ({
    id: match.pattern.id,
    sourceRepo: match.pattern.sourceRepos[0]?.repo ?? 'unknown',
    why: match.why,
    score: match.score
  }));
}
