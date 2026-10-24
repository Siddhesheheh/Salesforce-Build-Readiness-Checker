import { describe, it, expect } from "vitest";
import { computeVerdictAndCounts, buildUserPrompt, reviewRequirement } from "../lib/review";
import { ReadinessReport, Finding } from "../lib/types";

const mockCategoryStatus: ReadinessReport["category_status"] = [
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
];

function createMockFinding(partial: Partial<Finding>): Finding {
  return {
    id: 99,
    title: "Test finding",
    category: "Business rules",
    severity: "Minor",
    evidence: "Quote from requirement",
    whats_missing: "Missing threshold",
    why_it_matters: "Cannot build logic",
    question_for_pm: "What is the threshold?",
    verify_in_org: "Check org setup",
    ...partial,
  };
}

describe("lib/review: computeVerdictAndCounts", () => {
  it("forces verdict to 'Not ready to build' if any Blocker is present", () => {
    const report: ReadinessReport = {
      summary: "Sample summary",
      readiness_verdict: "Ready to build", // Model hallucinated Ready to build
      counts: { blockers: 0, important: 0, minor: 0, questions: 0 },
      category_status: mockCategoryStatus,
      findings: [
        createMockFinding({ severity: "Minor" }),
        createMockFinding({ severity: "Blocker" }),
      ],
    };

    const result = computeVerdictAndCounts(report);
    expect(result.readiness_verdict).toBe("Not ready to build");
    expect(result.counts.blockers).toBe(1);
    expect(result.counts.minor).toBe(1);
    expect(result.counts.important).toBe(0);
    expect(result.counts.questions).toBe(2);
  });

  it("forces verdict to 'Needs clarification' if no Blockers but at least one Important", () => {
    const report: ReadinessReport = {
      summary: "Sample summary",
      readiness_verdict: "Not ready to build", // Model erroneously set Not ready
      counts: { blockers: 5, important: 0, minor: 0, questions: 0 },
      category_status: mockCategoryStatus,
      findings: [
        createMockFinding({ severity: "Important" }),
        createMockFinding({ severity: "Minor" }),
      ],
    };

    const result = computeVerdictAndCounts(report);
    expect(result.readiness_verdict).toBe("Needs clarification");
    expect(result.counts.blockers).toBe(0);
    expect(result.counts.important).toBe(1);
    expect(result.counts.minor).toBe(1);
    expect(result.counts.questions).toBe(2);
  });

  it("forces verdict to 'Ready to build' if only Minor or zero findings", () => {
    const reportWithMinor: ReadinessReport = {
      summary: "Sample summary",
      readiness_verdict: "Needs clarification",
      counts: { blockers: 0, important: 2, minor: 0, questions: 0 },
      category_status: mockCategoryStatus,
      findings: [createMockFinding({ severity: "Minor" })],
    };

    const resultMinor = computeVerdictAndCounts(reportWithMinor);
    expect(resultMinor.readiness_verdict).toBe("Ready to build");
    expect(resultMinor.counts.minor).toBe(1);

    const reportEmpty: ReadinessReport = {
      summary: "Sample summary",
      readiness_verdict: "Not ready to build",
      counts: { blockers: 1, important: 1, minor: 1, questions: 3 },
      category_status: mockCategoryStatus,
      findings: [],
    };

    const resultEmpty = computeVerdictAndCounts(reportEmpty);
    expect(resultEmpty.readiness_verdict).toBe("Ready to build");
    expect(resultEmpty.counts.blockers).toBe(0);
    expect(resultEmpty.counts.questions).toBe(0);
  });

  it("sorts findings Blocker > Important > Minor and renumbers IDs starting from 1", () => {
    const report: ReadinessReport = {
      summary: "Sample summary",
      readiness_verdict: "Ready to build",
      counts: { blockers: 0, important: 0, minor: 0, questions: 0 },
      category_status: mockCategoryStatus,
      findings: [
        createMockFinding({ title: "Minor finding", severity: "Minor", id: 50 }),
        createMockFinding({ title: "Blocker finding", severity: "Blocker", id: 70 }),
        createMockFinding({ title: "Important finding", severity: "Important", id: 10 }),
      ],
    };

    const result = computeVerdictAndCounts(report);
    expect(result.findings[0].severity).toBe("Blocker");
    expect(result.findings[0].id).toBe(1);

    expect(result.findings[1].severity).toBe("Important");
    expect(result.findings[1].id).toBe(2);

    expect(result.findings[2].severity).toBe("Minor");
    expect(result.findings[2].id).toBe(3);
  });
});

describe("lib/review: buildUserPrompt", () => {
  it("formats user prompt with requirement and org context", () => {
    const prompt = buildUserPrompt("Valid requirement text", "Some existing flows");
    expect(prompt).toBe("REQUIREMENT:\nValid requirement text\n\nORG CONTEXT:\nSome existing flows");
  });

  it("uses 'None provided' when org context is absent or whitespace", () => {
    const prompt1 = buildUserPrompt("Valid requirement text");
    expect(prompt1).toBe("REQUIREMENT:\nValid requirement text\n\nORG CONTEXT:\nNone provided");

    const prompt2 = buildUserPrompt("Valid requirement text", "   ");
    expect(prompt2).toBe("REQUIREMENT:\nValid requirement text\n\nORG CONTEXT:\nNone provided");
  });
});

describe("lib/review: reviewRequirement execution and retry logic", () => {
  const validReportJson = JSON.stringify({
    summary: "Mock report",
    readiness_verdict: "Ready to build",
    counts: { blockers: 0, important: 0, minor: 1, questions: 1 },
    category_status: mockCategoryStatus,
    findings: [createMockFinding({ id: 1, severity: "Minor" })],
  });

  it("succeeds on first attempt when valid JSON matching schema is returned", async () => {
    let callCount = 0;
    const mockCaller = async () => {
      callCount++;
      return validReportJson;
    };

    const report = await reviewRequirement("Test requirement text here", undefined, mockCaller);
    expect(callCount).toBe(1);
    expect(report.readiness_verdict).toBe("Ready to build");
    expect(report.findings.length).toBe(1);
  });

  it("retries once if first attempt returns invalid JSON, and succeeds on second attempt", async () => {
    let callCount = 0;
    const mockCaller = async () => {
      callCount++;
      if (callCount === 1) {
        return "NOT VALID JSON";
      }
      return validReportJson;
    };

    const report = await reviewRequirement("Test requirement text here", undefined, mockCaller);
    expect(callCount).toBe(2);
    expect(report.readiness_verdict).toBe("Ready to build");
  });

  it("retries once if first attempt fails schema validation, and succeeds on second attempt", async () => {
    let callCount = 0;
    const invalidSchemaJson = JSON.stringify({
      summary: "Missing required properties",
    });

    const mockCaller = async () => {
      callCount++;
      if (callCount === 1) {
        return invalidSchemaJson;
      }
      return validReportJson;
    };

    const report = await reviewRequirement("Test requirement text here", undefined, mockCaller);
    expect(callCount).toBe(2);
    expect(report.readiness_verdict).toBe("Ready to build");
  });

  it("throws error when both attempts fail schema validation", async () => {
    let callCount = 0;
    const mockCaller = async () => {
      callCount++;
      return "Malformed JSON every time";
    };

    await expect(
      reviewRequirement("Test requirement text here", undefined, mockCaller)
    ).rejects.toThrow(/Report validation failed against schema\.json/);
    expect(callCount).toBe(2);
  });
});
