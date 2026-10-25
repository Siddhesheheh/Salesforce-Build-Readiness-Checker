/**
 * Server-side LLM provider integration for Google Gemini API.
 * Never call this from client/browser code.
 */

export class UpstreamApiError extends Error {
  statusCode?: number;
  isQuotaExceeded?: boolean;
  isRateLimited?: boolean;
  rateLimitType?: "per_minute" | "daily_quota" | "unknown";
  retryAfterSeconds?: number | null;

  constructor(
    message: string,
    statusCode?: number,
    details?: { rateLimitType?: "per_minute" | "daily_quota" | "unknown"; retryAfterSeconds?: number | null }
  ) {
    super(message);
    this.name = "UpstreamApiError";
    this.statusCode = statusCode;
    this.rateLimitType = details?.rateLimitType;
    this.retryAfterSeconds = details?.retryAfterSeconds ?? null;
    this.isQuotaExceeded = statusCode === 429 || /quota/i.test(message);
    this.isRateLimited = statusCode === 429;
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string = "Request budget exhausted") {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class RequestBudget {
  readonly maxCalls: number | null;
  private _callsMade: number = 0;

  constructor(maxCalls: number | null = null) {
    if (maxCalls !== null && (!Number.isInteger(maxCalls) || maxCalls <= 0)) {
      throw new Error(`RequestBudget maxCalls must be a positive integer (got ${maxCalls}).`);
    }
    this.maxCalls = maxCalls;
  }

  get callsMade(): number {
    return this._callsMade;
  }

  get remaining(): number | null {
    if (this.maxCalls === null) return null;
    return Math.max(0, this.maxCalls - this._callsMade);
  }

  get isExhausted(): boolean {
    if (this.maxCalls === null) return false;
    return this._callsMade >= this.maxCalls;
  }

  canCall(): boolean {
    return !this.isExhausted;
  }

  recordCall(): void {
    if (this.isExhausted) {
      throw new BudgetExceededError(
        `Request budget exhausted: limit of ${this.maxCalls} call(s) reached.`
      );
    }
    this._callsMade++;
  }
}

export class RequestPacer {
  readonly minIntervalMs: number;
  private lastAttemptTimestamp: number = 0;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(
    minIntervalSeconds: number = 20,
    sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ) {
    this.minIntervalMs = Math.max(0, Math.round(minIntervalSeconds * 1000));
    this.sleepFn = sleepFn;
  }

  async pace(): Promise<number> {
    if (this.lastAttemptTimestamp === 0 || this.minIntervalMs <= 0) {
      this.lastAttemptTimestamp = Date.now();
      return 0;
    }
    const elapsed = Date.now() - this.lastAttemptTimestamp;
    const waitMs = this.minIntervalMs - elapsed;
    if (waitMs > 0) {
      await this.sleepFn(waitMs);
    }
    this.lastAttemptTimestamp = Date.now();
    return Math.max(0, waitMs);
  }

  recordAttempt(): void {
    this.lastAttemptTimestamp = Date.now();
  }
}

export function parseRetryAfter(headerVal: string | null | undefined): number | null {
  if (!headerVal) return null;
  const trimmed = headerVal.trim();
  // 1. Integer seconds (e.g. "5" or "120")
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (!isNaN(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  // 2. HTTP date format (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
  // HTTP dates must contain day-of-week or month letters
  if (/[a-zA-Z]/.test(trimmed)) {
    const dateMs = Date.parse(trimmed);
    if (!isNaN(dateMs)) {
      const delay = dateMs - Date.now();
      return delay > 0 ? delay : 0;
    }
  }
  return null;
}

export function parse429Details(
  message: string,
  headers?: { get(name: string): string | null }
): {
  isRateLimit: boolean;
  rateLimitType: "per_minute" | "daily_quota" | "unknown";
  retryAfterSeconds: number | null;
} {
  let retryAfterSeconds: number | null = null;

  // 1. Check response header
  const headerVal = headers?.get?.("retry-after");
  const headerMs = parseRetryAfter(headerVal);
  if (headerMs !== null) {
    retryAfterSeconds = Math.round(headerMs / 1000);
  }

  // 2. Check message body: e.g. "Please retry in 50.321507239s." or "retry after 30s"
  if (retryAfterSeconds === null) {
    const match =
      message.match(/retry in\s+([0-9.]+)\s*s/i) || message.match(/retry after\s+([0-9.]+)\s*s/i);
    if (match && match[1]) {
      const parsed = parseFloat(match[1]);
      if (!isNaN(parsed) && parsed >= 0) {
        retryAfterSeconds = Number(parsed.toFixed(1));
      }
    }
  }

  const lower = message.toLowerCase();
  const isDaily =
    lower.includes("per day") ||
    lower.includes("requests per day") ||
    lower.includes("daily") ||
    lower.includes("rpd");

  const isPerMinute =
    lower.includes("per minute") ||
    lower.includes("requests per minute") ||
    lower.includes("rpm") ||
    lower.includes("free_tier_requests") ||
    (retryAfterSeconds !== null && retryAfterSeconds <= 120);

  let rateLimitType: "per_minute" | "daily_quota" | "unknown" = "unknown";
  if (isDaily) {
    rateLimitType = "daily_quota";
  } else if (isPerMinute) {
    rateLimitType = "per_minute";
  }

  return {
    isRateLimit: true,
    rateLimitType,
    retryAfterSeconds,
  };
}

export interface CallModelOptions {
  budget?: RequestBudget;
  pacer?: RequestPacer;
  maxTransientRetries?: number; // default: 2 (meaning up to 3 total attempts)
  baseBackoffMs?: number;       // default: 1000
  maxBackoffMs?: number;        // default: 10000
  jitterMs?: number;            // default: 500
  sleepFn?: (ms: number) => Promise<void>;
  timeoutMs?: number;           // default: 30000 (30 seconds per attempt)
  signal?: AbortSignal;
}

export async function callModel(
  system: string,
  user: string,
  options: CallModelOptions = {}
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "gemini-3.8-flash";

  if (!apiKey) {
    throw new UpstreamApiError("GEMINI_API_KEY or LLM_API_KEY is not set in environment.");
  }

  const {
    budget,
    pacer,
    maxTransientRetries = 2,
    baseBackoffMs = 1000,
    maxBackoffMs = 10000,
    jitterMs = 500,
    sleepFn = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 30000,
    signal: externalSignal,
  } = options;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    systemInstruction: {
      parts: [{ text: system }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: user }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  const bodyStr = JSON.stringify(payload);

  for (let attempt = 0; attempt <= maxTransientRetries; attempt++) {
    // 1. Budget check: Never initiate an HTTP attempt that would exceed the budget
    if (budget) {
      if (budget.isExhausted) {
        throw new BudgetExceededError(
          `Request budget exhausted: limit of ${budget.maxCalls} call(s) reached.`
        );
      }
      budget.recordCall();
    }

    // 2. Request pacing: enforce minimum interval before initiating actual HTTP attempt
    if (pacer) {
      await pacer.pace();
    }

    // 3. Setup timeout and abort controller for this specific HTTP attempt
    const attemptController = new AbortController();
    let timeoutTimer: NodeJS.Timeout | null = null;
    let isTimeout = false;

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        isTimeout = true;
        attemptController.abort(new Error(`Gemini API request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    let onExternalAbort: (() => void) | null = null;
    if (externalSignal) {
      if (externalSignal.aborted) {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        throw new UpstreamApiError("Request was aborted before execution.", 499);
      }
      onExternalAbort = () => attemptController.abort(externalSignal.reason);
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: bodyStr,
        signal: attemptController.signal,
      });
    } catch (fetchErr: any) {
      const isAborted = isTimeout || attemptController.signal.aborted || fetchErr?.name === "AbortError";
      const causeMsg = fetchErr?.cause?.code || fetchErr?.cause?.message || "";
      const rawErrMsg = `${fetchErr?.message || "fetch failed"} ${causeMsg}`.trim();
      const sanitizedErr = rawErrMsg.replace(/key=[a-zA-Z0-9_\-]+/gi, "key=[REDACTED]");

      // Check if transient network retry is feasible
      if (attempt < maxTransientRetries) {
        if (budget && budget.isExhausted) {
          throw new UpstreamApiError(
            `Gemini network attempt failed: ${sanitizedErr} (cannot retry: request budget exhausted)`,
            504
          );
        }
        const backoff =
          Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, attempt)) + Math.random() * jitterMs;
        await sleepFn(backoff);
        continue;
      }

      if (isAborted || isTimeout) {
        throw new UpstreamApiError(
          `Gemini API request timed out after ${Math.round(timeoutMs / 1000)}s: ${sanitizedErr}`,
          504
        );
      }

      throw new UpstreamApiError(
        `Gemini API network failure: ${sanitizedErr}`,
        502
      );
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (externalSignal && onExternalAbort) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    }

    if (!response.ok) {
      let errorDetails = "";
      try {
        const errJson = await response.json();
        errorDetails = errJson?.error?.message || JSON.stringify(errJson);
      } catch {
        errorDetails = await response.text();
      }
      const sanitizedError = errorDetails.replace(/key=[a-zA-Z0-9_\-]+/gi, "key=[REDACTED]");

      // Check if 429 rate limit / quota
      if (response.status === 429) {
        const details = parse429Details(sanitizedError, response.headers);
        throw new UpstreamApiError(
          `Gemini API call failed with status 429: ${sanitizedError}`,
          429,
          details
        );
      }

      // Check if transient error (502, 503, 504) and we have retries remaining
      const isTransient = [502, 503, 504].includes(response.status);
      if (isTransient && attempt < maxTransientRetries) {
        // Can we make another attempt within budget?
        if (budget && budget.isExhausted) {
          throw new UpstreamApiError(
            `Gemini API call failed with status ${response.status}: ${sanitizedError} (cannot retry: request budget exhausted)`,
            response.status
          );
        }

        const retryAfterMs = parseRetryAfter(response.headers?.get?.("retry-after"));
        const backoff =
          retryAfterMs !== null
            ? retryAfterMs
            : Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, attempt)) + Math.random() * jitterMs;

        await sleepFn(backoff);
        continue;
      }

      // Non-transient error (401, 403, 500, etc.) or transient retries exhausted
      throw new UpstreamApiError(
        `Gemini API call failed with status ${response.status}: ${sanitizedError}`,
        response.status
      );
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];

    if (!candidate || !candidate.content?.parts?.[0]?.text) {
      const finishReason = candidate?.finishReason || "unknown";
      throw new UpstreamApiError(`Gemini returned empty response (finishReason: ${finishReason})`);
    }

    const rawText = candidate.content.parts[0].text;
    return cleanJsonOutput(rawText);
  }

  throw new UpstreamApiError("Gemini API call failed: transient retries exhausted");
}

function cleanJsonOutput(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```json")) {
    return trimmed.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  }
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return trimmed;
}
