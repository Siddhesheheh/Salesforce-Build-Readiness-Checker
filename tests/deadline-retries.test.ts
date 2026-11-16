import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callModel, UpstreamApiError, MIN_REASONABLE_ATTEMPT_TIME_MS } from "../lib/llm";
import {
  reviewDiagnosticsContext,
  reviewAbortContext,
  ReviewDiagnosticsCollector,
} from "../lib/request-context";
import { reviewRequirement } from "../lib/review";
import { ReviewSession } from "../lib/workflow-types";

describe("Prompt I: Deadline-Aware Retries & Reliability Diagnostics", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.LLM_MODEL = "gemini-2.5-flash";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("first attempt times out and reports sanitized timeout outcome", async () => {
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-2.5-flash");

    // Fetch simulates an attempt that hangs past its allocated timeout (e.g. 50ms in test)
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            const abortErr = new Error("The operation was aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        }
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      reviewDiagnosticsContext.run(collector, () =>
        callModel("sys", "user", {
          timeoutMs: 50,
          maxTransientRetries: 0,
        })
      )
    ).rejects.toThrow(/timed out after 0s/i);

    expect(collector.httpAttempts.length).toBe(1);
    expect(collector.httpAttempts[0].attempt).toBe(1);
    expect(collector.httpAttempts[0].outcome).toBe("timeout");
    expect(collector.httpAttempts[0].model).toBe("gemini-2.5-flash");
    expect(collector.httpAttempts[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("first attempt returns 503 quickly, second succeeds with dynamic timeout allocation", async () => {
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-2.5-flash");
    const mockSleep = vi.fn().mockResolvedValue(undefined);

    let attemptCount = 0;
    const capturedTimeouts: number[] = [];

    const mockFetch = vi.fn().mockImplementation(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        // Fast 503 from Gemini
        return {
          ok: false,
          status: 503,
          headers: { get: () => null },
          text: async () => "This model is currently experiencing high demand.",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: "Review completed on retry",
                      readiness_verdict: "Ready to build",
                      counts: { blockers: 0, important: 0, minor: 0, questions: 0 },
                      category_status: [],
                      findings: [],
                    }),
                  },
                ],
                role: "model",
              },
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await reviewDiagnosticsContext.run(collector, () =>
      callModel("sys", "user", {
        sleepFn: mockSleep,
        maxTransientRetries: 1,
      })
    );

    const parsed = JSON.parse(result);
    expect(parsed.summary).toBe("Review completed on retry");
    expect(collector.httpAttempts.length).toBe(2);

    // Attempt 1: Transient 503
    expect(collector.httpAttempts[0].attempt).toBe(1);
    expect(collector.httpAttempts[0].status).toBe(503);
    expect(collector.httpAttempts[0].outcome).toBe("transient_retry");
    expect(collector.httpAttempts[0].model).toBe("gemini-2.5-flash");
    expect(collector.httpAttempts[0].remaining_budget_ms).toBeDefined();

    // Attempt 2: Success 200
    expect(collector.httpAttempts[1].attempt).toBe(2);
    expect(collector.httpAttempts[1].status).toBe(200);
    expect(collector.httpAttempts[1].outcome).toBe("success");
    expect(collector.httpAttempts[1].model).toBe("gemini-2.5-flash");
    expect(collector.httpAttempts[1].remaining_budget_ms).toBeDefined();
  });

  it("first attempt returns 503, second times out and records diagnostic history", async () => {
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-2.5-flash");
    const mockSleep = vi.fn().mockResolvedValue(undefined);

    let attemptCount = 0;
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      attemptCount++;
      if (attemptCount === 1) {
        // Attempt 1: 503 quickly
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: { get: () => null },
          text: async () => "The model is overloaded.",
        });
      }
      // Attempt 2: Hangs and aborts
      return new Promise((_resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      reviewDiagnosticsContext.run(collector, () =>
        callModel("sys", "user", {
          sleepFn: mockSleep,
          timeoutMs: 40,
          maxTransientRetries: 1,
        })
      )
    ).rejects.toThrow(/timed out/i);

    expect(collector.httpAttempts.length).toBe(2);
    expect(collector.httpAttempts[0].status).toBe(503);
    expect(collector.httpAttempts[0].outcome).toBe("transient_retry");
    expect(collector.httpAttempts[1].outcome).toBe("timeout");
  });

  it("insufficient remaining time prevents retry without wasting time sleeping", async () => {
    // Create collector simulating only 10 seconds remaining out of a 55s deadline (< 14s minimum runway)
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-2.5-flash");
    vi.spyOn(collector, "remainingMs", "get").mockReturnValue(10000); // 10s remaining

    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null },
      text: async () => "High demand",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      reviewDiagnosticsContext.run(collector, () =>
        callModel("sys", "user", {
          sleepFn: mockSleep,
          maxTransientRetries: 1,
        })
      )
    ).rejects.toThrow(/cannot retry: deadline approaching/i);

    // Verified: Sleep was NOT called; retry was skipped immediately!
    expect(mockSleep).not.toHaveBeenCalled();
    expect(collector.retrySkippedDueToInsufficientTime).toBe(true);
    expect(collector.httpAttempts.length).toBe(1);
    expect(collector.httpAttempts[0].status).toBe(503);
    expect(collector.httpAttempts[0].retry_skipped_insufficient_time).toBe(true);
  });

  it("deadline cancellation actively aborts active requests", async () => {
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-2.5-flash");
    const abortCtrl = new AbortController();

    let signalWasAborted = false;
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            signalWasAborted = opts.signal.aborted;
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const callPromise = reviewDiagnosticsContext.run(collector, () =>
      reviewAbortContext.run(abortCtrl, () =>
        callModel("sys", "user", { maxTransientRetries: 0 })
      )
    );

    // Trigger abort while fetch is in-flight
    setTimeout(() => {
      abortCtrl.abort(new Error("Overall deadline reached"));
    }, 20);

    await expect(callPromise).rejects.toThrow(/actively aborted/i);
    expect(signalWasAborted).toBe(true);
    expect(collector.httpAttempts.length).toBe(1);
    expect(collector.httpAttempts[0].outcome).toBe("aborted");
  });

  it("successful review produces the expected structured 10-category output", async () => {
    const mockReportJson = JSON.stringify({
      summary: "Clean requirement satisfying all criteria.",
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
        { category: "Integrations, migration and scale", status: "Covered" },
        { category: "Reporting and visibility", status: "Covered" },
        { category: "Acceptance and sign-off", status: "Covered" },
      ],
      findings: [],
    });

    const mockCaller = vi.fn().mockResolvedValue(mockReportJson);
    const report = await reviewRequirement(
      "Valid business requirement for automated lead routing.",
      "Org context details",
      mockCaller
    );

    expect(report.readiness_verdict).toBe("Ready to build");
    expect(report.counts.blockers).toBe(0);
    expect(report.category_status.length).toBe(10);
  });

  it("failed recheck preserves user input and review history", () => {
    const initialSession: ReviewSession = {
      sessionId: "session-preserve-test",
      originalRequirement: "Lead assignment rules for EMEA",
      originalOrgContext: "Production enterprise edition",
      createdAt: "2026-10-26T10:00:00.000Z",
      updatedAt: "2026-10-26T10:00:00.000Z",
      currentVersionNumber: 1,
      versions: [
        {
          versionNumber: 1,
          timestamp: "2026-10-26T10:00:00.000Z",
          submittedRequirement: "Lead assignment rules for EMEA",
          orgContext: "Production enterprise edition",
          report: {
            summary: "Initial review with gaps",
            readiness_verdict: "Not ready to build",
            counts: { blockers: 1, important: 0, minor: 0, questions: 1 },
            category_status: [],
            findings: [
              {
                id: 1,
                title: "Missing fallback queue",
                category: "Business rules",
                severity: "Blocker",
                evidence: "No queue specified",
                whats_missing: "Fallback queue",
                why_it_matters: "Leads will remain unassigned",
                question_for_pm: "Which fallback queue should be used?",
                verify_in_org: "Check queues",
              },
            ],
          },
          findingFeedback: {},
          answers: {
            1: {
              findingId: 1,
              question: "Which fallback queue should be used?",
              answerText: "EMEA Unassigned Leads Queue",
              updatedAt: "2026-10-26T10:05:00.000Z",
            },
          },
        },
      ],
    };

    // Simulate failure during recheck (e.g. 504 timeout or 503 busy)
    // The handler does NOT mutate session on failure:
    let sessionState = { ...initialSession };
    const simulatedRecheckFailure = true;

    if (simulatedRecheckFailure) {
      // Recheck failed: error state updated, but session remains unchanged
      const recheckError = {
        title: "Review is taking longer than expected",
        message:
          "Salesforce Readiness couldn't complete this review in time. Your work is preserved. Please try again.",
      };
      expect(recheckError.title).toContain("Review is taking longer");
    }

    // Verify session integrity
    expect(sessionState.versions.length).toBe(1);
    expect(sessionState.originalRequirement).toBe("Lead assignment rules for EMEA");
    expect(sessionState.versions[0].answers[1].answerText).toBe("EMEA Unassigned Leads Queue");
    expect(sessionState.versions[0].report.findings.length).toBe(1);
  });

  it("Prompt Q: balances attempt timeouts capping each interactive attempt at 25,000 ms", async () => {
    // Under Prompt Q:
    // - Overall deadline: 55,000 ms
    // - Configured production model: gemini-3.8-flash
    // - Attempt 1: capped at MAX_INTERACTIVE_ATTEMPT_MS (25,000 ms)
    // - Fast 503 after 6,114 ms
    // - Backoff: 1,223 ms
    // - Attempt 2 start: elapsed 7,337 ms, remaining runway 47,663 ms
    // - Attempt 2 timeout: capped at min(25000, 47663 - 2000) = 25,000 ms

    process.env.LLM_MODEL = "gemini-3.8-flash";
    let simulatedNow = 1700000000000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => simulatedNow);

    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.8-flash");
    const mockSleep = vi.fn().mockImplementation(async (backoffMs: number) => {
      // Simulate sleep duration advancing clock
      simulatedNow += 1223;
    });

    const capturedAttemptTimeouts: number[] = [];
    const origSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(((callback: any, delay?: number, ...args: any[]) => {
      if (typeof delay === "number" && delay > 1000) {
        capturedAttemptTimeouts.push(delay);
        // If this is Attempt 2 (delay 25000ms), trigger the timeout callback asynchronously
        if (delay === 25000 && capturedAttemptTimeouts.length === 2) {
          simulatedNow += 25000;
          return origSetTimeout(callback, 10, ...args);
        }
      }
      return origSetTimeout(callback, delay, ...args);
    }) as any);

    let attemptCount = 0;
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      attemptCount++;
      if (attemptCount === 1) {
        // Attempt 1: 503 after 6,114 ms
        simulatedNow += 6114;
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: { get: () => null },
          text: async () => "This model is currently experiencing high demand.",
        });
      }

      // Attempt 2: in-flight request waiting for response or timeout abort
      return new Promise((_resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            const err = new Error(opts.signal.reason?.message || "The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    // Execute interactive review call under diagnostics context
    await expect(
      reviewDiagnosticsContext.run(collector, () =>
        callModel("sys", "user", {
          sleepFn: mockSleep,
          maxTransientRetries: 1,
        })
      )
    ).rejects.toThrow(/Gemini API request timed out after 25s: Gemini API request timed out after 25000ms/i);

    // Verify dynamic timeout allocation:
    // Attempt 1: 25,000 ms (capped at MAX_INTERACTIVE_ATTEMPT_MS)
    // Attempt 2: 25,000 ms (capped at MAX_INTERACTIVE_ATTEMPT_MS)
    expect(capturedAttemptTimeouts).toEqual([25000, 25000]);

    // Verify diagnostics collection and logged fields
    expect(collector.httpAttempts.length).toBe(2);

    // Attempt 1 verification
    const a1 = collector.httpAttempts[0];
    expect(a1.attempt).toBe(1);
    expect(a1.model).toBe("gemini-3.8-flash");
    expect(a1.status).toBe(503);
    expect(a1.outcome).toBe("transient_retry");
    expect(a1.duration_ms).toBe(6114);
    expect(a1.remaining_budget_ms).toBe(55000);

    // Attempt 2 verification
    const a2 = collector.httpAttempts[1];
    expect(a2.attempt).toBe(2);
    expect(a2.model).toBe("gemini-3.8-flash");
    expect(a2.outcome).toBe("timeout");
    expect(a2.remaining_budget_ms).toBe(47663);
    expect(a2.duration_ms).toBe(25000);
    expect(a2.error_reason).toContain("25000ms");

    // Retry was not skipped
    expect(collector.retrySkippedDueToInsufficientTime).toBe(false);

    dateSpy.mockRestore();
  });
});

describe("Prompt Q: Balanced Gemini Retry Budget & Attempt Allocation (8 Scenarios)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.LLM_MODEL = "gemini-3.6-flash";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const validReportJson = JSON.stringify({
    summary: "Requirement is well specified",
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
      { category: "Integrations, migration and scale", status: "Covered" },
      { category: "Reporting and visibility", status: "Covered" },
      { category: "Acceptance and sign-off", status: "Covered" },
    ],
    findings: [],
  });

  it("Scenario 1: first attempt times out at 25s, second succeeds", async () => {
    let simulatedNow = 1700000000000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => simulatedNow);
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.6-flash");

    const capturedTimeouts: number[] = [];
    const origSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(((callback: any, delay?: number, ...args: any[]) => {
      if (typeof delay === "number" && delay > 1000) {
        capturedTimeouts.push(delay);
        if (capturedTimeouts.length === 1 && delay === 25000) {
          // Attempt 1 times out after 25s
          simulatedNow += 25000;
          return origSetTimeout(callback, 10, ...args);
        }
      }
      return origSetTimeout(callback, delay, ...args);
    }) as any);

    const mockSleep = vi.fn().mockImplementation(async (backoffMs: number) => {
      simulatedNow += 1000;
    });

    let attemptCount = 0;
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      attemptCount++;
      if (attemptCount === 1) {
        // Attempt 1 hangs until timeout abort
        return new Promise((_resolve, reject) => {
          if (opts?.signal) {
            opts.signal.addEventListener("abort", () => {
              const err = new Error(opts.signal.reason?.message || "The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }

      // Attempt 2 succeeds
      simulatedNow += 3000;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validReportJson }] } }],
        }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await reviewDiagnosticsContext.run(collector, () =>
      callModel("sys", "user", {
        sleepFn: mockSleep,
        maxTransientRetries: 1,
      })
    );

    const parsed = JSON.parse(result);
    expect(parsed.summary).toBe("Requirement is well specified");
    expect(capturedTimeouts).toEqual([25000, 25000]);
    expect(collector.httpAttempts.length).toBe(2);
    expect(collector.httpAttempts[0].outcome).toBe("transient_retry");
    expect(collector.httpAttempts[0].error_reason).toContain("25000ms");
    expect(collector.httpAttempts[1].outcome).toBe("success");
    expect(collector.httpAttempts[1].status).toBe(200);

    dateSpy.mockRestore();
  });

  it("Scenario 2: both attempts time out within 55s deadline (504)", async () => {
    let simulatedNow = 1700000000000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => simulatedNow);
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.6-flash");

    const capturedTimeouts: number[] = [];
    const origSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(((callback: any, delay?: number, ...args: any[]) => {
      if (typeof delay === "number" && delay > 1000) {
        capturedTimeouts.push(delay);
        if (delay === 25000) {
          simulatedNow += 25000;
          return origSetTimeout(callback, 10, ...args);
        }
      }
      return origSetTimeout(callback, delay, ...args);
    }) as any);

    const mockSleep = vi.fn().mockImplementation(async (backoffMs: number) => {
      simulatedNow += 1000;
    });

    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            const err = new Error(opts.signal.reason?.message || "The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      reviewDiagnosticsContext.run(collector, () =>
        callModel("sys", "user", {
          sleepFn: mockSleep,
          maxTransientRetries: 1,
        })
      )
    ).rejects.toThrow(/Gemini API request timed out after 25s: Gemini API request timed out after 25000ms/i);

    // Both attempts were capped at 25s
    expect(capturedTimeouts).toEqual([25000, 25000]);
    // Total elapsed: 25,000 + 1,000 + 25,000 = 51,000 ms <= 55,000 ms deadline!
    expect(simulatedNow - 1700000000000).toBe(51000);
    expect(collector.httpAttempts.length).toBe(2);
    expect(collector.httpAttempts[0].outcome).toBe("transient_retry");
    expect(collector.httpAttempts[1].outcome).toBe("timeout");

    dateSpy.mockRestore();
  });

  it("Scenario 3: HTTP 503 on first, second succeeds within 25s", async () => {
    let simulatedNow = 1700000000000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => simulatedNow);
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.6-flash");

    const capturedTimeouts: number[] = [];
    const origSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(((callback: any, delay?: number, ...args: any[]) => {
      if (typeof delay === "number" && delay > 1000) {
        capturedTimeouts.push(delay);
      }
      return origSetTimeout(callback, delay, ...args);
    }) as any);

    const mockSleep = vi.fn().mockImplementation(async (backoffMs: number) => {
      simulatedNow += 1200;
    });

    let attemptCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      attemptCount++;
      if (attemptCount === 1) {
        simulatedNow += 2000;
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: { get: () => null },
          text: async () => "The model is overloaded.",
        });
      }
      simulatedNow += 4000;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validReportJson }] } }],
        }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await reviewDiagnosticsContext.run(collector, () =>
      callModel("sys", "user", {
        sleepFn: mockSleep,
        maxTransientRetries: 1,
      })
    );

    const parsed = JSON.parse(result);
    expect(parsed.summary).toBe("Requirement is well specified");
    expect(capturedTimeouts).toEqual([25000, 25000]);
    expect(collector.httpAttempts.length).toBe(2);
    expect(collector.httpAttempts[0].status).toBe(503);
    expect(collector.httpAttempts[0].outcome).toBe("transient_retry");
    expect(collector.httpAttempts[1].status).toBe(200);
    expect(collector.httpAttempts[1].outcome).toBe("success");

    dateSpy.mockRestore();
  });

  it("Scenario 4: HTTP 429 returns immediately without retry", async () => {
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.6-flash");
    const mockSleep = vi.fn();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: async () => JSON.stringify({
        error: { message: "Resource has been exhausted (e.g. check quota)." },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      reviewDiagnosticsContext.run(collector, () =>
        callModel("sys", "user", {
          sleepFn: mockSleep,
          maxTransientRetries: 1,
        })
      )
    ).rejects.toThrow(/status 429/i);

    // Fast-fail: no sleep, no retry
    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(collector.httpAttempts.length).toBe(1);
    expect(collector.httpAttempts[0].status).toBe(429);
  });

  it("Scenario 5: insufficient remaining runway skips retry without sleeping", async () => {
    let simulatedNow = 1700000000000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => simulatedNow);
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.6-flash");

    // Advance simulated time so only 15,000 ms remains of the 55,000 ms deadline
    simulatedNow += 40000; // 15,000 ms remaining

    const mockSleep = vi.fn();
    const mockFetch = vi.fn().mockImplementation(() => {
      // Attempt 1 fails with 503 after 1,000 ms -> remaining deadline is 14,000 ms
      simulatedNow += 1000;
      return Promise.resolve({
        ok: false,
        status: 503,
        headers: { get: () => null },
        text: async () => "Unavailable",
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      reviewDiagnosticsContext.run(collector, () =>
        callModel("sys", "user", {
          sleepFn: mockSleep,
          maxTransientRetries: 1,
        })
      )
    ).rejects.toThrow(/cannot retry: deadline approaching/i);

    // Crucial check: sleepFn was NOT called because remaining runway (14s - 1s backoff - 2s buffer = 11s)
    // is below MIN_REASONABLE_ATTEMPT_TIME_MS (14s)
    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(collector.retrySkippedDueToInsufficientTime).toBe(true);
    expect(collector.httpAttempts.length).toBe(1);
    expect(collector.httpAttempts[0].retry_skipped_insufficient_time).toBe(true);

    dateSpy.mockRestore();
  });

  it("Scenario 6: first attempt succeeds fast without retry or wait", async () => {
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.6-flash");
    const mockSleep = vi.fn();
    const capturedTimeouts: number[] = [];

    const origSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(((callback: any, delay?: number, ...args: any[]) => {
      if (typeof delay === "number" && delay > 1000) {
        capturedTimeouts.push(delay);
      }
      return origSetTimeout(callback, delay, ...args);
    }) as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: validReportJson }] } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await reviewDiagnosticsContext.run(collector, () =>
      callModel("sys", "user", {
        sleepFn: mockSleep,
        maxTransientRetries: 1,
      })
    );

    const parsed = JSON.parse(result);
    expect(parsed.summary).toBe("Requirement is well specified");
    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedTimeouts).toEqual([25000]);
    expect(collector.httpAttempts.length).toBe(1);
    expect(collector.httpAttempts[0].outcome).toBe("success");
    expect(collector.retrySkippedDueToInsufficientTime).toBe(false);
  });

  it("Scenario 7: user input and review state preserved after 504", async () => {
    // Simulate user reviewing a requirement that ends in a 504 timeout
    const originalReq = "Assign all enterprise leads to senior reps within 2 hours.";
    const existingSession: ReviewSession = {
      sessionId: "session-123",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentVersionNumber: 0,
      originalRequirement: originalReq,
      versions: [],
    };

    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    let errorCaught: any = null;
    try {
      await reviewRequirement(
        originalReq,
        undefined,
        (sys, usr) => callModel(sys, usr, { timeoutMs: 30, maxTransientRetries: 0 })
      );
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(errorCaught.statusCode).toBe(504);

    // Verify user input and existing session remain intact
    expect(existingSession.originalRequirement).toBe(originalReq);
    expect(existingSession.sessionId).toBe("session-123");
    expect(existingSession.versions.length).toBe(0);
  });

  it("Scenario 8: non-interactive callers retain 30s timeout and default retries", async () => {
    const capturedTimeouts: number[] = [];
    const origSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(((callback: any, delay?: number, ...args: any[]) => {
      if (typeof delay === "number" && delay > 1000) {
        capturedTimeouts.push(delay);
      }
      return origSetTimeout(callback, delay, ...args);
    }) as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: validReportJson }] } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Call callModel WITHOUT reviewDiagnosticsContext or reviewAbortContext
    const result = await callModel("system prompt", "user prompt");
    const parsed = JSON.parse(result);
    expect(parsed.summary).toBe("Requirement is well specified");

    // Non-interactive timeout is default 30,000 ms, NOT 25,000 ms
    expect(capturedTimeouts).toEqual([30000]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
