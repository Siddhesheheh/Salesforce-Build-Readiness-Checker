import { NextRequest, NextResponse } from "next/server";
import { reviewRequirement, SchemaValidationError } from "@/lib/review";
import { callModel, UpstreamApiError } from "@/lib/llm";
import { isRateLimited } from "@/lib/rate-limit";
import { ReviewErrorResponse } from "@/lib/types";
import { getMockReport } from "@/lib/mock-reports";

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";

    if (isRateLimited(clientIp)) {
      return NextResponse.json<ReviewErrorResponse>(
        { error: "rate_limited", message: "Rate limit exceeded. Please try again later." },
        { status: 429 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json<ReviewErrorResponse>(
        { error: "too_short", message: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const { requirement, org_context } = body || {};

    if (typeof requirement !== "string") {
      return NextResponse.json<ReviewErrorResponse>(
        { error: "too_short", message: "Requirement must be a string." },
        { status: 400 }
      );
    }

    const trimmedReq = requirement.trim();
    if (trimmedReq.length < 20) {
      return NextResponse.json<ReviewErrorResponse>(
        { error: "too_short", message: "Requirement must be at least 20 characters." },
        { status: 400 }
      );
    }

    if (trimmedReq.length > 6000) {
      return NextResponse.json<ReviewErrorResponse>(
        { error: "too_long", message: "Requirement exceeds maximum 6000 characters." },
        { status: 400 }
      );
    }

    if (org_context !== undefined && org_context !== null) {
      if (typeof org_context !== "string") {
        return NextResponse.json<ReviewErrorResponse>(
          { error: "too_long", message: "Org context must be a string." },
          { status: 400 }
        );
      }
      if (org_context.length > 2000) {
        return NextResponse.json<ReviewErrorResponse>(
          { error: "too_long", message: "Org context exceeds maximum 2000 characters." },
          { status: 400 }
        );
      }
    }

    // Check development/test mock mode (strictly disabled in production)
    const isNonProduction = process.env.NODE_ENV !== "production";
    const isMockRequested =
      isNonProduction &&
      (process.env.MOCK_REVIEW === "true" || req.headers.get("x-mock-review") === "true");

    if (isMockRequested) {
      // Simulate test error and timeout conditions if requested
      if (trimmedReq.includes("[TEST_TIMEOUT]")) {
        return NextResponse.json<ReviewErrorResponse>(
          {
            error: "review_failed",
            message: "The readiness review timed out. The upstream AI service took too long to respond. Please try again.",
          },
          { status: 504 }
        );
      }
      if (trimmedReq.includes("[TEST_RATE_LIMIT]")) {
        return NextResponse.json<ReviewErrorResponse>(
          {
            error: "rate_limited",
            message: "Rate limit reached on upstream AI service. Please wait before checking another requirement.",
          },
          { status: 429 }
        );
      }
      if (trimmedReq.includes("[TEST_ERROR]")) {
        return NextResponse.json<ReviewErrorResponse>(
          {
            error: "review_failed",
            message: "Failed to generate readiness review. The upstream AI service is temporarily unavailable or busy. Please retry.",
          },
          { status: 502 }
        );
      }

      const mockReport = getMockReport(trimmedReq);
      return NextResponse.json(mockReport, { status: 200 });
    }

    // Strict overall deadline for interactive reviews (90 seconds default)
    // Enforced across all Gemini HTTP attempts, schema retries, and backoff delays
    const overallDeadlineMs = Number(process.env.OVERALL_REVIEW_DEADLINE_MS) || 90000;
    let deadlineTimer: NodeJS.Timeout | null = null;

    const deadlinePromise = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(() => {
        const timeoutErr = new UpstreamApiError(
          "The readiness review timed out after 90 seconds. The upstream AI service took too long to respond. Please try again.",
          504
        );
        timeoutErr.name = "TimeoutError";
        reject(timeoutErr);
      }, overallDeadlineMs);
    });

    let report: any;
    try {
      report = await Promise.race([
        reviewRequirement(trimmedReq, org_context),
        deadlinePromise,
      ]);
    } finally {
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
      }
    }

    const latencyMs = Date.now() - startTime;

    // Log metadata only (never the requirement text or org context)
    console.log(
      JSON.stringify({
        event: "review_completed",
        req_length: trimmedReq.length,
        org_context_length: org_context ? org_context.length : 0,
        verdict: report.readiness_verdict,
        counts: report.counts,
        findings_count: report.findings.length,
        latency_ms: latencyMs,
      })
    );

    return NextResponse.json(report, { status: 200 });
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const errorCause = error?.cause?.code || error?.cause?.message || undefined;
    const sanitizedErrorMsg = (error?.message || "Unknown error").replace(/key=[a-zA-Z0-9_\-]+/gi, "key=[REDACTED]");

    console.error(
      JSON.stringify({
        event: "review_failed",
        latency_ms: latencyMs,
        error_name: error?.name,
        error_message: sanitizedErrorMsg,
        error_cause: errorCause,
        status_code: error?.statusCode,
      })
    );

    // Map error types to sanitized user-friendly responses
    const isTimeout =
      (error instanceof UpstreamApiError && error.statusCode === 504) ||
      error?.statusCode === 504 ||
      (error instanceof Error && (error.name === "TimeoutError" || /timed out|timeout/i.test(error.message)));

    const isRateLimited =
      (error instanceof UpstreamApiError && (error.statusCode === 429 || error.isRateLimited)) ||
      error?.statusCode === 429 ||
      (error instanceof Error && /rate limit|status 429/i.test(error.message));

    if (isRateLimited) {
      return NextResponse.json<ReviewErrorResponse>(
        {
          error: "rate_limited",
          message: "Rate limit reached on upstream AI service. Please wait before checking another requirement.",
        },
        { status: 429 }
      );
    }

    if (isTimeout) {
      return NextResponse.json<ReviewErrorResponse>(
        {
          error: "review_failed",
          message: "The readiness review timed out. The upstream AI service took too long to respond. Please try again.",
        },
        { status: 504 }
      );
    }

    if (error instanceof SchemaValidationError) {
      return NextResponse.json<ReviewErrorResponse>(
        {
          error: "review_failed",
          message: "Failed to generate a valid readiness review report. Please retry.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json<ReviewErrorResponse>(
      {
        error: "review_failed",
        message: "Failed to generate readiness review. The upstream AI service is temporarily unavailable or busy. Please retry.",
      },
      { status: 502 }
    );
  }
}
