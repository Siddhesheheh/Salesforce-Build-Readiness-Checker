import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callModel, resolveThinkingLevel, resolveModelName } from "../lib/llm";
import { reviewRequirement } from "../lib/review";
import {
  reviewDiagnosticsContext,
  reviewAbortContext,
  ReviewDiagnosticsCollector,
} from "../lib/request-context";

describe("Prompt T: Effective Gemini Request Configuration & Diagnostic Logging", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = "test-gemini-key-12345";
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

  it("1. GEMINI_THINKING_LEVEL=low produces thinkingConfig.thinkingLevel='low' for gemini-3.6-flash", async () => {
    process.env.GEMINI_THINKING_LEVEL = "low";
    process.env.LLM_MODEL = "gemini-3.6-flash";

    let capturedBody: any = null;
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validReportJson }] } }],
        }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    // Call without explicit thinkingLevel option
    await callModel("system prompt", "user requirement");

    expect(capturedBody).toBeDefined();
    expect(capturedBody.generationConfig?.thinkingConfig).toEqual({
      thinkingLevel: "low",
    });
    expect(capturedBody.generationConfig?.responseMimeType).toBe("application/json");
  });

  it("2. Explicit thinking-level override behaves according to configuration contract", async () => {
    process.env.GEMINI_THINKING_LEVEL = "high";
    process.env.LLM_MODEL = "gemini-3.6-flash";

    let capturedBody: any = null;
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validReportJson }] } }],
        }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    // Override 'high' env with explicit 'low'
    await callModel("sys", "user", { thinkingLevel: "low" });
    expect(capturedBody.generationConfig?.thinkingConfig).toEqual({
      thinkingLevel: "low",
    });

    // Override 'high' env with explicit 'off'
    await callModel("sys", "user", { thinkingLevel: "off" });
    expect(capturedBody.generationConfig?.thinkingConfig).toBeUndefined();

    // Verify non-gemini-3 model (e.g. gemini-2.5-flash) ignores thinkingLevel
    expect(resolveThinkingLevel("gemini-2.5-flash", "low")).toBeUndefined();
  });

  it("3. Interactive review path forwards resolved configuration and records diagnostics", async () => {
    process.env.GEMINI_THINKING_LEVEL = "low";
    process.env.LLM_MODEL = "gemini-3.6-flash";

    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.6-flash");
    let capturedBody: any = null;

    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validReportJson }] } }],
        }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const report = await reviewDiagnosticsContext.run(collector, () =>
      reviewRequirement("Lead assignment rules for Germany enterprise leads.")
    );

    expect(report.readiness_verdict).toBe("Ready to build");
    expect(capturedBody.generationConfig?.thinkingConfig).toEqual({
      thinkingLevel: "low",
    });

    // Verify collector recorded the effective configuration diagnostics
    expect(collector.httpAttempts.length).toBe(1);
    const attempt = collector.httpAttempts[0];
    expect(attempt.model).toBe("gemini-3.6-flash");
    expect(attempt.resolved_thinking_level).toBe("low");
    expect(attempt.thinking_config_present).toBe(true);
    expect(attempt.max_output_tokens).toBe("unset");
    expect(attempt.system_prompt_length).toBeGreaterThan(5000);
    expect(attempt.user_prompt_length).toBeGreaterThan(20);
    expect(attempt.status).toBe(200);
    expect(attempt.outcome).toBe("success");
  });

  it("4. Diagnostic logging logs only metadata and never exposes API keys, prompts, or requirements", async () => {
    process.env.GEMINI_THINKING_LEVEL = "low";
    process.env.LLM_MODEL = "gemini-3.6-flash";
    process.env.GEMINI_API_KEY = "SECRET_GEMINI_KEY_ABC123";

    const secretRequirement = "CONFIDENTIAL_REQUIREMENT_TEXT_NEVER_LOG_THIS";
    const secretSystem = "CONFIDENTIAL_SYSTEM_PROMPT_NEVER_LOG_THIS";

    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.6-flash");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: validReportJson }] } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await reviewDiagnosticsContext.run(collector, () =>
      callModel(secretSystem, secretRequirement)
    );

    // Find the diagnostic log entry
    const diagnosticLogs = logSpy.mock.calls
      .map((call) => call[0])
      .filter((msg) => typeof msg === "string" && msg.includes("gemini_attempt_diagnostics"));

    expect(diagnosticLogs.length).toBeGreaterThanOrEqual(1);

    const logJson = JSON.parse(diagnosticLogs[0]);
    expect(logJson.event).toBe("gemini_attempt_diagnostics");
    expect(logJson.model).toBe("gemini-3.6-flash");
    expect(logJson.resolved_thinking_level).toBe("low");
    expect(logJson.thinking_config_present).toBe(true);
    expect(logJson.max_output_tokens).toBe("unset");
    expect(logJson.system_prompt_length).toBe(secretSystem.length);
    expect(logJson.user_prompt_length).toBe(secretRequirement.length);
    expect(logJson.attempt).toBe(1);
    expect(logJson.status).toBe(200);

    // CRITICAL: Ensure sensitive contents are NEVER logged anywhere in output string
    for (const rawCall of logSpy.mock.calls) {
      const fullLoggedStr = JSON.stringify(rawCall);
      expect(fullLoggedStr).not.toContain("SECRET_GEMINI_KEY_ABC123");
      expect(fullLoggedStr).not.toContain(secretRequirement);
      expect(fullLoggedStr).not.toContain(secretSystem);
    }
  });

  it("5. Existing timeout and retry behavior remains unchanged under diagnostic logging", async () => {
    process.env.GEMINI_THINKING_LEVEL = "low";
    process.env.LLM_MODEL = "gemini-3.6-flash";

    const collector = new ReviewDiagnosticsCollector(55000, "gemini-3.6-flash");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    let attemptCount = 0;
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      attemptCount++;
      if (attemptCount === 1) {
        // Attempt 1: 503 error
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: { get: () => null },
          text: async () => "Unavailable",
        });
      }
      // Attempt 2: success
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
    expect(collector.httpAttempts.length).toBe(2);

    // Attempt 1 diagnostics
    expect(collector.httpAttempts[0].attempt).toBe(1);
    expect(collector.httpAttempts[0].status).toBe(503);
    expect(collector.httpAttempts[0].outcome).toBe("transient_retry");
    expect(collector.httpAttempts[0].resolved_thinking_level).toBe("low");
    expect(collector.httpAttempts[0].thinking_config_present).toBe(true);

    // Attempt 2 diagnostics
    expect(collector.httpAttempts[1].attempt).toBe(2);
    expect(collector.httpAttempts[1].status).toBe(200);
    expect(collector.httpAttempts[1].outcome).toBe("success");
    expect(collector.httpAttempts[1].resolved_thinking_level).toBe("low");
    expect(collector.httpAttempts[1].thinking_config_present).toBe(true);

    // Both attempt diagnostic logs were emitted
    const diagnosticLogs = logSpy.mock.calls
      .map((call) => call[0])
      .filter((msg) => typeof msg === "string" && msg.includes("gemini_attempt_diagnostics"));

    expect(diagnosticLogs.length).toBe(2);
    const log1 = JSON.parse(diagnosticLogs[0]);
    const log2 = JSON.parse(diagnosticLogs[1]);
    expect(log1.attempt).toBe(1);
    expect(log1.status).toBe(503);
    expect(log2.attempt).toBe(2);
    expect(log2.status).toBe(200);
  });
});
