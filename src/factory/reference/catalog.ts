import patternRegistryJson from './pattern-registry.json' with { type: 'json' };
import type { NodeKind, RuntimeTarget } from '../../core/types';

export type ReferencePatternCategory = 'approval-gate' | 'review-loop' | 'mcp-registration' | 'state-persistence' | 'retry-loop' | 'subagent-delegation';
export type ReferenceExtractionMode = 'manual-seed' | 'extractor';

export interface ReferencePatternSource {
  repo: string;
  paths: string[];
  summary: string;
}

export interface ReferencePatternRecord {
  id: string;
  name: string;
  category: ReferencePatternCategory;
  summary: string;
  sourceRepos: ReferencePatternSource[];
  capabilities: string[];
  intentKeywords: string[];
  runtimeTargets: RuntimeTarget[];
  primitives: NodeKind[];
  extraction: { mode: ReferenceExtractionMode; extractor?: string; notes: string };
  applicability: { whenToUse: string; risks: string[]; followUpQuestions: string[] };
}

const CATEGORIES = new Set<ReferencePatternCategory>(['approval-gate', 'review-loop', 'mcp-registration', 'state-persistence', 'retry-loop', 'subagent-delegation']);
const RUNTIMES = new Set<RuntimeTarget>(['claude-code', 'opencode', 'codex']);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateReferencePattern(pattern: ReferencePatternRecord): ReferencePatternRecord {
  assert(typeof pattern.id === 'string' && pattern.id.length > 0, 'Reference pattern id is required.');
  assert(typeof pattern.name === 'string' && pattern.name.length > 0, `Reference pattern ${pattern.id} name is required.`);
  assert(CATEGORIES.has(pattern.category), `Reference pattern ${pattern.id} category is invalid.`);
  assert(pattern.sourceRepos.length > 0, `Reference pattern ${pattern.id} must include source repo provenance.`);
  assert(pattern.capabilities.length > 0, `Reference pattern ${pattern.id} must include capabilities.`);
  assert(pattern.intentKeywords.length > 0, `Reference pattern ${pattern.id} must include intent keywords.`);
  assert(pattern.runtimeTargets.every((runtime) => RUNTIMES.has(runtime)), `Reference pattern ${pattern.id} has invalid runtime targets.`);
  assert(pattern.primitives.length > 0, `Reference pattern ${pattern.id} must include primitives.`);
  return pattern;
}

export function loadReferencePatternRegistry(): ReferencePatternRecord[] {
  const patterns = patternRegistryJson as ReferencePatternRecord[];
  const ids = new Set<string>();
  return patterns.map((pattern) => {
    const valid = validateReferencePattern(pattern);
    assert(!ids.has(valid.id), `Duplicate reference pattern id ${valid.id}.`);
    ids.add(valid.id);
    return valid;
  });
}

export const REFERENCE_PATTERN_REGISTRY = loadReferencePatternRegistry();

export function getReferencePattern(id: string): ReferencePatternRecord | undefined {
  return REFERENCE_PATTERN_REGISTRY.find((pattern) => pattern.id === id);
}
