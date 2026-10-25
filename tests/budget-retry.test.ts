import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  callModel,
  RequestBudget,
  RequestPacer,
  BudgetExceededError,
  UpstreamApiError,
  parseRetryAfter,
  parse429Details,
} from "../lib/llm";
import { reviewRequirement, ReviewDiagnostics } from "../lib/review";
import { planResumedSampleRuns, analyzeSampleRuns, categorizeError } from "../lib/evaluate";

describe("lib/llm: RequestBudget", () => {
  it("rejects non-positive integers", () => {
    expect(() => new RequestBudget(0)).toThrow(/positive integer/);
    expect(() => new RequestBudget(-5)).toThrow(/positive integer/);
    expect(() => new RequestBudget(1.5)).toThrow(/positive integer/);
  });

  it("initializes correctly with positive integer", () => {
    const b = new RequestBudget(5);
    expect(b.maxCalls).toBe(5);
    expect(b.callsMade).toBe(0);
    expect(b.remaining).toBe(5);
    expect(b.isExhausted).toBe(false);
    expect(b.canCall()).toBe(true);
  });

  it("handles null / unlimited budget", () => {
    const b = new RequestBudget(null);
    expect(b.maxCalls).toBeNull();
    expect(b.remaining).toBeNull();
    expect(b.isExhausted).toBe(false);
    expect(b.canCall()).toBe(true);
    b.recordCall();
    expect(b.callsMade).toBe(1);
    expect(b.isExhausted).toBe(false);
  });

  it("tracks calls and exhausts when limit is reached", () => {
    const b = new RequestBudget(2);
    b.recordCall();
    expect(b.callsMade).toBe(1);
    expect(b.remaining).toBe(1);
    expect(b.isExhausted).toBe(false);

    b.recordCall();
    expect(b.callsMade).toBe(2);
    expect(b.remaining).toBe(0);
    expect(b.isExhausted).toBe(true);
    expect(b.canCall()).toBe(false);

    expect(() => b.recordCall()).toThrow(BudgetExceededError);
  });
});

describe("lib/llm: parseRetryAfter", () => {
  it("parses valid integer seconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("120")).toBe(120000);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("parses valid HTTP-date format", () => {
    const futureDate = new Date(Date.now() + 15000).toUTCString();
    const parsed = parseRetryAfter(futureDate);
    expect(parsed).not.toBeNull();
    expect(parsed).toBeGreaterThan(10000);
    expect(parsed).toBeLessThanOrEqual(16000);
  });

  it("returns null for missing, empty, or invalid values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("invalid-format")).toBeNull();
    expect(parseRetryAfter("-5")).toBeNull();
  });
});

describe("lib/llm: callModel with RequestBudget & Transient Retries", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = "test-key";
    process.env.LLM_MODEL = "gemini-3.8-flash";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("enforces budget: stops and throws BudgetExceededError when budget is exhausted without calling fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"summary":"test"}' }] } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const budget = new RequestBudget(1);

    // Call 1: Uses the only allowed call
    const res1 = await callModel("sys", "user", { budget });
    expect(res1).toBe('{"summary":"test"}');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(budget.callsMade).toBe(1);
    expect(budget.isExhausted).toBe(true);

    // Call 2: Budget exhausted -> throws without initiating HTTP attempt
    await expect(callModel("sys", "user", { budget })).rejects.toThrow(BudgetExceededError);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Still exactly 1, no second call initiated
  });

  it("recovers from HTTP 503 on retry and increments budget for each attempt", async () => {
    let attempts = 0;
    const mockSleep = vi.fn().mockResolvedValue(undefined);

    const mockFetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        return {
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "Service Unavailable: high demand",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"recovered":true}' }] } }],
        }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const budget = new RequestBudget(5);
    const result = await callModel("sys", "user", {
      budget,
      sleepFn: mockSleep,
      maxTransientRetries: 2,
    });

    expect(result).toBe('{"recovered":true}');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledTimes(1);
    expect(budget.callsMade).toBe(2); // Both attempts counted against the budget
  });

  it("respects Retry-After header on HTTP 503 response", async () => {
    let attempts = 0;
    const mockSleep = vi.fn().mockResolvedValue(undefined);

    const mockFetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        const headers = new Headers();
        headers.set("retry-after", "4");
        return {
          ok: false,
          status: 503,
          headers,
          text: async () => "High demand",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    await callModel("sys", "user", {
      sleepFn: mockSleep,
      maxTransientRetries: 2,
    });

    expect(mockSleep).toHaveBeenCalledWith(4000); // 4 seconds from Retry-After
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("exhausts transient retries after 2 additional attempts (3 total) on continuous 503", async () => {
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: async () => "Service Unavailable",
    });
    vi.stubGlobal("fetch", mockFetch);

    const budget = new RequestBudget(10);
    await expect(
      callModel("sys", "user", {
        budget,
        sleepFn: mockSleep,
        maxTransientRetries: 2,
      })
    ).rejects.toThrow(/Gemini API call failed with status 503/);

    expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries = 3
    expect(mockSleep).toHaveBeenCalledTimes(2);
    expect(budget.callsMade).toBe(3);
  });

  it("does NOT automatically retry HTTP 429 quota exhaustion (immediate fail)", async () => {
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers(),
      text: async () => "RESOURCE_EXHAUSTED: Quota exceeded",
    });
    vi.stubGlobal("fetch", mockFetch);

    const budget = new RequestBudget(5);
    await expect(
      callModel("sys", "user", {
        budget,
        sleepFn: mockSleep,
        maxTransientRetries: 2,
      })
    ).rejects.toThrow(/status 429/);

    expect(mockFetch).toHaveBeenCalledTimes(1); // Exactly 1 call, zero retries
    expect(mockSleep).not.toHaveBeenCalled();
    expect(budget.callsMade).toBe(1);
  });

  it("does NOT automatically retry HTTP 401 or 403 (immediate fail)", async () => {
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => "Unauthorized: Invalid API key",
    });
    vi.stubGlobal("fetch", mockFetch);

    const budget = new RequestBudget(5);
    await expect(
      callModel("sys", "user", {
        budget,
        sleepFn: mockSleep,
        maxTransientRetries: 2,
      })
    ).rejects.toThrow(/status 401/);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
    expect(budget.callsMade).toBe(1);
  });

  it("does not initiate transient retry if budget would be exceeded", async () => {
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: async () => "Service Unavailable",
    });
    vi.stubGlobal("fetch", mockFetch);

    // Budget of exactly 1 call
    const budget = new RequestBudget(1);
    await expect(
      callModel("sys", "user", {
        budget,
        sleepFn: mockSleep,
        maxTransientRetries: 2,
      })
    ).rejects.toThrow(/request budget exhausted/);

    expect(mockFetch).toHaveBeenCalledTimes(1); // Never initiates attempt 2
    expect(mockSleep).not.toHaveBeenCalled();
    expect(budget.callsMade).toBe(1);
  });
});

describe("Integration: Request budget shared across transient and schema retries", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = "test-key";
    process.env.LLM_MODEL = "gemini-3.8-flash";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const validReportJson = JSON.stringify({
    summary: "Complete valid report",
    readiness_verdict: "Ready to build",
    counts: { blockers: 0, important: 0, minor: 0, questions: 0 },
    category_status: [
      { category: "Business rules", status: "Covered" },
      { category: "Data model and relationships", status: "Covered" },
      { category: "Data fields and quality", status: "Covered" },
      { category: "Access, permissions and test access", status: "Covered" },
      { category: "Exceptions and edge cases", status: "Covered" },
      { category: "Automation behavior", status: "Covered" },
      { category: "Current process and existing org impact", status: "Covered" },
      { category: "Integrations, migration and scale", status: "Not applicable" },
      { category: "Reporting and visibility", status: "Covered" },
      { category: "Acceptance and sign-off", status: "Covered" },
    ],
    findings: [],
  });

  it("counts both initial call and schema-validation retry against the shared budget", async () => {
    let callIdx = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callIdx++;
      if (callIdx === 1) {
        // Return invalid JSON on attempt 1 to trigger schema correction retry
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "MALFORMED_JSON" }] } }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validReportJson }] } }],
        }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const budget = new RequestBudget(2);
    const boundCaller = (sys: string, usr: string) => callModel(sys, usr, { budget });

    const diagnostics: ReviewDiagnostics = { modelCallAttempts: 0, schemaValidationRetries: 0 };
    const report = await reviewRequirement("Test requirement text", undefined, boundCaller, diagnostics);

    expect(report.readiness_verdict).toBe("Ready to build");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(budget.callsMade).toBe(2);
    expect(budget.isExhausted).toBe(true);
    expect(diagnostics.modelCallAttempts).toBe(2);
    expect(diagnostics.schemaValidationRetries).toBe(1);
  });

  it("blocks schema-validation retry if budget limit of 1 is reached", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "MALFORMED_JSON" }] } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const budget = new RequestBudget(1); // Only 1 call allowed
    const boundCaller = (sys: string, usr: string) => callModel(sys, usr, { budget });

    await expect(
      reviewRequirement("Test requirement text", undefined, boundCaller)
    ).rejects.toThrow(BudgetExceededError);

    // Initial attempt made, but schema retry blocked by budget!
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(budget.callsMade).toBe(1);
    expect(budget.isExhausted).toBe(true);
  });
});

describe("Resumable checkpoints with request budgeting", () => {
  it("preserves completed runs and plans remaining runs accurately", () => {
    const mockReport = {
      summary: "Sample report",
      readiness_verdict: "Not ready to build" as const,
      counts: { blockers: 1, important: 0, minor: 0, questions: 1 },
      category_status: [],
      findings: [],
    };

    // Simulated existing checkpoint from previous run (e.g. stopped by budget or error)
    const existingRuns = [
      { runNumber: 1, success: true, report: mockReport, latencyMs: 1200 },
      { runNumber: 2, success: true, report: mockReport, latencyMs: 1100 },
      { runNumber: 3, success: false, error: "HTTP 503", latencyMs: 500 },
    ];

    const plan = planResumedSampleRuns(existingRuns, 5);
    expect(plan.preservedRuns.length).toBe(2); // Only valid runs preserved
    expect(plan.neededRuns).toBe(3);           // Needs 3 more to reach 5
    expect(plan.nextRunNumber).toBe(3);        // Renumbered cleanly
  });

  it("categorizes budget exceeded error cleanly", () => {
    expect(categorizeError("Request budget exhausted: limit of 10 reached")).toBe("budget_exceeded");
    expect(categorizeError("BudgetExceededError: Request budget exhausted")).toBe("budget_exceeded");
  });
});

describe("lib/llm: RequestPacer & Pacing", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = "test-key";
    process.env.LLM_MODEL = "gemini-3.8-flash";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("does not delay on the very first attempt", async () => {
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const pacer = new RequestPacer(20, mockSleep);

    const waitMs = await pacer.pace();
    expect(waitMs).toBe(0);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it("paces subsequent attempts to enforce minimum interval", async () => {
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const pacer = new RequestPacer(20, mockSleep); // 20s interval

    await pacer.pace(); // 1st attempt at T0
    expect(mockSleep).not.toHaveBeenCalled();

    // 2nd attempt immediately after: should wait ~20,000ms
    const waitMs = await pacer.pace();
    expect(waitMs).toBeGreaterThan(19000);
    expect(waitMs).toBeLessThanOrEqual(20000);
    expect(mockSleep).toHaveBeenCalledTimes(1);
    expect(mockSleep).toHaveBeenCalledWith(waitMs);
  });

  it("does not wait if interval is 0 seconds", async () => {
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const pacer = new RequestPacer(0, mockSleep);

    await pacer.pace();
    await pacer.pace();
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it("callModel invokes pacer.pace() before initiating HTTP fetch", async () => {
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const pacer = new RequestPacer(10, mockSleep);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"summary":"pacing test"}' }] } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Call 1
    await callModel("sys", "user", { pacer, sleepFn: mockSleep });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();

    // Call 2 immediately: pacer will wait before fetch is called
    await callModel("sys", "user", { pacer, sleepFn: mockSleep });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledTimes(1);
  });
});

describe("lib/llm: parse429Details", () => {
  it("detects per-minute RPM rate limiting and extracts retry delay from body", () => {
    const errorMsg =
      "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.8-flash, description: Generate content requests per minute limit exceeded on Free Tier. Please retry in 50.321507239s.";
    const details = parse429Details(errorMsg);

    expect(details.isRateLimit).toBe(true);
    expect(details.rateLimitType).toBe("per_minute");
    expect(details.retryAfterSeconds).toBe(50.3);
  });

  it("extracts retry delay from response header when present", () => {
    const headers = new Headers();
    headers.set("retry-after", "25");
    const details = parse429Details("Rate limit reached", headers);

    expect(details.isRateLimit).toBe(true);
    expect(details.rateLimitType).toBe("per_minute");
    expect(details.retryAfterSeconds).toBe(25);
  });

  it("detects daily quota exhaustion and does not classify as per-minute", () => {
    const errorMsg =
      "Quota exceeded for metric 'GenerateContent requests per day' of service 'generativelanguage.googleapis.com'. Resource has been exhausted.";
    const details = parse429Details(errorMsg);

    expect(details.isRateLimit).toBe(true);
    expect(details.rateLimitType).toBe("daily_quota");
  });

  it("categorizeError classifies RPM rate limiting", () => {
    expect(
      categorizeError("Generate content requests per minute limit exceeded on Free Tier")
    ).toBe("rate_limit_rpm");
    expect(
      categorizeError("free_tier_requests quota exceeded")
    ).toBe("rate_limit_rpm");
  });
});

describe("Accurate evaluation reporting (Part B requirements)", () => {
  const mockReport = {
    summary: "Sample report",
    readiness_verdict: "Not ready to build" as const,
    counts: { blockers: 1, important: 1, minor: 0, questions: 2 },
    category_status: [],
    findings: [],
  };

  it("marks samples with zero valid evaluations as NOT_EVALUATED and meetsExpectedVerdict as null", () => {
    const runs = [
      { runNumber: 1, success: false, error: "HTTP 503", latencyMs: 300 },
      { runNumber: 2, success: false, error: "HTTP 429 Rate Limit", latencyMs: 250 },
    ];

    const metrics = analyzeSampleRuns("03-manuscript-reviewer", runs);

    expect(metrics.validRuns).toBe(0);
    expect(metrics.failedRuns).toBe(2);
    expect(metrics.evaluationStatus).toBe("NOT_EVALUATED");
    expect(metrics.meetsExpectedVerdict).toBeNull(); // NOT true!
    expect(metrics.deviationNotes[0]).toMatch(/Not evaluated/);
  });

  it("separates verdict consistency from infrastructure reliability (e.g. 4 valid agree, 1 API failure)", () => {
    const runs = [
      { runNumber: 1, success: true, report: mockReport, latencyMs: 1000 },
      { runNumber: 2, success: true, report: mockReport, latencyMs: 1000 },
      { runNumber: 3, success: true, report: mockReport, latencyMs: 1000 },
      { runNumber: 4, success: true, report: mockReport, latencyMs: 1000 },
      { runNumber: 5, success: false, error: "HTTP 503 Service Unavailable", latencyMs: 500 },
    ];

    const metrics = analyzeSampleRuns("02-royalty-approval", runs);

    // 4/4 valid evaluations agree!
    expect(metrics.validRuns).toBe(4);
    expect(metrics.failedRuns).toBe(1);
    expect(metrics.isVerdictConsistent).toBe(true);
    expect(metrics.verdictAgreement).toBe("4/4 valid runs agree");
    expect(metrics.meetsExpectedVerdict).toBe(true);

    // Infrastructure failure tracked separately
    expect(metrics.deviationNotes.some((n) => n.includes("1 of 5 run(s) failed with API or network error"))).toBe(true);
  });
});
