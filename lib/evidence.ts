import { Finding, ReadinessReport } from "./types";

export type EvidenceType = "verbatim" | "omission" | "unverified";

export interface EvaluatedEvidence {
  type: EvidenceType;
  cleanText: string;
  isVerbatim: boolean;
  isOmission: boolean;
}

/**
 * Normalizes evidence string to remove accidental outer quotation marks
 * while preserving internal quotes, punctuation, and content.
 */
export function normalizeEvidenceQuotes(rawEvidence: string): string {
  if (!rawEvidence) return "";
  let trimmed = rawEvidence.trim();

  // If wrapped in matching single or double ASCII quotes
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  // If wrapped in matching typographic quotes (“...”) or curly quotes
  if (
    (trimmed.startsWith("“") && trimmed.endsWith("”") && trimmed.length >= 2) ||
    (trimmed.startsWith("”") && trimmed.endsWith("”") && trimmed.length >= 2) ||
    (trimmed.startsWith("‘") && trimmed.endsWith("’") && trimmed.length >= 2)
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  // Repeated outer quotes normalization (e.g. `""quote""`)
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("“") && trimmed.endsWith("”") && trimmed.length >= 2)
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

/**
 * Checks if a string represents an explicit omission or missing-information statement.
 */
export function isOmissionStatement(text: string): boolean {
  if (!text) return true;
  const omissionPattern = /^(not stated|not specified|unspecified|not mentioned|missing|none provided|omission)\b/i;
  return omissionPattern.test(text.trim());
}

/**
 * Evaluates an evidence string against the original requirement text deterministically.
 * Distinguishes verbatim quotes, omission statements, and unverified/paraphrased references.
 * Preserves the exact text content without modifying user input.
 */
export function evaluateEvidence(
  evidence: string | undefined,
  requirementText: string = ""
): EvaluatedEvidence {
  if (!evidence || !evidence.trim()) {
    return {
      type: "omission",
      cleanText: "Not stated in requirement",
      isVerbatim: false,
      isOmission: true,
    };
  }

  const cleaned = normalizeEvidenceQuotes(evidence);

  if (isOmissionStatement(cleaned)) {
    return {
      type: "omission",
      cleanText: cleaned,
      isVerbatim: false,
      isOmission: true,
    };
  }

  if (requirementText && requirementText.trim()) {
    // Normalize whitespace for resilient substring comparison without altering punctuation
    const normalizeWs = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const reqNormalized = normalizeWs(requirementText);
    const quoteNormalized = normalizeWs(cleaned);

    if (quoteNormalized.length >= 3 && reqNormalized.includes(quoteNormalized)) {
      return {
        type: "verbatim",
        cleanText: cleaned,
        isVerbatim: true,
        isOmission: false,
      };
    } else {
      return {
        type: "unverified",
        cleanText: cleaned,
        isVerbatim: false,
        isOmission: false,
      };
    }
  }

  // If no requirement text is available to verify against, NEVER treat as verified
  return {
    type: "unverified",
    cleanText: cleaned,
    isVerbatim: false,
    isOmission: false,
  };
}

/**
 * Deterministically verifies and normalizes finding evidence on a ReadinessReport
 * without modifying user input, changing severities, or fabricating replacement text.
 */
export function verifyAndNormalizeEvidence(
  report: ReadinessReport,
  requirementText: string
): ReadinessReport {
  for (const finding of report.findings) {
    if (!finding.evidence || !finding.evidence.trim()) {
      finding.evidence = "Not stated in requirement";
      continue;
    }

    const evaluation = evaluateEvidence(finding.evidence, requirementText);
    finding.evidence = evaluation.cleanText;
  }

  return report;
}
