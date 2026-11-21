import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callModel, resolveModelName, resolveFallbackModelName } from "../lib/llm";
import { reviewRequirement } from "../lib/review";
import {
  reviewDiagnosticsContext,
  reviewAbortContext,
  ReviewDiagnosticsCollector,
} from "../lib/request-context";

describe("Prompt Y: Gemini 3.8 to 3.5 Flash-Lite Model Failover", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = "test-gemini-key-model-failover";
    process.env.LLM_MODEL = "gemini-3.8-flash";
    process.env.LLM_FALLBACK_MODEL = "gemini-3.5-flash-lite";
    process.env.GEMINI_THINKING_LEVEL = "low";
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

  it("1. Model resolution helpers resolve primary and fallback models correctly", () => {
    expect(resolveModelName()).toBe("gemini-3.8-flash");
    expect(resolveFallbackModelName()).toBe("gemini-3.5-flash-lite");

    // Option overrides take precedence
    expect(resolveModelName("gemini-3.7-flash")).toBe("gemini-3.7-flash");
    expect(resolveFallbackModelName("custom-fallback")).toBe("custom-fallback");

    // When unset, fallback is null
    delete process.env.LLM_FALLBACK_MODEL;
    expect(resolveFallbackModelName()).toBeNull();
  });

  it("2. Primary succeeds: fallback is never invoked", async () => {
    const urlsCalled: string[] = [];
    const modelsLogged: string[] = [];

    const mockFetch = vi.fn().mockImplementation((url: string, opts: any) => {
      urlsCalled.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validReportJson }] } }],
        }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.8-flash");
    const result = await reviewDiagnosticsContext.run(collector, () =>
      callModel("sys", "usr")
    );

    expect(result).toBe(validReportJson);
    expect(urlsCalled.length).toBe(1);
    expect(urlsCalled[0]).toContain("models/gemini-3.8-flash:generateContent");
    expect(collector.httpAttempts.length).toBe(1);
    expect(collector.httpAttempts[0].model).toBe("gemini-3.8-flash");
    expect(collector.httpAttempts[0].outcome).toBe("success");
    expect(collector.httpAttempts[0].status).toBe(200);
  });

  it("3. Primary returns HTTP 503: switches immediately (0ms backoff) to fallback model", async () => {
    const urlsCalled: string[] = [];
    const bodiesCalled: any[] = [];
    let callCount = 0;

    const mockFetch = vi.fn().mockImplementation((url: string, opts: any) => {
      callCount++;
      urlsCalled.push(url);
      bodiesCalled.push(JSON.parse(opts.body));

      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ error: { message: "Model overloaded" } }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validReportJson }] } }],
        }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.8-flash");

    const result = await reviewDiagnosticsContext.run(collector, () =>
      callModel("system prompt", "user prompt", { sleepFn: mockSleep })
    );

    expect(result).toBe(validReportJson);
    expect(callCount).toBe(2);

    // Verify Attempt 1 used primary gemini-3.8-flash
    expect(urlsCalled[0]).toContain("models/gemini-3.8-flash:generateContent");
    expect(bodiesCalled[0].generationConfig?.thinkingConfig).toEqual({ thinkingLevel: "low" });

    // Verify Attempt 2 used fallback gemini-3.5-flash-lite with 0ms backoff
    expect(urlsCalled[1]).toContain("models/gemini-3.5-flash-lite:generateContent");
    expect(bodiesCalled[1].generationConfig?.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(mockSleep).toHaveBeenCalledWith(0);

    // Diagnostics verification
    expect(collector.httpAttempts.length).toBe(2);
    expect(collector.httpAttempts[0].model).toBe("gemini-3.8-flash");
    expect(collector.httpAttempts[0].outcome).toBe("transient_retry");
    expect(collector.httpAttempts[0].status).toBe(503);
    expect(collector.httpAttempts[0].backoff_ms).toBe(0);

    expect(collector.httpAttempts[1].model).toBe("gemini-3.5-flash-lite");
    expect(collector.httpAttempts[1].outcome).toBe("success");
    expect(collector.httpAttempts[1].status).toBe(200);
  });

  it("4. Primary times out: switches to fallback model with 0ms backoff when deadline permits", async () => {
    let callCount = 0;
    const urlsCalled: string[] = [];

    const mockFetch = vi.fn().mockImplementation((url: string, opts: any) => {
      callCount++;
      urlsCalled.push(url);

      if (callCount === 1) {
        // Simulate Attempt 1 timing out via its AbortSignal
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validReportJson }] } }],
        }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.8-flash");

    const result = await reviewDiagnosticsContext.run(collector, () =>
      callModel("sys", "usr", { sleepFn: mockSleep })
    );

    expect(result).toBe(validReportJson);
    expect(callCount).toBe(2);
    expect(urlsCalled[0]).toContain("models/gemini-3.8-flash:generateContent");
    expect(urlsCalled[1]).toContain("models/gemini-3.5-flash-lite:generateContent");
    expect(mockSleep).toHaveBeenCalledWith(0);

    expect(collector.httpAttempts.length).toBe(2);
    expect(collector.httpAttempts[0].model).toBe("gemini-3.8-flash");
    expect(collector.httpAttempts[0].outcome).toBe("transient_retry");
    expect(collector.httpAttempts[1].model).toBe("gemini-3.5-flash-lite");
    expect(collector.httpAttempts[1].outcome).toBe("success");
  });

  it("5. Both models fail (primary 503, fallback 503): throws error after 2 attempts", async () => {
    let callCount = 0;
    const urlsCalled: string[] = [];

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      urlsCalled.push(url);
      return Promise.resolve({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: { message: `Model unavailable: attempt ${callCount}` } }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.8-flash");

    await expect(
      reviewDiagnosticsContext.run(collector, () =>
        callModel("sys", "usr", { sleepFn: mockSleep })
      )
    ).rejects.toThrow(/unavailable/i);

    expect(callCount).toBe(2);
    expect(urlsCalled[0]).toContain("models/gemini-3.8-flash:generateContent");
    expect(urlsCalled[1]).toContain("models/gemini-3.5-flash-lite:generateContent");
    expect(collector.httpAttempts.length).toBe(2);
    expect(collector.httpAttempts[0].model).toBe("gemini-3.8-flash");
    expect(collector.httpAttempts[0].outcome).toBe("transient_retry");
    expect(collector.httpAttempts[1].model).toBe("gemini-3.5-flash-lite");
    expect(collector.httpAttempts[1].outcome).toBe("503");
  });

  it("6. HTTP 429 does NOT trigger fallback and fails immediately", async () => {
    let callCount = 0;
    const urlsCalled: string[] = [];

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      urlsCalled.push(url);
      return Promise.resolve({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: "Resource exhausted: rate limited" } }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const mockSleep = vi.fn();
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.8-flash");

    await expect(
      reviewDiagnosticsContext.run(collector, () =>
        callModel("sys", "usr", { sleepFn: mockSleep })
      )
    ).rejects.toThrow(/rate limit/i);

    // Must halt immediately on 429 without calling fallback or sleeping
    expect(callCount).toBe(1);
    expect(urlsCalled[0]).toContain("models/gemini-3.8-flash:generateContent");
    expect(mockSleep).not.toHaveBeenCalled();
    expect(collector.httpAttempts.length).toBe(1);
    expect(collector.httpAttempts[0].model).toBe("gemini-3.8-flash");
    expect(collector.httpAttempts[0].outcome).toBe("429");
  });

  it("7. Fallback preserves valid JSON schema output in reviewRequirement", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ error: { message: "Primary 503 high demand" } }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validReportJson }] } }],
        }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.8-flash");
    const report = await reviewDiagnosticsContext.run(collector, () =>
      reviewRequirement("The system must validate lead email before converting.")
    );

    expect(report.readiness_verdict).toBe("Ready to build");
    expect(report.summary).toBe("Requirement is well specified");
    expect(callCount).toBe(2);
    expect(collector.httpAttempts.length).toBe(2);
    expect(collector.httpAttempts[0].model).toBe("gemini-3.8-flash");
    expect(collector.httpAttempts[1].model).toBe("gemini-3.5-flash-lite");
  });

  it("8. When fallbackModel is not configured, retry stays on primary model", async () => {
    delete process.env.LLM_FALLBACK_MODEL;
    let callCount = 0;
    const urlsCalled: string[] = [];

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      urlsCalled.push(url);
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ error: { message: "503 transient error" } }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validReportJson }] } }],
        }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.8-flash");

    const result = await reviewDiagnosticsContext.run(collector, () =>
      callModel("sys", "usr", { sleepFn: mockSleep })
    );

    expect(result).toBe(validReportJson);
    expect(callCount).toBe(2);
    expect(urlsCalled[0]).toContain("models/gemini-3.8-flash:generateContent");
    expect(urlsCalled[1]).toContain("models/gemini-3.8-flash:generateContent");
  });
});
