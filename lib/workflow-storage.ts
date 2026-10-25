import { ReviewSession } from "./workflow-types";

export const STORAGE_KEY = "sf_readiness_session_v1";

function getLocalStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  return null;
}

/**
 * Safely loads the stored review session from browser localStorage.
 * Handles corrupt data, SSR environments, and schema discrepancies gracefully.
 */
export function loadSession(): ReviewSession | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    // Basic structural validation
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.sessionId !== "string" ||
      !Array.isArray(parsed.versions) ||
      parsed.versions.length === 0 ||
      typeof parsed.currentVersionNumber !== "number"
    ) {
      console.warn("Invalid session format found in localStorage. Resetting.");
      return null;
    }

    return parsed as ReviewSession;
  } catch (err) {
    console.warn("Failed to parse stored session from localStorage:", err);
    return null;
  }
}

/**
 * Safely saves the review session to browser localStorage.
 */
export function saveSession(session: ReviewSession): boolean {
  const storage = getLocalStorage();
  if (!storage) {
    return false;
  }

  try {
    const payload = JSON.stringify(session);
    storage.setItem(STORAGE_KEY, payload);
    return true;
  } catch (err) {
    console.error("Failed to save review session to localStorage:", err);
    return false;
  }
}

/**
 * Clears the stored session from browser localStorage.
 */
export function clearSession(): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error("Failed to clear review session from localStorage:", err);
  }
}

/**
 * Generates formatted, downloadable JSON export of the entire session.
 * Contains warning notice regarding sensitive requirement text.
 */
export function exportSessionToJson(session: ReviewSession): string {
  const exportPayload = {
    _exportNotice:
      "WARNING: This file contains user requirements, clarifying questions, answers, and review feedback. Treat as confidential if project requirements are proprietary.",
    exportedAt: new Date().toISOString(),
    tool: "Salesforce Build Readiness Checker",
    version: "1.0",
    sessionId: session.sessionId,
    totalVersions: session.versions.length,
    originalRequirement: session.originalRequirement,
    originalOrgContext: session.originalOrgContext || null,
    versions: session.versions.map((ver) => ({
      versionNumber: ver.versionNumber,
      timestamp: ver.timestamp,
      readinessVerdict: ver.report.readiness_verdict,
      counts: ver.report.counts,
      submittedRequirement: ver.submittedRequirement,
      userAnswers: Object.values(ver.answers || {}).map((ans) => ({
        findingId: ans.findingId,
        question: ans.question,
        answerText: ans.answerText,
        updatedAt: ans.updatedAt,
      })),
      findingFeedback: Object.values(ver.findingFeedback || {}).map((fb) => ({
        findingId: fb.findingId,
        rating: fb.rating,
        reason: fb.reason || null,
        comment: fb.comment || null,
        updatedAt: fb.updatedAt,
      })),
      overallFeedback: ver.overallFeedback || null,
      categoryStatus: ver.report.category_status,
      findings: ver.report.findings,
    })),
  };

  return JSON.stringify(exportPayload, null, 2);
}

/**
 * Helper to trigger client-side download of exported JSON file.
 */
export function downloadJsonFile(filename: string, content: string): void {
  if (typeof window === "undefined") return;

  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
