import fs from "fs";
import path from "path";
import Ajv from "ajv";
import { callModel } from "./llm";
import { Finding, ReadinessReport, ReadinessVerdict, Severity } from "./types";

let cachedRubric: string | null = null;
let cachedValidator: ReturnType<Ajv["compile"]> | null = null;

function getRubric(): string {
  if (!cachedRubric) {
    const rubricPath = path.join(process.cwd(), "rubric.md");
    cachedRubric = fs.readFileSync(rubricPath, "utf-8");
  }
  return cachedRubric;
}

function getValidator() {
  if (!cachedValidator) {
    const schemaPath = path.join(process.cwd(), "schema.json");
    const schemaContent = fs.readFileSync(schemaPath, "utf-8");
    const schemaJson = JSON.parse(schemaContent);
    const ajv = new Ajv({ allErrors: true });
    cachedValidator = ajv.compile(schemaJson);
  }
  return cachedValidator;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  Blocker: 1,
  Important: 2,
  Minor: 3,
};

export function computeVerdictAndCounts(report: ReadinessReport): ReadinessReport {
  // Sort findings: Blocker > Important > Minor
  report.findings.sort((a, b) => {
    const orderA = SEVERITY_ORDER[a.severity] ?? 99;
    const orderB = SEVERITY_ORDER[b.severity] ?? 99;
    return orderA - orderB;
  });

  // Renumber finding IDs sequentially starting at 1
  report.findings.forEach((finding, index) => {
    finding.id = index + 1;
  });

  // Recalculate counts strictly from findings
  const blockers = report.findings.filter((f) => f.severity === "Blocker").length;
  const important = report.findings.filter((f) => f.severity === "Important").length;
  const minor = report.findings.filter((f) => f.severity === "Minor").length;
  const questions = report.findings.filter((f) => Boolean(f.question_for_pm && f.question_for_pm.trim())).length;

  report.counts = {
    blockers,
    important,
    minor,
    questions,
  };

  // Compute readiness verdict strictly by rule 12
  let verdict: ReadinessVerdict;
  if (blockers > 0) {
    verdict = "Not ready to build";
  } else if (important > 0) {
    verdict = "Needs clarification";
  } else {
    verdict = "Ready to build";
  }

  report.readiness_verdict = verdict;

  return report;
}

export function buildUserPrompt(requirement: string, orgContext?: string): string {
  const trimmedReq = requirement.trim();
  const trimmedContext = orgContext && orgContext.trim() ? orgContext.trim() : "None provided";
  return `REQUIREMENT:\n${trimmedReq}\n\nORG CONTEXT:\n${trimmedContext}`;
}

export async function reviewRequirement(
  requirement: string,
  orgContext?: string,
  modelCaller: (system: string, user: string) => Promise<string> = callModel
): Promise<ReadinessReport> {
  const systemPrompt = getRubric();
  const userPrompt = buildUserPrompt(requirement, orgContext);
  const validate = getValidator();

  let rawOutput = "";
  let parsed: unknown = null;
  let isValid = false;

  // Attempt 1
  try {
    rawOutput = await modelCaller(systemPrompt, userPrompt);
    parsed = JSON.parse(rawOutput);
    isValid = Boolean(validate(parsed));
  } catch {
    isValid = false;
  }

  // Attempt 2 (retry once on invalid JSON or schema failure)
  if (!isValid) {
    try {
      rawOutput = await modelCaller(systemPrompt, userPrompt);
      parsed = JSON.parse(rawOutput);
      isValid = Boolean(validate(parsed));
    } catch {
      isValid = false;
    }
  }

  if (!isValid || !parsed) {
    const errorDetails = validate.errors ? JSON.stringify(validate.errors) : "Invalid JSON output";
    throw new Error(`Report validation failed against schema.json: ${errorDetails}`);
  }

  const validatedReport = parsed as ReadinessReport;
  return computeVerdictAndCounts(validatedReport);
}
