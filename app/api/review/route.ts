import { NextRequest, NextResponse } from "next/server";
import { reviewRequirement } from "@/lib/review";
import { isRateLimited } from "@/lib/rate-limit";
import { ReviewErrorResponse } from "@/lib/types";

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

    const report = await reviewRequirement(trimmedReq, org_context);
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
    console.error(
      JSON.stringify({
        event: "review_failed",
        latency_ms: latencyMs,
        error_name: error?.name,
        error_message: error?.message,
      })
    );

    return NextResponse.json<ReviewErrorResponse>(
      { error: "review_failed", message: "Failed to generate readiness review." },
      { status: 502 }
    );
  }
}
