import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callModel } from "../lib/llm";

describe("lib/llm: callModel", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.LLM_MODEL = "gemini-3.8-flash";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws error when neither GEMINI_API_KEY nor LLM_API_KEY is set", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_API_KEY;

    await expect(callModel("system prompt", "user prompt")).rejects.toThrow(
      "GEMINI_API_KEY or LLM_API_KEY is not set in environment."
    );
  });

  it("throws error when Gemini API returns a non-200 status code", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden: API key expired",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(callModel("system prompt", "user prompt")).rejects.toThrow(
      "Gemini API call failed with status 403: Forbidden: API key expired"
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("throws error when Gemini returns empty candidates or content", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ finishReason: "SAFETY" }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(callModel("system prompt", "user prompt")).rejects.toThrow(
      "Gemini returned empty response (finishReason: SAFETY)"
    );
  });

  it("returns clean JSON string on successful response", async () => {
    const expectedOutput = '{"summary":"Test summary","readiness_verdict":"Ready to build"}';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: expectedOutput }],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await callModel("system prompt", "user prompt");
    expect(result).toBe(expectedOutput);

    // Verify endpoint structure and payload
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("models/gemini-3.8-flash:generateContent?key=test-gemini-key"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining('"responseMimeType":"application/json"'),
      })
    );
  });

  it("strips markdown code fences if Gemini wraps JSON in code blocks", async () => {
    const innerJson = '{"verdict":"Ready to build"}';
    const wrappedJson = "```json\n" + innerJson + "\n```";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: wrappedJson }],
              role: "model",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await callModel("system prompt", "user prompt");
    expect(result).toBe(innerJson);
  });

  it("times out and throws 504 UpstreamApiError when request exceeds timeoutMs", async () => {
    const mockFetch = vi.fn().mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    // Call with short timeout of 50ms and 0 retries
    await expect(
      callModel("sys", "user", { timeoutMs: 50, maxTransientRetries: 0 })
    ).rejects.toThrow(/timed out/i);
  });

  it("handles network-level fetch failure, retries, and throws sanitized 502 error", async () => {
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      callModel("sys", "user", {
        maxTransientRetries: 2,
        sleepFn: mockSleep,
      })
    ).rejects.toThrow(/Gemini API network failure: fetch failed/);

    // Should have attempted 3 times (1 initial + 2 retries)
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenCalledTimes(2);
  });

  it("actively aborts underlying fetch when ambient reviewAbortContext is aborted", async () => {
    const { reviewAbortContext } = await import("../lib/request-context");
    const abortController = new AbortController();

    let capturedSignal: AbortSignal | undefined;
    const mockFetch = vi.fn().mockImplementation((_url, options) => {
      capturedSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const callPromise = reviewAbortContext.run(abortController, () =>
      callModel("sys", "user", { timeoutMs: 10000, maxTransientRetries: 0 })
    );

    // Abort ambient controller while fetch is active
    setTimeout(() => {
      abortController.abort(new Error("Overall deadline reached"));
    }, 20);

    await expect(callPromise).rejects.toThrow(/actively aborted/i);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("records detailed HTTP attempt timings and outcomes into reviewDiagnosticsContext on transient retry and success", async () => {
    const { reviewDiagnosticsContext, ReviewDiagnosticsCollector } = await import(
      "../lib/request-context"
    );
    const collector = new ReviewDiagnosticsCollector(90000);
    const mockSleep = vi.fn().mockResolvedValue(undefined);

    let attemptCounter = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      attemptCounter++;
      if (attemptCounter === 1) {
        return {
          ok: false,
          status: 503,
          headers: { get: () => null },
          text: async () => "The service is temporarily unavailable",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '{"summary":"Diagnostics test","readiness_verdict":"Ready to build"}' }],
                role: "model",
              },
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await reviewDiagnosticsContext.run(collector, () =>
      callModel("sys", "user", { sleepFn: mockSleep, maxTransientRetries: 1 })
    );

    expect(result).toContain("Diagnostics test");
    expect(collector.httpAttempts.length).toBe(2);

    // Attempt 1: Transient 503
    expect(collector.httpAttempts[0].attempt).toBe(1);
    expect(collector.httpAttempts[0].status).toBe(503);
    expect(collector.httpAttempts[0].outcome).toBe("transient_retry");
    expect(collector.httpAttempts[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(collector.httpAttempts[0].backoff_ms).toBeDefined();

    // Attempt 2: Success 200
    expect(collector.httpAttempts[1].attempt).toBe(2);
    expect(collector.httpAttempts[1].status).toBe(200);
    expect(collector.httpAttempts[1].outcome).toBe("success");
    expect(collector.httpAttempts[1].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("caps retry-after delay to maxBackoffMs to prevent interactive deadline exhaustion", async () => {
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "60" : null) },
      text: async () => "Service busy, retry in 60s",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      callModel("sys", "user", {
        maxTransientRetries: 1,
        maxBackoffMs: 5000,
        sleepFn: mockSleep,
      })
    ).rejects.toThrow(/Gemini API call failed with status 503/);

    expect(mockSleep).toHaveBeenCalledOnce();
    const sleptMs = mockSleep.mock.calls[0][0];
    expect(sleptMs).toBeLessThanOrEqual(5000); // Must be capped, not 60000ms!
  });
});
