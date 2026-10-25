import fs from "fs";
import path from "path";
import { ReadinessReport } from "./types";

/**
 * Provides deterministic mock reports matching schema.json for local UI development and tests.
 * Never used in production.
 */
export function getMockReport(requirementText: string): ReadinessReport {
  // 1. If Recheck with User Clarifications, return deterministic Version 2 mock report
  if (
    requirementText.includes("USER CLARIFICATIONS & DECISIONS") ||
    requirementText.includes("USER CLARIFICATIONS")
  ) {
    return {
      summary:
        "User clarifications resolved the regional fallback queue and picklist definitions. All previous Blockers are eliminated. Minor tracking questions should be confirmed before kickoff. [SIMULATED PREVIEW — OFFLINE MOCK DATA]",
      readiness_verdict: "Needs clarification",
      counts: {
        blockers: 0,
        important: 1,
        minor: 1,
        questions: 2,
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
        { category: "Reporting and visibility", status: "Partial" },
        { category: "Acceptance and sign-off", status: "Covered" },
      ],
      findings: [
        {
          id: 1,
          title: "Lead response SLA timeframe unconfirmed",
          category: "Automation behavior",
          severity: "Important",
          evidence: "Leads should be handled quickly by the right person.",
          whats_missing: "Specific response timeframe (e.g. 2 hours or 1 business day) is not stated.",
          why_it_matters: "Flow automation requires an exact numeric threshold for reminder notifications.",
          question_for_pm: "What is the expected response SLA in business hours for new leads?",
          verify_in_org: "Check Setup > Business Hours in Salesforce.",
        },
        {
          id: 2,
          title: "Manager tracking dashboard folder access",
          category: "Reporting and visibility",
          severity: "Minor",
          evidence: "Sales Managers should be able to track lead assignments.",
          whats_missing: "Report folder and sharing access for Sales Managers is unstated.",
          why_it_matters: "Without folder access, managers will encounter insufficient privileges errors.",
          question_for_pm: "Which public group or role hierarchy level should have access to the dashboard folder?",
          verify_in_org: "Check Setup > Public Groups and existing Lead Report folders.",
        },
      ],
    };
  }

  // 2. If testing Complete specification (Sample 06), return "Ready to build" report
  if (
    requirementText.includes("Subscription Renewal Reminders") ||
    requirementText.includes("Renewal_Reminder_Admin")
  ) {
    return {
      summary:
        "The specification provides comprehensive coverage of business rules, schema additions, access permissions, automation cadence, and test sign-off criteria with zero blockers. [SIMULATED PREVIEW — OFFLINE MOCK DATA]",
      readiness_verdict: "Ready to build",
      counts: {
        blockers: 0,
        important: 0,
        minor: 0,
        questions: 0,
      },
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
    };
  }

  // 3. Load standard fixture for Sample 01
  const fixturePath = path.join(process.cwd(), "fixtures", "sample-report.json");
  if (fs.existsSync(fixturePath)) {
    return JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as ReadinessReport;
  }

  // 4. Fallback if fixture file is missing
  return {
    summary: "Mock report for local development and testing. [SIMULATED PREVIEW — OFFLINE MOCK DATA]",
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
    findings: [
      {
        id: 1,
        title: "Undefined assignment rules",
        category: "Business rules",
        severity: "Blocker",
        evidence: "Requirement excerpt",
        whats_missing: "No assignment rules defined.",
        why_it_matters: "Cannot build routing.",
        question_for_pm: "Which reps own which regions?",
        verify_in_org: "Check Setup > Lead Assignment Rules.",
      },
    ],
  };
}
