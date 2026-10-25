import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/review/route";
import { resetRateLimiter } from "../lib/rate-limit";
import * as reviewModule from "../lib/review";
import { ReadinessReport } from "../lib/types";
import { UpstreamApiError } from "../lib/llm";

function createNextRequest(body: any, headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/review", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const mockReport: ReadinessReport = {
  summary: "Valid mock report",
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
};

describe("POST /api/review route", () => {
  beforeEach(() => {
    resetRateLimiter();
    vi.restoreAllMocks();
  });

  it("returns 400 too_short if requirement is less than 20 characters", async () => {
    const req = createNextRequest({ requirement: "Short text" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("too_short");
  });

  it("returns 400 too_short if requirement is missing or empty", async () => {
    const req = createNextRequest({});
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("too_short");
  });

  it("returns 400 too_short if request body is malformed JSON", async () => {
    const req = new NextRequest("http://localhost:3000/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid-json{",
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("too_short");
  });

  it("returns 400 too_long if requirement exceeds 6000 characters", async () => {
    const req = createNextRequest({
      requirement: "A".repeat(6001),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("too_long");
  });

  it("returns 400 too_long if org_context exceeds 2000 characters", async () => {
    const req = createNextRequest({
      requirement: "Valid requirement length that is over twenty characters.",
      org_context: "B".repeat(2001),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("too_long");
  });

  it("returns 200 with report when input is valid and review succeeds", async () => {
    const spy = vi.spyOn(reviewModule, "reviewRequirement").mockResolvedValue(mockReport);

    const req = createNextRequest({
      requirement: "This is a valid requirement text exceeding twenty characters.",
      org_context: "Optional org context here.",
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.readiness_verdict).toBe("Ready to build");
    expect(spy).toHaveBeenCalledWith(
      "This is a valid requirement text exceeding twenty characters.",
      "Optional org context here."
    );
  });

  it("returns 502 review_failed when reviewRequirement throws an error", async () => {
    vi.spyOn(reviewModule, "reviewRequirement").mockRejectedValue(new Error("Upstream failed"));

    const req = createNextRequest({
      requirement: "This is a valid requirement text exceeding twenty characters.",
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.error).toBe("review_failed");
  });

  it("enforces rate limit of 10 requests per hour per IP and returns 429 rate_limited", async () => {
    vi.spyOn(reviewModule, "reviewRequirement").mockResolvedValue(mockReport);

    const testIp = "192.168.1.100";
    const headers = { "x-forwarded-for": testIp };

    // Send 10 allowed requests
    for (let i = 0; i < 10; i++) {
      const req = createNextRequest(
        { requirement: "Valid requirement text exceeding twenty characters." },
        headers
      );
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    // 11th request exceeds limit
    const limitedReq = createNextRequest(
      { requirement: "Valid requirement text exceeding twenty characters." },
      headers
    );
    const limitedRes = await POST(limitedReq);
    const limitedData = await limitedRes.json();

    expect(limitedRes.status).toBe(429);
    expect(limitedData.error).toBe("rate_limited");
    expect(limitedData.message).toMatch(/Rate limit exceeded/);

    // Different IP is not affected
    const otherIpReq = createNextRequest(
      { requirement: "Valid requirement text exceeding twenty characters." },
      { "x-forwarded-for": "192.168.1.200" }
    );
    const otherIpRes = await POST(otherIpReq);
    expect(otherIpRes.status).toBe(200);

    // Resetting state clears rate limits deterministically
    resetRateLimiter();
    const afterResetRes = await POST(limitedReq);
    expect(afterResetRes.status).toBe(200);
  });

  it("handles development mock mode and returns schema-compliant report", async () => {
    const req = createNextRequest(
      { requirement: "Valid requirement text exceeding twenty characters." },
      { "x-mock-review": "true" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.readiness_verdict).toBeDefined();
    expect(data.category_status.length).toBe(10);
    expect(data.counts).toBeDefined();
    expect(data.findings).toBeDefined();
  });

  it("handles simulated test error conditions in development mock mode", async () => {
    // 1. Timeout simulation
    const timeoutReq = createNextRequest(
      { requirement: "Testing timeout condition with [TEST_TIMEOUT] flag." },
      { "x-mock-review": "true" }
    );
    const timeoutRes = await POST(timeoutReq);
    expect(timeoutRes.status).toBe(504);

    // 2. Rate limit simulation
    const rateLimitReq = createNextRequest(
      { requirement: "Testing rate limit condition with [TEST_RATE_LIMIT] flag." },
      { "x-mock-review": "true" }
    );
    const rateLimitRes = await POST(rateLimitReq);
    expect(rateLimitRes.status).toBe(429);

    // 3. Upstream failure simulation
    const errorReq = createNextRequest(
      { requirement: "Testing error condition with [TEST_ERROR] flag." },
      { "x-mock-review": "true" }
    );
    const errorRes = await POST(errorReq);
    expect(errorRes.status).toBe(502);
  });

  it("strictly disables mock mode in production environment", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = "production";
      vi.spyOn(reviewModule, "reviewRequirement").mockResolvedValue(mockReport);

      const req = createNextRequest(
        { requirement: "Valid requirement text exceeding twenty characters." },
        { "x-mock-review": "true" }
      );
      const res = await POST(req);

      // In production, x-mock-review is ignored and real reviewRequirement is invoked
      expect(reviewModule.reviewRequirement).toHaveBeenCalled();
      expect(res.status).toBe(200);
    } finally {
      (process.env as any).NODE_ENV = originalEnv;
    }
  });

  it("maps upstream UpstreamApiError with status 504 or timeout to 504 review_failed", async () => {
    const timeoutError = new UpstreamApiError("Gemini API request timed out after 25s", 504);

    vi.spyOn(reviewModule, "reviewRequirement").mockRejectedValue(timeoutError);

    const req = createNextRequest({
      requirement: "Valid requirement text exceeding twenty characters.",
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(504);
    expect(data.error).toBe("review_failed");
    expect(data.message).toMatch(/timed out/i);
  });

  it("enforces strict overall deadline across review and returns 504 when exceeded", async () => {
    const originalDeadline = process.env.OVERALL_REVIEW_DEADLINE_MS;
    try {
      // Set short deadline of 40ms for testing
      process.env.OVERALL_REVIEW_DEADLINE_MS = "40";

      // Mock reviewRequirement to take 100ms
      vi.spyOn(reviewModule, "reviewRequirement").mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockReport), 100))
      );

      const req = createNextRequest({
        requirement: "Valid requirement text exceeding twenty characters.",
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(504);
      expect(data.error).toBe("review_failed");
      expect(data.message).toMatch(/timed out after 90 seconds|timed out/i);
    } finally {
      process.env.OVERALL_REVIEW_DEADLINE_MS = originalDeadline;
    }
  });

  it("never exposes API keys or sensitive system details in client error responses", async () => {
    const sensitiveError = new Error(
      "Upstream request failed with key=AIzaSySecretApiKey12345 at internal URL /secret/v1/private"
    );
    vi.spyOn(reviewModule, "reviewRequirement").mockRejectedValue(sensitiveError);

    const req = createNextRequest({
      requirement: "Valid requirement text exceeding twenty characters.",
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.error).toBe("review_failed");
    // Ensure no API keys or stack traces leaked in message
    expect(JSON.stringify(data)).not.toContain("AIzaSySecretApiKey12345");
    expect(JSON.stringify(data)).not.toContain("key=");
    expect(JSON.stringify(data)).not.toContain("stack");
  });
});
