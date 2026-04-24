import { listReferencePatterns, normalizeReferenceTerm, tokenizeReferenceTerms, type ReferencePattern } from './catalog';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'build',
  'create',
  'for',
  'harness',
  'i',
  'in',
  'like',
  'make',
  'me',
  'my',
  'need',
  'of',
  'or',
  'the',
  'to',
  'want',
  'with'
]);

export interface ReferenceSearchRequest {
  query?: string;
  capabilities?: string[];
  limit?: number;
}

export interface ReferencePatternMatch {
  pattern: ReferencePattern;
  score: number;
  matchedCapabilities: string[];
  matchedKeywords: string[];
  matchedBlockKinds: string[];
}

export function searchReferencePatterns(request: string | string[] | ReferenceSearchRequest): ReferencePatternMatch[] {
  const normalizedRequest = normalizeRequest(request);
  const capabilityTerms = uniqueTerms((normalizedRequest.capabilities ?? []).flatMap((capability) => tokenizeReferenceTerms(capability)));
  const queryTerms = uniqueTerms(tokenizeReferenceTerms(normalizedRequest.query ?? '').filter((term) => !STOP_WORDS.has(term)));
  const limit = clampLimit(normalizedRequest.limit);

  if (capabilityTerms.length === 0 && queryTerms.length === 0) return [];

  return listReferencePatterns()
    .map((pattern) => scorePattern(pattern, capabilityTerms, queryTerms))
    .filter((match): match is ReferencePatternMatch => match !== undefined)
    .sort((left, right) => right.score - left.score || left.pattern.name.localeCompare(right.pattern.name))
    .slice(0, limit);
}

export function searchReferencePatternsByCapability(capability: string, limit = 3): ReferencePatternMatch[] {
  return searchReferencePatterns({ capabilities: [capability], limit });
}

function scorePattern(pattern: ReferencePattern, capabilityTerms: string[], queryTerms: string[]): ReferencePatternMatch | undefined {
  let score = 0;
  const matchedCapabilities = new Set<string>();
  const matchedKeywords = new Set<string>();
  const matchedBlockKinds = new Set<string>();

  const patternCapabilities = new Set(pattern.capabilities.map((capability) => normalizeReferenceTerm(capability)));
  const patternKeywords = new Set(pattern.keywords.map((keyword) => normalizeReferenceTerm(keyword)));
  const patternBlockKinds = new Map(pattern.blockKinds.map((kind) => [normalizeReferenceTerm(kind), kind]));
  const patternNameTerms = new Set(tokenizeReferenceTerms(pattern.name));
  const patternSummaryTerms = new Set(tokenizeReferenceTerms(pattern.summary));
  const patternSourceTerms = new Set(tokenizeReferenceTerms(`${pattern.source.repo} ${pattern.source.provenance}`));

  for (const term of capabilityTerms) {
    if (patternCapabilities.has(term)) {
      score += 12;
      matchedCapabilities.add(term);
      continue;
    }

    if (patternKeywords.has(term)) {
      score += 6;
      matchedKeywords.add(term);
    }
  }

  for (const term of queryTerms) {
    if (patternCapabilities.has(term)) {
      score += 8;
      matchedCapabilities.add(term);
      continue;
    }

    if (patternKeywords.has(term)) {
      score += 4;
      matchedKeywords.add(term);
      continue;
    }

    const matchedBlockKind = patternBlockKinds.get(term);
    if (matchedBlockKind) {
      score += 3;
      matchedBlockKinds.add(matchedBlockKind);
      continue;
    }

    if (patternNameTerms.has(term)) {
      score += 2;
      continue;
    }

    if (patternSummaryTerms.has(term) || patternSourceTerms.has(term)) {
      score += 1;
    }
  }

  if (matchedCapabilities.size > 0 && matchedKeywords.size > 0) score += 2;
  if (score === 0) return undefined;

  return {
    pattern,
    score,
    matchedCapabilities: [...matchedCapabilities],
    matchedKeywords: [...matchedKeywords],
    matchedBlockKinds: [...matchedBlockKinds]
  };
}

function normalizeRequest(request: string | string[] | ReferenceSearchRequest): ReferenceSearchRequest {
  if (typeof request === 'string') return { query: request };
  if (Array.isArray(request)) return { capabilities: request };
  return request;
}

function clampLimit(limit = 3) {
  return Math.max(1, Math.min(limit, 3));
}

function uniqueTerms(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
