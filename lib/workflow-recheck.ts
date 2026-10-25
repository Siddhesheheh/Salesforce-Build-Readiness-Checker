import { Finding } from "./types";
import { ClarificationAnswer, ReviewVersion, VersionComparison, CategoryDiff } from "./workflow-types";

export interface RecheckInputResult {
  text: string;
  answersCount: number;
  error?: string;
}

export function buildRecheckInput(
  originalRequirement: string,
  answers: Record<number, ClarificationAnswer>,
  findings: Finding[]
): RecheckInputResult {
  const trimmedOriginal = originalRequirement.trim();

  // Find all non-empty answers
  const validAnswers = Object.values(answers).filter(
    (a) => a && typeof a.answerText === "string" && a.answerText.trim().length > 0
  );

  if (validAnswers.length === 0) {
    return {
      text: trimmedOriginal,
      answersCount: 0,
      error: "At least one answered clarification question is required to recheck readiness.",
    };
  }

  // Map finding details for context
  const findingMap = new Map<number, Finding>();
  findings.forEach((f) => findingMap.set(f.id, f));

  const sections: string[] = [];
  sections.push(trimmedOriginal);
  sections.push("\n\n=== USER CLARIFICATIONS & DECISIONS ===");
  sections.push(
    "The following clarifications and technical decisions have been provided by the project team to address previous review questions:\n"
  );

  validAnswers.forEach((ans) => {
    const finding = findingMap.get(ans.findingId);
    const title = finding?.title || `Finding #${ans.findingId}`;
    const category = finding?.category ? ` (${finding.category})` : "";
    const question = ans.question || finding?.question_for_pm || "Clarification";

    sections.push(`- Finding #${ans.findingId}: ${title}${category}`);
    sections.push(`  Question: ${question}`);
    sections.push(`  User Decision / Clarification: ${ans.answerText.trim()}\n`);
  });

  const consolidatedText = sections.join("\n").trim();

  if (consolidatedText.length > 6000) {
    return {
      text: consolidatedText,
      answersCount: validAnswers.length,
      error: `Combined requirement and clarifications exceed maximum 6,000 characters (${consolidatedText.length} / 6,000 characters). Please shorten your answers or the original text.`,
    };
  }

  return {
    text: consolidatedText,
    answersCount: validAnswers.length,
  };
}

export function compareVersions(
  previousVersion: ReviewVersion,
  currentVersion: ReviewVersion
): VersionComparison {
  const prevReport = previousVersion.report;
  const currReport = currentVersion.report;

  const countDiffs = {
    blockers: currReport.counts.blockers - prevReport.counts.blockers,
    important: currReport.counts.important - prevReport.counts.important,
    minor: currReport.counts.minor - prevReport.counts.minor,
    questions: currReport.counts.questions - prevReport.counts.questions,
  };

  const prevCatMap = new Map(prevReport.category_status.map((c) => [c.category, c.status]));

  const categoryDiffs: CategoryDiff[] = currReport.category_status.map((currCat) => {
    const previousStatus = prevCatMap.get(currCat.category) || "Missing";
    return {
      category: currCat.category,
      previousStatus,
      currentStatus: currCat.status,
      changed: previousStatus !== currCat.status,
    };
  });

  return {
    previousVersionNumber: previousVersion.versionNumber,
    currentVersionNumber: currentVersion.versionNumber,
    previousVerdict: prevReport.readiness_verdict,
    currentVerdict: currReport.readiness_verdict,
    verdictChanged: prevReport.readiness_verdict !== currReport.readiness_verdict,
    countDiffs,
    categoryDiffs,
  };
}
