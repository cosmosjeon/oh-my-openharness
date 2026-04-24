export interface HookPayload extends Record<string, unknown> {
  hook_event_name?: unknown;
}

export interface HookParseSuccess {
  ok: true;
  payload: HookPayload;
  rawPayloadPreview: string;
}

export interface HookParseFailure {
  ok: false;
  error: {
    message: string;
    rawPayloadPreview: string;
  };
}

export type HookParseResult = HookParseSuccess | HookParseFailure;

const MAX_PREVIEW_LENGTH = 240;

export function rawPayloadPreview(raw: string): string {
  return raw.length > MAX_PREVIEW_LENGTH ? `${raw.slice(0, MAX_PREVIEW_LENGTH)}…` : raw;
}

export function parseHookStdin(raw: string): HookParseResult {
  const preview = rawPayloadPreview(raw);
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: { message: 'Hook stdin must be a JSON object.', rawPayloadPreview: preview } };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: { message: 'Hook stdin must parse to a JSON object.', rawPayloadPreview: preview } };
    }
    return { ok: true, payload: parsed as HookPayload, rawPayloadPreview: preview };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { message: `Invalid hook JSON: ${message}`, rawPayloadPreview: preview } };
  }
}

export function stringifyHookOutput(output: unknown): string {
  return `${JSON.stringify(output, null, 2)}\n`;
}
