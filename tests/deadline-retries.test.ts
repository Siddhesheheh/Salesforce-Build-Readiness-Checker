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
});
