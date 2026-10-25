import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RequirementForm } from "../components/RequirementForm";
import { ResultsView } from "../components/ResultsView";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { SAMPLES } from "../lib/sample-data";
import { formatClarifyingQuestions } from "../lib/clipboard";
import { ReadinessReport } from "../lib/types";

describe("Frontend: Static Data & Helpers", () => {
  it("defines all 6 expected samples with valid lengths and titles", () => {
    expect(SAMPLES.length).toBe(6);
    for (const sample of SAMPLES) {
      expect(sample.id).toBeTruthy();
      expect(sample.name).toBeTruthy();
      expect(sample.requirement.trim().length).toBeGreaterThanOrEqual(20);
      expect(sample.requirement.trim().length).toBeLessThanOrEqual(6000);
      if (sample.orgContext) {
        expect(sample.orgContext.length).toBeLessThanOrEqual(2000);
      }
    }
  });

  it("formatClarifyingQuestions formats questions, severity, and org verification notes", () => {
    const mockReport: ReadinessReport = {
      summary: "Sample review summary",
      readiness_verdict: "Not ready to build",
      counts: { blockers: 1, important: 1, minor: 0, questions: 2 },
      category_status: [
        { category: "Business rules", status: "Missing" },
        { category: "Data model and relationships", status: "Partial" },
        { category: "Data fields and quality", status: "Covered" },
        { category: "Access, permissions and test access", status: "Missing" },
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
          title: "Missing assignment queue",
          category: "Business rules",
          severity: "Blocker",
          evidence: "New leads should be assigned automatically.",
          whats_missing: "No fallback queue defined.",
          why_it_matters: "Unassigned leads will fail.",
          question_for_pm: "Which queue should catch unmatched leads?",
          verify_in_org: "Check Setup > Lead Queues.",
        },
        {
          id: 2,
          title: "Missing region field mapping",
          category: "Data model and relationships",
          severity: "Important",
          evidence: "Leads should be assigned based on their region.",
          whats_missing: "Picklist values not specified.",
          why_it_matters: "Routing logic cannot be built.",
          question_for_pm: "What are the allowed region values?",
          verify_in_org: "",
        },
      ],
    };

    const text = formatClarifyingQuestions(mockReport, "Lead Assignment User Story");
    expect(text).toContain("SALESFORCE BUILD READINESS — CLARIFYING QUESTIONS");
    expect(text).toContain("Requirement: Lead Assignment User Story");
    expect(text).toContain("Readiness Verdict: Not ready to build");
    expect(text).toContain("1. [BLOCKER] Missing assignment queue (Business rules)");
    expect(text).toContain("Question for PM: Which queue should catch unmatched leads?");
    expect(text).toContain("Verify in Org:   Check Setup > Lead Queues.");
    expect(text).toContain("2. [IMPORTANT] Missing region field mapping (Data model and relationships)");
  });

  it("formatClarifyingQuestions handles zero findings cleanly", () => {
    const cleanReport: ReadinessReport = {
      summary: "Perfect specification",
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
    };

    const text = formatClarifyingQuestions(cleanReport);
    expect(text).toContain("No clarifying questions needed.");
  });
});

describe("Frontend: Main Screen (RequirementForm)", () => {
  it("renders product title, description, textareas, character counter, and Check Readiness button", () => {
    const html = renderToStaticMarkup(
      <RequirementForm
        requirement="This is a test requirement with sufficient characters to pass minimum validation length."
        setRequirement={() => {}}
        orgContext=""
        setOrgContext={() => {}}
        onSubmit={() => {}}
        isLoading={false}
        error={null}
        onClear={() => {}}
        selectedSampleId=""
        onSelectSample={() => {}}
      />
    );

    // 1. Clear product title
    expect(html).toContain("Salesforce Build Readiness Checker");
    // 2. Concise description explaining purpose
    expect(html).toContain("Reviews Salesforce requirement specifications before development begins");
    // 3. Requirement input textarea
    expect(html).toContain('id="requirement-input"');
    // 4. Optional Existing Salesforce Org Context textarea
    expect(html).toContain("Existing Salesforce Org Context");
    // 5. Check Readiness button
    expect(html).toContain("Check Readiness");
    // 6. Character counts
    expect(html).toContain("/ 6,000 characters");
    // 7. Sample options available
    expect(html).toContain("Choose a sample requirement...");
    expect(html).toContain("Sample 01: Lead Assignment");
    expect(html).toContain("Sample 06: Renewal Reminders");
  });

  it("renders loading state when isLoading is true", () => {
    const html = renderToStaticMarkup(
      <RequirementForm
        requirement="Requirement text under analysis..."
        setRequirement={() => {}}
        orgContext=""
        setOrgContext={() => {}}
        onSubmit={() => {}}
        isLoading={true}
        error={null}
        onClear={() => {}}
        selectedSampleId=""
        onSelectSample={() => {}}
      />
    );

    expect(html).toContain("Checking Readiness...");
    expect(html).toContain("Analyzing requirement against Salesforce readiness rubric...");
  });

  it("renders rate-limited error state properly", () => {
    const html = renderToStaticMarkup(
      <RequirementForm
        requirement="Valid requirement text"
        setRequirement={() => {}}
        orgContext=""
        setOrgContext={() => {}}
        onSubmit={() => {}}
        isLoading={false}
        error={{
          code: "rate_limited",
          message: "Rate limit exceeded (10 requests/hour). Please try again later.",
        }}
        onClear={() => {}}
        selectedSampleId=""
        onSelectSample={() => {}}
      />
    );

    expect(html).toContain("Rate limit reached");
    expect(html).toContain("Rate limit exceeded (10 requests/hour)");
  });

  it("renders upstream 502 review_failed error state cleanly without leaking internals", () => {
    const html = renderToStaticMarkup(
      <RequirementForm
        requirement="Valid requirement text"
        setRequirement={() => {}}
        orgContext=""
        setOrgContext={() => {}}
        onSubmit={() => {}}
        isLoading={false}
        error={{
          code: "overloaded",
          title: "Salesforce Readiness is temporarily busy",
          message:
            "The review service is experiencing high demand. Your requirement and clarification answers are preserved. Please try again shortly.",
        }}
        onClear={() => {}}
        selectedSampleId=""
        onSelectSample={() => {}}
      />
    );

    expect(html).toContain("Salesforce Readiness is temporarily busy");
    expect(html).toContain("The review service is experiencing high demand");
    expect(html).not.toContain("stack");
    expect(html).not.toContain("Gemini");
  });

  it("renders timeout error state properly with user-friendly preserved notice", () => {
    const html = renderToStaticMarkup(
      <RequirementForm
        requirement="Valid requirement text"
        setRequirement={() => {}}
        orgContext=""
        setOrgContext={() => {}}
        onSubmit={() => {}}
        isLoading={false}
        error={{
          code: "timeout",
          title: "Review is taking longer than expected",
          message:
            "Salesforce Readiness couldn't complete this review in time. Your work is preserved. Please try again.",
        }}
        onClear={() => {}}
        selectedSampleId=""
        onSelectSample={() => {}}
      />
    );

    expect(html).toContain("Review is taking longer than expected");
    expect(html).toContain("Salesforce Readiness");
    expect(html).toContain("complete this review in time. Your work is preserved. Please try again.");
    expect(html).not.toContain("Gemini");
  });

  it("renders offline mock mode toggle in non-production", () => {
    const html = renderToStaticMarkup(
      <RequirementForm
        requirement="Valid requirement text"
        setRequirement={() => {}}
        orgContext=""
        setOrgContext={() => {}}
        onSubmit={() => {}}
        isLoading={false}
        error={null}
        onClear={() => {}}
        selectedSampleId=""
        onSelectSample={() => {}}
        isMockMode={true}
        setIsMockMode={() => {}}
      />
    );

    expect(html).toContain("Offline Mock Mode");
  });
});

describe("Frontend: Results Screen (ResultsView)", () => {
  const mockReport: ReadinessReport = {
    summary: "Requirement is missing critical routing rules and permission specs.",
    readiness_verdict: "Not ready to build",
    counts: { blockers: 1, important: 1, minor: 0, questions: 2 },
    category_status: [
      { category: "Business rules", status: "Missing" },
      { category: "Data model and relationships", status: "Partial" },
      { category: "Data fields and quality", status: "Covered" },
      { category: "Access, permissions and test access", status: "Missing" },
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
        title: "Undefined regional fallback queue",
        category: "Business rules",
        severity: "Blocker",
        evidence: "New leads should be assigned automatically based on region.",
        whats_missing: "Fallback queue for unmapped or international regions is missing.",
        why_it_matters: "Leads with unknown regions will trigger an unhandled fault in the assignment flow.",
        question_for_pm: "Which default queue should receive unassigned leads when region is blank?",
        verify_in_org: "Check Setup > Queues to verify if 'Unassigned Leads' queue exists.",
      },
      {
        id: 2,
        title: "Unspecified Region field API name and picklist values",
        category: "Data model and relationships",
        severity: "Important",
        evidence: "Leads should be assigned based on their region.",
        whats_missing: "Field type, API name, and valid values are not specified.",
        why_it_matters: "Development cannot commence without knowing if Region__c exists or requires creation.",
        question_for_pm: "Is Region__c an existing custom field, and what are its active values?",
        verify_in_org: "Inspect Lead fields in Object Manager for Region__c.",
      },
    ],
  };

  it("renders readiness verdict, summary, and severity counts", () => {
    const html = renderToStaticMarkup(
      <ResultsView
        report={mockReport}
        requirement="Requirement text"
        onReset={() => {}}
      />
    );

    // 1. Readiness verdict
    expect(html).toContain("Not ready to build");
    // 2. Summary
    expect(html).toContain("Requirement is missing critical routing rules");
    // 3. Counts
    expect(html).toContain("Blockers");
    expect(html).toContain("Important");
    expect(html).toContain("Minor");
    expect(html).toContain("Questions");
  });

  it("renders all 10 rubric categories with their coverage statuses", () => {
    const html = renderToStaticMarkup(
      <ResultsView
        report={mockReport}
        requirement="Requirement text"
        onReset={() => {}}
      />
    );

    expect(html).toContain("Rubric Category Coverage");
    expect(html).toContain("Business rules");
    expect(html).toContain("Data model and relationships");
    expect(html).toContain("Data fields and quality");
    expect(html).toContain("Access, permissions and test access");
    expect(html).toContain("Exceptions and edge cases");
    expect(html).toContain("Automation behavior");
    expect(html).toContain("Current process and existing org impact");
    expect(html).toContain("Integrations, migration and scale");
    expect(html).toContain("Reporting and visibility");
    expect(html).toContain("Acceptance and sign-off");

    expect(html).toContain("Missing");
    expect(html).toContain("Partial");
    expect(html).toContain("Covered");
    expect(html).toContain("N/A");
  });

  it("renders prioritized findings with title, category, severity, evidence, missing, why matters, and question", () => {
    const html = renderToStaticMarkup(
      <ResultsView
        report={mockReport}
        requirement="Requirement text"
        onReset={() => {}}
      />
    );

    expect(html).toContain("Undefined regional fallback queue");
    expect(html).toContain("Blocker");
    expect(html).toContain("Business rules");
    expect(html).toContain("New leads should be assigned automatically based on region.");
    expect(html).toContain("Fallback queue for unmapped or international regions is missing.");
    expect(html).toContain("Leads with unknown regions will trigger an unhandled fault");
    expect(html).toContain("Which default queue should receive unassigned leads when region is blank?");
  });

  it("renders 'Verify in org' with distinct styling clearly separated from finding text", () => {
    const html = renderToStaticMarkup(
      <ResultsView
        report={mockReport}
        requirement="Requirement text"
        onReset={() => {}}
      />
    );

    expect(html).toContain("Verify in Salesforce Org (Setup &amp; Metadata Check)");
    expect(html).toContain("Check Setup &gt; Queues to verify if &#x27;Unassigned Leads&#x27; queue exists.");
  });

  it("renders copy questions and review another requirement actions", () => {
    const html = renderToStaticMarkup(
      <ResultsView
        report={mockReport}
        requirement="Requirement text"
        onReset={() => {}}
      />
    );

    expect(html).toContain("Copy Clarifying Questions");
    expect(html).toContain("Copy Question");
    expect(html).toContain("Review another requirement");
  });

  it("renders empty state cleanly when report has 0 findings (Sample 06 / Ready to build)", () => {
    const cleanReport: ReadinessReport = {
      summary: "Requirement is complete and ready for development.",
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
    };

    const html = renderToStaticMarkup(
      <ResultsView
        report={cleanReport}
        requirement="Requirement text"
        onReset={() => {}}
      />
    );

    expect(html).toContain("Ready to build");
    expect(html).toContain("No Blockers or Gaps Detected");
    expect(html).toContain("satisfies all 10 rubric categories");
  });

  it("visibly identifies mock/simulated results with a prominent indicator", () => {
    const simulatedReport: ReadinessReport = {
      summary: "Sample review summary [SIMULATED PREVIEW — OFFLINE MOCK DATA].",
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
    };

    const html = renderToStaticMarkup(
      <ResultsView
        report={simulatedReport}
        requirement="Requirement text"
        onReset={() => {}}
      />
    );

    expect(html).toContain("Simulated");
    expect(html).toContain("This review was generated in Offline Mock Mode");
  });
  it("renders export confidentiality warning in ResultsView", () => {
    const mockReport: ReadinessReport = {
      summary: "Clean report",
      readiness_verdict: "Ready to build",
      counts: { blockers: 0, important: 0, minor: 0, questions: 0 },
      category_status: [],
      findings: [],
    };

    const mockSession = {
      sessionId: "session-123",
      originalRequirement: "Valid requirement text exceeding twenty characters.",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      activeVersionIndex: 0,
      versions: [
        {
          versionNumber: 1,
          createdAt: 1700000000000,
          report: mockReport,
          requirement: "Valid requirement text exceeding twenty characters.",
          orgContext: "",
          feedback: {},
          answers: {},
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ResultsView
        report={mockReport}
        requirement="Valid requirement text exceeding twenty characters."
        session={mockSession as any}
        currentVersion={mockSession.versions[0] as any}
        onReset={() => {}}
        onExport={() => {}}
      />
    );

    expect(html).toContain(
      "Exports include your requirement text, org context, and clarification answers. Share only if the information is nonconfidential."
    );
  });
});

describe("Frontend: Navbar & Footer", () => {
  it("renders Navbar with branding and reset button when active", () => {
    const html = renderToStaticMarkup(<Navbar showReset={true} onReset={() => {}} onExport={() => {}} />);
    expect(html).toContain("Salesforce Build Readiness Checker");
    expect(html).toContain("Pre-Build Rubric v1.0");
    expect(html).toContain("Review Another Requirement");
    expect(html).toContain(
      "Exports include your requirement text, org context, and clarification answers. Share only if the information is nonconfidential."
    );
  });

  it("renders Footer with required disclaimer and data retention policy", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain("Review aid only. Does not replace developer judgment or stakeholder sign-off.");
    expect(html).toContain("Do not paste confidential client data.");
    expect(html).toContain("Zero Data Retention");
  });
});
