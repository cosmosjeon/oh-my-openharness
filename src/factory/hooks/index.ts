import type { HarnessFactoryQuestion, HarnessFactoryState } from '../state';
import { isReadyToDraft, nextQuestion } from '../interview';

export type FactoryPromptRoute = 'ask-question' | 'draft' | 'build' | 'preview' | 'verify' | 'export';

export interface FactoryPromptRouteResult {
  route: FactoryPromptRoute;
  reason: string;
  question?: HarnessFactoryQuestion;
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

/**
 * Pure Phase D seam for future runtime hooks.
 *
 * This intentionally does not execute CLI actions or mutate state. Hook scripts can
 * call it from UserPromptSubmit to decide whether the next conversational turn
 * should ask another interview question or hand off to existing Factory actions.
 */
export function routeFactoryPrompt(state: HarnessFactoryState, userPrompt: string): FactoryPromptRouteResult {
  const normalized = userPrompt.trim().toLowerCase();
  const question = nextQuestion(state);

  if (includesAny(normalized, ['verify', 'sandbox', '검증', '테스트'])) {
    return { route: 'verify', reason: 'User asked to verify or sandbox the current harness draft.' };
  }

  if (includesAny(normalized, ['export', 'bundle', '내보내기'])) {
    return { route: 'export', reason: 'User asked to export the canonical project into runtime artifacts.' };
  }

  if (includesAny(normalized, ['preview', 'show me', 'open editor', 'editor', '브라우저', '보여'])) {
    return { route: 'preview', reason: 'User asked to inspect the draft through the preview/editor surface.' };
  }

  if (includesAny(normalized, ['build', 'materialize', 'create project', 'go ahead', '생성', '만들어'])) {
    if (isReadyToDraft(state)) return { route: 'build', reason: 'User asked to build and the interview is ready.' };
    return {
      route: 'ask-question',
      reason: 'User asked to build, but the interview still has missing decisions.',
      ...(question ? { question } : {})
    };
  }

  if (isReadyToDraft(state)) return { route: 'draft', reason: 'Interview decisions are complete enough to synthesize a draft.' };
  return {
    route: 'ask-question',
    reason: 'The factory needs the next focused interview answer before drafting.',
    ...(question ? { question } : {})
  };
}
