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
});
