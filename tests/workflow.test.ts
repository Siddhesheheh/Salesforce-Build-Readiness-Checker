import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildRecheckInput, compareVersions } from "../lib/workflow-recheck";
import {
  saveSession,
  loadSession,
  clearSession,
  exportSessionToJson,
  STORAGE_KEY,
} from "../lib/workflow-storage";
import {
  ReviewSession,
  ReviewVersion,
  FindingFeedback,
  OverallFeedback,
  THUMBS_DOWN_REASONS,
} from "../lib/workflow-types";
import { ReadinessReport, Finding } from "../lib/types";
import { getMockReport } from "../lib/mock-reports";

const sampleFindings: Finding[] = [
  {
    id: 1,
    title: "Missing fallback queue for leads",
    category: "Business rules",
    severity: "Blocker",
    evidence: "New leads should be assigned automatically based on region.",
    whats_missing: "No fallback queue defined for unmapped regions.",
    why_it_matters: "Flow will fault if no region matches.",
    question_for_pm: "Which queue should receive unassigned leads?",
    verify_in_org: "Check Setup > Lead Queues.",
  },
  {
    id: 2,
    title: "Undefined Region field mapping",
    category: "Data model and relationships",
    severity: "Important",
    evidence: "Leads should be assigned based on their region.",
    whats_missing: "Picklist values are unstated.",
    why_it_matters: "Routing rules cannot be built.",
    question_for_pm: "What are the allowed region values?",
    verify_in_org: "",
  },
];

const mockReportV1: ReadinessReport = {
  summary: "Initial review with 1 Blocker and 1 Important finding.",
  readiness_verdict: "Not ready to build",
  counts: { blockers: 1, important: 1, minor: 0, questions: 2 },
  category_status: [
    { category: "Business rules", status: "Missing" },
    { category: "Data model and relationships", status: "Partial" },
    { category: "Data fields and quality", status: "Covered" },
    { category: "Access, permissions and test access", status: "Covered" },
    { category: "Exceptions and edge cases", status: "Covered" },
    { category: "Automation behavior", status: "Covered" },
    { category: "Current process and existing org impact", status: "Covered" },
    { category: "Integrations, migration and scale", status: "Not applicable" },
    { category: "Reporting and visibility", status: "Covered" },
    { category: "Acceptance and sign-off", status: "Covered" },
  ],
  findings: sampleFindings,
};

const mockReportV2: ReadinessReport = {
  summary: "Recheck review with Blockers resolved.",
  readiness_verdict: "Needs clarification",
  counts: { blockers: 0, important: 1, minor: 0, questions: 1 },
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
  findings: [sampleFindings[1]],
};

describe("Workflow: Recheck Input Construction & Validation (Part D)", () => {
  const originalReq = "User Story: Automatic Lead Assignment\nAs a Sales Manager, I want new leads assigned automatically.";

  it("requires at least one answered question and returns error when empty", () => {
    const resultNoAnswers = buildRecheckInput(originalReq, {}, sampleFindings);
    expect(resultNoAnswers.error).toMatch(/At least one answered clarification question is required/);
    expect(resultNoAnswers.answersCount).toBe(0);

    const resultBlankAnswers = buildRecheckInput(
      originalReq,
      { 1: { findingId: 1, question: "Q1", answerText: "   ", updatedAt: "2026-10-25" } },
      sampleFindings
    );
    expect(resultBlankAnswers.error).toMatch(/At least one answered clarification question is required/);
    expect(resultBlankAnswers.answersCount).toBe(0);
  });

  it("constructs labeled consolidation containing original requirement and user answers", () => {
    const answers = {
      1: {
        findingId: 1,
        question: "Which queue should receive unassigned leads?",
        answerText: "Route unassigned leads to Central Triage Queue with Tier 1 profile.",
        updatedAt: "2026-10-25T12:00:00Z",
      },
    };

    const result = buildRecheckInput(originalReq, answers, sampleFindings);
    expect(result.error).toBeUndefined();
    expect(result.answersCount).toBe(1);

    // Original text preserved
    expect(result.text).toContain(originalReq);
    // User clarifications section clearly labeled
    expect(result.text).toContain("=== USER CLARIFICATIONS & DECISIONS ===");
    expect(result.text).toContain("Finding #1: Missing fallback queue for leads (Business rules)");
    expect(result.text).toContain("Question: Which queue should receive unassigned leads?");
    expect(result.text).toContain("User Decision / Clarification: Route unassigned leads to Central Triage Queue with Tier 1 profile.");
  });

  it("enforces 6,000 character limit without silent truncation and returns validation error", () => {
    const longOriginalReq = "A".repeat(5500);
    const longAnswer = "B".repeat(600); // 5500 + 600 > 6000

    const answers = {
      1: {
        findingId: 1,
        question: "Which queue?",
        answerText: longAnswer,
        updatedAt: "2026-10-25",
      },
    };

    const result = buildRecheckInput(longOriginalReq, answers, sampleFindings);
    expect(result.error).toMatch(/exceed maximum 6,000 characters/);
    expect(result.text.length).toBeGreaterThan(6000);
  });
});

describe("Workflow: Version Comparison (Part E)", () => {
  const version1: ReviewVersion = {
    versionNumber: 1,
    timestamp: "2026-10-25T10:00:00Z",
    submittedRequirement: "Original requirement",
    report: mockReportV1,
    findingFeedback: {},
    answers: {},
  };

  const version2: ReviewVersion = {
    versionNumber: 2,
    timestamp: "2026-10-25T10:15:00Z",
    submittedRequirement: "Original requirement with answers",
    report: mockReportV2,
    findingFeedback: {},
    answers: {},
    parentVersionNumber: 1,
  };

  it("calculates verdict transition and count differences accurately", () => {
    const comp = compareVersions(version1, version2);

    expect(comp.previousVersionNumber).toBe(1);
    expect(comp.currentVersionNumber).toBe(2);
    expect(comp.previousVerdict).toBe("Not ready to build");
    expect(comp.currentVerdict).toBe("Needs clarification");
    expect(comp.verdictChanged).toBe(true);

    // Blockers decreased by 1 (1 -> 0 = -1)
    expect(comp.countDiffs.blockers).toBe(-1);
    // Important unchanged (1 -> 1 = 0)
    expect(comp.countDiffs.important).toBe(0);
    // Questions decreased by 1 (2 -> 1 = -1)
    expect(comp.countDiffs.questions).toBe(-1);
  });

  it("tracks category coverage status improvements across versions", () => {
    const comp = compareVersions(version1, version2);

    const businessRulesDiff = comp.categoryDiffs.find((c) => c.category === "Business rules");
    expect(businessRulesDiff).toBeDefined();
    expect(businessRulesDiff?.previousStatus).toBe("Missing");
    expect(businessRulesDiff?.currentStatus).toBe("Covered");
    expect(businessRulesDiff?.changed).toBe(true);

    const dataModelDiff = comp.categoryDiffs.find((c) => c.category === "Data model and relationships");
    expect(dataModelDiff?.previousStatus).toBe("Partial");
    expect(dataModelDiff?.currentStatus).toBe("Covered");
    expect(dataModelDiff?.changed).toBe(true);
  });
});

describe("Workflow: Local Storage & Export (Part F)", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const testSession: ReviewSession = {
    sessionId: "test-session-123",
    originalRequirement: "User story lead assignment",
    versions: [
      {
        versionNumber: 1,
        timestamp: "2026-10-25T10:00:00Z",
        submittedRequirement: "User story lead assignment",
        report: mockReportV1,
        findingFeedback: {
          1: {
            findingId: 1,
            rating: "useful",
            updatedAt: "2026-10-25T10:05:00Z",
          },
          2: {
            findingId: 2,
            rating: "not_useful",
            reason: "Wrong severity",
            comment: "Should be Minor rather than Important",
            updatedAt: "2026-10-25T10:06:00Z",
          },
        },
        answers: {
          1: {
            findingId: 1,
            question: "Which queue?",
            answerText: "Central Triage Queue",
            updatedAt: "2026-10-25T10:07:00Z",
          },
        },
        overallFeedback: {
          identifiedNewGap: "yes",
          wouldUseBeforeKickoff: "yes",
          comments: "Very helpful for catching the missing fallback queue.",
          updatedAt: "2026-10-25T10:08:00Z",
        },
      },
    ],
    currentVersionNumber: 1,
    createdAt: "2026-10-25T10:00:00Z",
    updatedAt: "2026-10-25T10:08:00Z",
  };

  it("saves and reloads session cleanly from localStorage", () => {
    expect(saveSession(testSession)).toBe(true);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe("test-session-123");
    expect(loaded?.versions.length).toBe(1);
    expect(loaded?.versions[0].answers[1].answerText).toBe("Central Triage Queue");
  });

  it("handles corrupted or invalid localStorage data gracefully without throwing", () => {
    mockStorage[STORAGE_KEY] = "invalid json {[[";
    const loadedCorrupt = loadSession();
    expect(loadedCorrupt).toBeNull();

    mockStorage[STORAGE_KEY] = JSON.stringify({ notASession: true });
    const loadedInvalidStructure = loadSession();
    expect(loadedInvalidStructure).toBeNull();
  });

  it("clears session cleanly", () => {
    saveSession(testSession);
    expect(loadSession()).not.toBeNull();
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it("exports valid JSON with metadata, versions, answers, feedback ratings, and security warning notice", () => {
    const jsonStr = exportSessionToJson(testSession);
    const parsed = JSON.parse(jsonStr);

    expect(parsed._exportNotice).toMatch(/WARNING: This file contains user requirements/);
    expect(parsed.sessionId).toBe("test-session-123");
    expect(parsed.totalVersions).toBe(1);
    expect(parsed.versions[0].readinessVerdict).toBe("Not ready to build");
    expect(parsed.versions[0].userAnswers.length).toBe(1);
    expect(parsed.versions[0].userAnswers[0].answerText).toBe("Central Triage Queue");
    expect(parsed.versions[0].findingFeedback.length).toBe(2);
    expect(parsed.versions[0].findingFeedback[1].reason).toBe("Wrong severity");
    expect(parsed.versions[0].overallFeedback.identifiedNewGap).toBe("yes");
  });
});

describe("Workflow: Offline Mock Mode Recheck & Guardrails (Part G)", () => {
  it("getMockReport returns deterministic Version 2 report when user clarifications are provided", () => {
    const clarifiedRequirement =
      "User story lead assignment\n\n=== USER CLARIFICATIONS & DECISIONS ===\n- Finding #1: Central Triage Queue";
    const reportV2 = getMockReport(clarifiedRequirement);

    expect(reportV2.readiness_verdict).toBe("Needs clarification");
    expect(reportV2.counts.blockers).toBe(0); // Blockers eliminated!
    expect(reportV2.counts.important).toBe(1);
    expect(reportV2.summary).toContain("User clarifications resolved the regional fallback queue");
    expect(reportV2.summary).toContain("[SIMULATED PREVIEW — OFFLINE MOCK DATA]");
  });

  it("defines standard reasons for thumbs-down feedback", () => {
    expect(THUMBS_DOWN_REASONS).toContain("Already covered in requirement");
    expect(THUMBS_DOWN_REASONS).toContain("Incorrect finding");
    expect(THUMBS_DOWN_REASONS).toContain("Not relevant");
    expect(THUMBS_DOWN_REASONS).toContain("Wrong severity");
    expect(THUMBS_DOWN_REASONS).toContain("Too vague or unclear");
    expect(THUMBS_DOWN_REASONS).toContain("Other");
  });
});

describe("Workflow: Failure Resilience (Prompt D / Task 7)", () => {
  it("preserves user answers, feedback, and review history when a recheck fails", () => {
    const existingSession: ReviewSession = {
      sessionId: "session_failure_test",
      originalRequirement: "Original specification text with at least twenty characters.",
      versions: [
        {
          versionNumber: 1,
          timestamp: "2026-10-25T10:00:00Z",
          submittedRequirement: "Original specification text with at least twenty characters.",
          report: mockReportV1,
          findingFeedback: {
            1: { findingId: 1, rating: "not_useful", reason: "Wrong severity", comment: "Should be Important", updatedAt: "2026-10-25T10:05:00Z" },
          },
          answers: {
            1: {
              findingId: 1,
              question: "Which queue should receive unassigned leads?",
              answerText: "Central Triage Queue",
              updatedAt: "2026-10-25T10:05:00Z",
            },
          },
          overallFeedback: { identifiedNewGap: "yes", wouldUseBeforeKickoff: "yes", updatedAt: "2026-10-25T10:05:00Z" },
        },
      ],
      currentVersionNumber: 1,
      createdAt: "2026-10-25T10:00:00Z",
      updatedAt: "2026-10-25T10:05:00Z",
    };

    saveSession(existingSession);

    // Verify that session state remains intact with all user clarifications and ratings
    const reloaded = loadSession();
    expect(reloaded).not.toBeNull();
    expect(reloaded?.versions.length).toBe(1);
    expect(reloaded?.versions[0].answers[1].answerText).toBe("Central Triage Queue");
    expect(reloaded?.versions[0].findingFeedback[1].rating).toBe("not_useful");
    expect(reloaded?.versions[0].overallFeedback?.identifiedNewGap).toBe("yes");
  });
});
