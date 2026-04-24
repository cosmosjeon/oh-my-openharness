import { routeFactoryPrompt } from './routing';
import { additionalContextOutput, summarizeFactoryState, type FactoryHookContext, type FactoryHookJsonOutput } from './runtime';

export async function handleSessionStartHook(context: FactoryHookContext): Promise<FactoryHookJsonOutput> {
  const state = await context.loadOrCreateState();
  const recommendation = routeFactoryPrompt(state, '');
  const summary = summarizeFactoryState(state);

  return additionalContextOutput(
    'SessionStart',
    [
      'Harness Factory state loaded for this Claude session.',
      `Session: ${summary.sessionId}`,
      `Stage: ${summary.stage}`,
      `Recommended next route: ${recommendation.route}`,
      `Reason: ${recommendation.reason}`,
      recommendation.question ? `Next question: ${recommendation.question.question}` : undefined
    ].filter(Boolean).join('\n'),
    {
      ok: true,
      hook: 'SessionStart',
      stateRoot: context.stateRoot,
      state: summary,
      recommendation
    }
  );
}
