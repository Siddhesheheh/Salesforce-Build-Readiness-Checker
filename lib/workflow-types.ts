import { Category, CategoryStatusValue, Finding, ReadinessReport, ReadinessVerdict } from "./types";

export type FindingRating = "useful" | "not_useful" | "unrated";

export const THUMBS_DOWN_REASONS = [
  "Already covered in requirement",
  "Incorrect finding",
  "Not relevant",
  "Wrong severity",
  "Too vague or unclear",
  "Other",
] as const;

export type ThumbsDownReason = (typeof THUMBS_DOWN_REASONS)[number];

export interface FindingFeedback {
  findingId: number;
  rating: FindingRating;
  reason?: ThumbsDownReason;
  comment?: string;
  updatedAt: string; // ISO 8601
}

export type FeedbackAnswer = "yes" | "no" | "not_sure" | null;

export interface OverallFeedback {
  identifiedNewGap: FeedbackAnswer;
  wouldUseBeforeKickoff: FeedbackAnswer;
  comments?: string;
  updatedAt: string;
}

export interface ClarificationAnswer {
  findingId: number;
  question: string;
  answerText: string;
  updatedAt: string;
}

export interface ReviewVersion {
  versionNumber: number; // 1, 2, 3...
  timestamp: string; // ISO 8601
  submittedRequirement: string;
  orgContext?: string;
  report: ReadinessReport;
  findingFeedback: Record<number, FindingFeedback>;
  answers: Record<number, ClarificationAnswer>;
  overallFeedback?: OverallFeedback;
  parentVersionNumber?: number;
}

export interface ReviewSession {
  sessionId: string;
  originalRequirement: string;
  originalOrgContext?: string;
  versions: ReviewVersion[];
  currentVersionNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDiff {
  category: Category;
  previousStatus: CategoryStatusValue;
  currentStatus: CategoryStatusValue;
  changed: boolean;
}

export interface VersionComparison {
  previousVersionNumber: number;
  currentVersionNumber: number;
  previousVerdict: ReadinessVerdict;
  currentVerdict: ReadinessVerdict;
  verdictChanged: boolean;
  countDiffs: {
    blockers: number; // current - previous
    important: number;
    minor: number;
    questions: number;
  };
  categoryDiffs: CategoryDiff[];
}
