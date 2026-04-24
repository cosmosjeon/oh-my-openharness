import { isReadyToDraft, queueNextQuestion } from '../interview';
import { withFactoryStateUpdate, type HarnessFactoryState } from '../state';
import { routeFactoryPrompt, type FactoryPromptRouteResult } from './routing';
import { additionalContextOutput, summarizeFactoryState, type FactoryHookContext, type FactoryHookJsonOutput } from './runtime';

function promptText(context: FactoryHookContext): string {
  return typeof context.payload.prompt === 'string' ? context.payload.prompt : '';
}

function routeIsSafeToExecute(route: FactoryPromptRouteResult, state: HarnessFactoryState): boolean {
  if (route.route === 'draft' || route.route === 'build') return isReadyToDraft(state);
  if (route.route === 'preview' || route.route === 'verify' || route.route === 'export') return Boolean(state.projectPath);
  return false;
}

function routeStatePatch(state: HarnessFactoryState, route: FactoryPromptRouteResult, now: string): HarnessFactoryState {
  if (route.route === 'ask-question') {
    return queueNextQuestion(state, now).state;
  }

  if (route.route === 'draft' || route.route === 'build') {
    return withFactoryStateUpdate(state, { stage: 'drafting' }, now);
  }

  if (route.route === 'preview' && state.projectPath) {
    return withFactoryStateUpdate(state, { stage: 'previewing' }, now);
  }

  if (route.route === 'verify' && state.projectPath) {
    return withFactoryStateUpdate(state, { stage: 'verifying' }, now);
  }

  return state;
}

export async function handleUserPromptSubmitHook(context: FactoryHookContext): Promise<FactoryHookJsonOutput> {
  const state = await context.loadOrCreateState();
  const route = routeFactoryPrompt(state, promptText(context));
  const nextState = routeStatePatch(state, route, context.now);
  const savedState = nextState === state ? state : await context.saveState(nextState);
  const queuedQuestion = route.route === 'ask-question' ? savedState.openQuestions.find((question) => !question.answeredAt) : undefined;
  const question = queuedQuestion ?? route.question;
  const action = {
    route: route.route,
    reason: route.reason,
    safeToExecute: routeIsSafeToExecute(route, savedState),
    ...(question ? { question } : {})
  };
  const summary = summarizeFactoryState(savedState);

  return additionalContextOutput(
    'UserPromptSubmit',
    [
      `Harness Factory routed this prompt to: ${route.route}`,
      `Reason: ${route.reason}`,
      queuedQuestion ? `Ask the user: ${queuedQuestion.question}` : undefined,
      route.route !== 'ask-question' ? 'Do not execute unsafe filesystem actions from the hook; hand off to the existing Factory action layer.' : undefined
    ].filter(Boolean).join('\n'),
    {
      ok: true,
      hook: 'UserPromptSubmit',
      prompt: promptText(context),
      stateRoot: context.stateRoot,
      state: summary,
      action
    }
  );
}
