import { fetchTrace } from './api';
import type { TracePayload } from './trace';

export interface TraceStreamFallbackController {
  pollMs?: number;
  onTrace(payload: TracePayload): void;
  onError(error: Error): void;
}

export function startTracePollingFallback({ pollMs = 2_000, onTrace, onError }: TraceStreamFallbackController): () => void {
  let stopped = false;

  const poll = () => {
    fetchTrace()
      .then((payload) => {
        if (!stopped) onTrace(payload);
      })
      .catch((error) => {
        if (!stopped) onError(error instanceof Error ? error : new Error(String(error)));
      });
  };

  poll();
  const interval = window.setInterval(poll, pollMs);
  return () => {
    stopped = true;
    window.clearInterval(interval);
  };
}
