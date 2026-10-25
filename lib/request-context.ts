import { AsyncLocalStorage } from "node:async_hooks";

export interface HttpAttemptTiming {
  attempt: number;
  phase: "initial_review" | "schema_correction";
  duration_ms: number;
  status?: number;
  outcome: "success" | "transient_retry" | "timeout" | "aborted" | "rate_limited" | "error";
  error_reason?: string;
  backoff_ms?: number;
}

/**
 * Collects server-side timing and diagnostics during an interactive review.
 * Tracks per-attempt HTTP durations, retry reasons, schema correction retries,
 * and remaining deadline budget without logging sensitive user data.
 */
export class ReviewDiagnosticsCollector {
  readonly startTime: number;
  readonly overallDeadlineMs: number;
  readonly httpAttempts: HttpAttemptTiming[] = [];
  schemaValidationRetries: number = 0;
  activePhase: "initial_review" | "schema_correction" = "initial_review";

  constructor(overallDeadlineMs: number = 90000) {
    this.startTime = Date.now();
    this.overallDeadlineMs = overallDeadlineMs;
  }

  get elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  get remainingMs(): number {
    return Math.max(0, this.overallDeadlineMs - this.elapsedMs);
  }

  recordAttempt(timing: HttpAttemptTiming): void {
    this.httpAttempts.push(timing);
  }
}

/**
 * Ambient request context storing an AbortController for active web reviews.
 * Allows the 90-second overall deadline to actively abort underlying Gemini fetches
 * without breaking signatures of existing callers or spies.
 */
export const reviewAbortContext = new AsyncLocalStorage<AbortController>();

/**
 * Ambient diagnostics context collecting per-attempt timing, retries, and schema corrections.
 */
export const reviewDiagnosticsContext = new AsyncLocalStorage<ReviewDiagnosticsCollector>();
