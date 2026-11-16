import { AsyncLocalStorage } from "node:async_hooks";

export type AttemptOutcome =
  | "success"
  | "429"
  | "503"
  | "timeout"
  | "network_error"
  | "validation_error"
  | "transient_retry"
  | "aborted"
  | "error";

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thinkingTokenCount?: number;
}

export interface HttpAttemptTiming {
  attempt: number;
  model: string;
  phase: "initial_review" | "schema_correction";
  duration_ms: number;
  remaining_budget_ms?: number;
  status?: number;
  outcome: AttemptOutcome;
  error_reason?: string;
  backoff_ms?: number;
  retry_skipped_insufficient_time?: boolean;
  finish_reason?: string;
  usage?: GeminiUsageMetadata;
  resolved_thinking_level?: string;
  thinking_config_present?: boolean;
  max_output_tokens?: number | "unset";
  system_prompt_length?: number;
  user_prompt_length?: number;
}

/**
 * Collects server-side timing and diagnostics during an interactive review.
 * Tracks per-attempt HTTP durations, retry reasons, schema correction retries,
 * and remaining deadline budget without logging sensitive user data.
 */
export class ReviewDiagnosticsCollector {
  readonly startTime: number;
  readonly overallDeadlineMs: number;
  model: string;
  readonly httpAttempts: HttpAttemptTiming[] = [];
  schemaValidationRetries: number = 0;
  activePhase: "initial_review" | "schema_correction" = "initial_review";
  retrySkippedDueToInsufficientTime: boolean = false;
  rateLimitCheckMs?: number;

  constructor(overallDeadlineMs: number = 90000, model: string = "unknown") {
    this.startTime = Date.now();
    this.overallDeadlineMs = overallDeadlineMs;
    this.model = model;
  }

  get elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  get remainingMs(): number {
    return Math.max(0, this.overallDeadlineMs - this.elapsedMs);
  }

  get geminiTotalMs(): number {
    return this.httpAttempts.reduce((sum, att) => sum + (att.duration_ms || 0), 0);
  }

  get latestUsage(): GeminiUsageMetadata | undefined {
    for (let i = this.httpAttempts.length - 1; i >= 0; i--) {
      if (this.httpAttempts[i].usage) {
        return this.httpAttempts[i].usage;
      }
    }
    return undefined;
  }

  get latestFinishReason(): string | undefined {
    for (let i = this.httpAttempts.length - 1; i >= 0; i--) {
      if (this.httpAttempts[i].finish_reason) {
        return this.httpAttempts[i].finish_reason;
      }
    }
    return undefined;
  }

  recordAttempt(timing: HttpAttemptTiming): void {
    this.httpAttempts.push(timing);
  }
}

/**
 * Ambient request context storing an AbortController for active web reviews.
 * Allows the overall deadline to actively abort underlying Gemini fetches
 * without breaking signatures of existing callers or spies.
 */
export const reviewAbortContext = new AsyncLocalStorage<AbortController>();

/**
 * Ambient diagnostics context collecting per-attempt timing, retries, and schema corrections.
 */
export const reviewDiagnosticsContext = new AsyncLocalStorage<ReviewDiagnosticsCollector>();
