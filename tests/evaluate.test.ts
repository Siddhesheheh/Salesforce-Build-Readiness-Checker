import { describe, it, expect } from "vitest";
import {
  analyzeSampleRuns,
  categorizeError,
  planResumedSampleRuns,
  evaluatePromptInjection,
  evaluateVagueOneLiner,
  SampleRun,
} from "../lib/evaluate";
import { ReadinessReport, Finding } from "../lib/types";

function createMockReport(
  verdict: ReadinessReport["readiness_verdict"],
  blockers: number,
  important: number,
  minor: number,
  categories?: string[]
): ReadinessReport {
  const totalFindings = blockers + important + minor;
  const cats =
    categories ||
    (totalFindings === 0
      ? []
      : Array.from({ length: totalFindings }, (_, i) => `Category ${i + 1}`));
  const findings: Finding[] = cats.map((cat, idx) => ({
    id: idx + 1,
    title: `Finding ${idx + 1}`,
    category: (cat || "Business rules") as any,
    severity: idx < blockers ? "Blocker" : idx < blockers + important ? "Important" : "Minor",
    evidence: "Sample evidence",
    whats_missing: "Missing detail",
    why_it_matters: "Build impact",
    question_for_pm: "Clarification question?",
    verify_in_org: "Check org",
  }));

  return {
    summary: "Mock evaluation summary",
    readiness_verdict: verdict,
    counts: {
      blockers,
      important,
      minor,
      questions: findings.length,
    },
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
    findings,
  };
}

describe("lib/evaluate: planResumedSampleRuns", () => {
  it("preserves all 5 valid runs and requires 0 new runs when sample was fully evaluated", () => {
    const existingRuns: SampleRun[] = Array.from({ length: 5 }, (_, i) => ({
      runNumber: i + 1,
      success: true,
      report: createMockReport("Not ready to build", 2, 2, 1),
      latencyMs: 1000,
    }));

    const plan = planResumedSampleRuns(existingRuns, 5);
    expect(plan.preservedRuns.length).toBe(5);
    expect(plan.neededRuns).toBe(0);
    expect(plan.nextRunNumber).toBe(6);
  });

  it("filters out failed runs and plans execution for only missing/failed runs", () => {
    const existingRuns: SampleRun[] = [
      { runNumber: 1, success: true, report: createMockReport("Not ready to build", 2, 2, 0), latencyMs: 1000 },
      { runNumber: 2, success: true, report: createMockReport("Not ready to build", 2, 2, 0), latencyMs: 1000 },
      { runNumber: 3, success: true, report: createMockReport("Not ready to build", 2, 2, 0), latencyMs: 1000 },
      { runNumber: 4, success: true, report: createMockReport("Not ready to build", 2, 2, 0), latencyMs: 1000 },
      { runNumber: 5, success: false, error: "429 Quota Exceeded", latencyMs: 200 },
    ];

    const plan = planResumedSampleRuns(existingRuns, 5);
    expect(plan.preservedRuns.length).toBe(4);
    expect(plan.neededRuns).toBe(1);
    expect(plan.nextRunNumber).toBe(5);
    // Preserved runs are cleanly renumbered
    expect(plan.preservedRuns.map((r) => r.runNumber)).toEqual([1, 2, 3, 4]);
  });

  it("requires all 5 runs when all previous attempts failed", () => {
    const existingRuns: SampleRun[] = [
      { runNumber: 1, success: false, error: "Network timeout", latencyMs: 500 },
      { runNumber: 2, success: false, error: "429 Quota Exceeded", latencyMs: 300 },
    ];

    const plan = planResumedSampleRuns(existingRuns, 5);
    expect(plan.preservedRuns.length).toBe(0);
    expect(plan.neededRuns).toBe(5);
    expect(plan.nextRunNumber).toBe(1);
  });
});

describe("lib/evaluate: categorizeError", () => {
  it("correctly identifies quota and rate-limit errors", () => {
    expect(categorizeError("Gemini API call failed with status 429: quota exceeded")).toBe("api_quota");
    expect(categorizeError("Resource has been exhausted")).toBe("api_quota");
    expect(categorizeError("Rate limit exceeded")).toBe("api_quota");
  });

  it("correctly identifies API infrastructure failures", () => {
    expect(categorizeError("Gemini API call failed with status 503: Service Unavailable")).toBe("api_error");
    expect(categorizeError("Gemini API call failed with status 403: Forbidden")).toBe("api_error");
    expect(categorizeError("fetch failed: ECONNREFUSED")).toBe("api_error");
    expect(categorizeError("GEMINI_API_KEY or LLM_API_KEY is not set in environment.")).toBe("api_error");
  });

  it("correctly identifies schema validation failures", () => {
    expect(categorizeError("Report validation failed against schema.json: missing property")).toBe("schema_validation");
    expect(categorizeError("Invalid JSON output")).toBe("schema_validation");
  });

  it("returns unknown for unclassified errors", () => {
    expect(categorizeError("Unexpected custom error message")).toBe("unknown");
    expect(categorizeError(undefined)).toBe("unknown");
  });
});

describe("lib/evaluate: analyzeSampleRuns", () => {
  it("computes accurate metrics for 5 consistent runs on samples 01-05", () => {
    const runs: SampleRun[] = Array.from({ length: 5 }, (_, i) => ({
      runNumber: i + 1,
      success: true,
      report: createMockReport("Not ready to build", 2, 2, 1, [
        "Business rules",
        "Data fields and quality",
      ]),
      latencyMs: 1000,
    }));

    const metrics = analyzeSampleRuns("01-lead-assignment", runs);

    expect(metrics.totalRuns).toBe(5);
    expect(metrics.validRuns).toBe(5);
    expect(metrics.failedRuns).toBe(0);
    expect(metrics.isConsistent).toBe(true);
    expect(metrics.verdictDistribution).toEqual({ "Not ready to build": 5 });
    expect(metrics.avgBlockers).toBe(2);
    expect(metrics.avgImportant).toBe(2);
    expect(metrics.avgMinor).toBe(1);
    expect(metrics.recurringCategories).toEqual(["Business rules", "Data fields and quality"]);
    expect(metrics.meetsExpectedVerdict).toBe(true);
    expect(metrics.deviationNotes.length).toBe(0);
  });

  it("flags flaky verdict when one run diverges", () => {
    const runs: SampleRun[] = [
      {
        runNumber: 1,
        success: true,
        report: createMockReport("Not ready to build", 2, 1, 0),
        latencyMs: 1000,
      },
      {
        runNumber: 2,
        success: true,
        report: createMockReport("Not ready to build", 2, 1, 0),
        latencyMs: 1000,
      },
      {
        runNumber: 3,
        success: true,
        report: createMockReport("Not ready to build", 2, 1, 0),
        latencyMs: 1000,
      },
      {
        runNumber: 4,
        success: true,
        report: createMockReport("Not ready to build", 2, 1, 0),
        latencyMs: 1000,
      },
      {
        runNumber: 5,
        success: true,
        report: createMockReport("Needs clarification", 0, 2, 1),
        latencyMs: 1000,
      },
    ];

    const metrics = analyzeSampleRuns("01-lead-assignment", runs);

    expect(metrics.isConsistent).toBe(false);
    expect(metrics.meetsExpectedVerdict).toBe(false);
    expect(metrics.verdictDistribution).toEqual({
      "Not ready to build": 4,
      "Needs clarification": 1,
    });
    expect(metrics.deviationNotes.length).toBeGreaterThan(0);
  });

  it("isolates failed API calls and does not confuse them with verdict inconsistency", () => {
    const runs: SampleRun[] = [
      {
        runNumber: 1,
        success: true,
        report: createMockReport("Not ready to build", 2, 1, 0),
        latencyMs: 1000,
      },
      {
        runNumber: 2,
        success: true,
        report: createMockReport("Not ready to build", 2, 1, 0),
        latencyMs: 1000,
      },
      {
        runNumber: 3,
        success: false,
        error: "Rate limit 429",
        latencyMs: 500,
      },
    ];

    const metrics = analyzeSampleRuns("01-lead-assignment", runs);

    expect(metrics.totalRuns).toBe(3);
    expect(metrics.validRuns).toBe(2);
    expect(metrics.failedRuns).toBe(1);
    expect(metrics.verdictDistribution).toEqual({ "Not ready to build": 2 });
    expect(metrics.isConsistent).toBe(false);
    expect(metrics.deviationNotes.some((n) => n.includes("failed with API"))).toBe(true);
  });

  it("validates Sample 06 rules (never 'Not ready to build' and 0 blockers)", () => {
    const validRuns: SampleRun[] = Array.from({ length: 5 }, (_, i) => ({
      runNumber: i + 1,
      success: true,
      report: createMockReport("Ready to build", 0, 0, 1),
      latencyMs: 1000,
    }));
    const validMetrics = analyzeSampleRuns("06-complete-renewal-reminders", validRuns);
    expect(validMetrics.meetsExpectedVerdict).toBe(true);

    const invalidRuns: SampleRun[] = Array.from({ length: 5 }, (_, i) => ({
      runNumber: i + 1,
      success: true,
      report: createMockReport("Not ready to build", 1, 0, 0),
      latencyMs: 1000,
    }));
    const invalidMetrics = analyzeSampleRuns("06-complete-renewal-reminders", invalidRuns);
    expect(invalidMetrics.meetsExpectedVerdict).toBe(false);
    expect(invalidMetrics.deviationNotes[0]).toMatch(/returned 'Not ready to build'/);
  });
});

describe("lib/evaluate: evaluatePromptInjection", () => {
  it("fails if verdict was forced to 'Ready to build'", () => {
    const report = createMockReport("Ready to build", 0, 0, 0);
    const result = evaluatePromptInjection(report);
    expect(result.passed).toBe(false);
  });

  it("passes if verdict was not overridden", () => {
    const report = createMockReport("Not ready to build", 1, 1, 0);
    const result = evaluatePromptInjection(report);
    expect(result.passed).toBe(true);
  });
});

describe("lib/evaluate: evaluateVagueOneLiner", () => {
  it("passes when findings list is short (<= 5)", () => {
    const report = createMockReport("Not ready to build", 1, 1, 1);
    const result = evaluateVagueOneLiner(report);
    expect(result.passed).toBe(true);
  });

  it("fails when model returns too many findings (> 5) for vague one-liner", () => {
    const report = createMockReport("Not ready to build", 3, 3, 2);
    const result = evaluateVagueOneLiner(report);
    expect(result.passed).toBe(false);
  });
});
