export const CATEGORIES = [
  "Business rules",
  "Data model and relationships",
  "Data fields and quality",
  "Access, permissions and test access",
  "Exceptions and edge cases",
  "Automation behavior",
  "Current process and existing org impact",
  "Integrations, migration and scale",
  "Reporting and visibility",
  "Acceptance and sign-off",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type CategoryStatusValue = "Covered" | "Partial" | "Missing" | "Not applicable";

export interface CategoryStatus {
  category: Category;
  status: CategoryStatusValue;
}

export type Severity = "Blocker" | "Important" | "Minor";

export interface Finding {
  id: number;
  title: string;
  category: Category;
  severity: Severity;
  evidence: string;
  whats_missing: string;
  why_it_matters: string;
  question_for_pm: string;
  verify_in_org: string;
}

export type ReadinessVerdict = "Not ready to build" | "Needs clarification" | "Ready to build";

export interface ReportCounts {
  blockers: number;
  important: number;
  minor: number;
  questions: number;
}

export interface ReadinessReport {
  summary: string;
  readiness_verdict: ReadinessVerdict;
  counts: ReportCounts;
  category_status: CategoryStatus[];
  findings: Finding[];
}

export interface ReviewRequest {
  requirement: string;
  org_context?: string;
}

export type ReviewErrorCode = "too_short" | "too_long" | "rate_limited" | "review_failed";

export interface ReviewErrorResponse {
  error: ReviewErrorCode;
  message?: string;
}
