import fs from "fs";
import path from "path";
import Ajv from "ajv";
import { callModel, UpstreamApiError, BudgetExceededError } from "./llm";
import { Finding, ReadinessReport, ReadinessVerdict, Severity } from "./types";
import { reviewAbortContext, reviewDiagnosticsContext } from "./request-context";

let cachedRubric: string | null = null;
let cachedSchemaString: string | null = null;
let cachedValidator: ReturnType<Ajv["compile"]> | null = null;

function getRubric(): string {
  if (!cachedRubric) {
    const rubricPath = path.join(process.cwd(), "rubric.md");
    cachedRubric = fs.readFileSync(rubricPath, "utf-8");
  }
  return cachedRubric;
}

function getSchemaString(): string {
  if (!cachedSchemaString) {
    const schemaPath = path.join(process.cwd(), "schema.json");
    cachedSchemaString = fs.readFileSync(schemaPath, "utf-8");
  }
  return cachedSchemaString;
}

function getValidator() {
  if (!cachedValidator) {
    const schemaJson = JSON.parse(getSchemaString());
    const ajv = new Ajv({ allErrors: true });
    cachedValidator = ajv.compile(schemaJson);
  }
  return cachedValidator;
}

export function buildSystemPrompt(): string {
  const rubric = getRubric();
  const schemaStr = getSchemaString();

  return `${rubric}\n\n## Target JSON Schema (schema.json)\nYou MUST return a JSON object that adheres strictly to the following JSON schema definition. Ensure all required fields, exact property names, types, and enum values are used:\n\`\`\`json\n${schemaStr}\n\`\`\``;
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

export class SchemaValidationError extends Error {
  errors: any[];
  constructor(message: string, errors: any[] = []) {
    super(message);
    this.name = "SchemaValidationError";
    this.errors = errors;
  }
}

export interface ReviewDiagnostics {
  modelCallAttempts: number;
  schemaValidationRetries: number;
}

function isUpstreamApiFailure(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof UpstreamApiError || err instanceof BudgetExceededError) return true;
  if (typeof err === "object" && ("statusCode" in (err as any) || "status" in (err as any))) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("budget") ||
      msg.includes("gemini api") ||
      msg.includes("quota") ||
      msg.includes("status 429") ||
      msg.includes("status 403") ||
      msg.includes("status 404") ||
      msg.includes("status 5") ||
      msg.includes("fetch failed") ||
      msg.includes("econnrefused") ||
      msg.includes("timed out") ||
      msg.includes("timeout") ||
      msg.includes("aborted") ||
      msg.includes("network") ||
      msg.includes("is not set in environment")
    );
  }
  return false;
}

export async function reviewRequirement(
  requirement: string,
  orgContext?: string,
  modelCaller: (system: string, user: string) => Promise<string> = callModel,
  diagnosticsOut?: ReviewDiagnostics
): Promise<ReadinessReport> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(requirement, orgContext);
  const validate = getValidator();

  let rawOutput = "";
  let parsed: unknown = null;
  let isValid = false;
  let validationFeedback = "";

  if (diagnosticsOut) {
    diagnosticsOut.modelCallAttempts = 0;
    diagnosticsOut.schemaValidationRetries = 0;
  }

  // Attempt 1: Call Model
  try {
    if (diagnosticsOut) diagnosticsOut.modelCallAttempts++;
    rawOutput = await modelCaller(systemPrompt, userPrompt);
  } catch (err: unknown) {
    // If upstream API/network fails, re-throw immediately. Do not treat API errors as schema validation errors.
    if (isUpstreamApiFailure(err)) {
      throw err;
    }
    throw err;
  }

  // Validate Attempt 1 Output
  try {
    parsed = JSON.parse(rawOutput);
    isValid = Boolean(validate(parsed));
    if (!isValid && validate.errors) {
      validationFeedback = validate.errors
        .map((e) => `${e.instancePath || "root"}: ${e.message} (${e.keyword})`)
        .join("; ");
    }
  } catch {
    isValid = false;
    validationFeedback = "Response was not valid JSON";
  }

  // Attempt 2: Retry once only on JSON/Schema validation failure
  if (!isValid) {
    const diagCollector = reviewDiagnosticsContext.getStore();
    if (diagCollector) {
      diagCollector.schemaValidationRetries++;
      diagCollector.activePhase = "schema_correction";

      // If less than 10 seconds remain before interactive deadline, abort schema retry
      if (diagCollector.overallDeadlineMs > 15000 && diagCollector.remainingMs < 10000) {
        throw new SchemaValidationError(
          `Schema validation failed on attempt 1 and insufficient time remained for correction (${Math.round(diagCollector.remainingMs / 1000)}s remaining): ${validationFeedback}`
        );
      }
    }

    if (reviewAbortContext.getStore()?.signal?.aborted) {
      throw new UpstreamApiError("Review request aborted: overall deadline exceeded.", 504);
    }
    if (diagnosticsOut) {
      diagnosticsOut.schemaValidationRetries++;
      diagnosticsOut.modelCallAttempts++;
    }
    const retryUserPrompt = `${userPrompt}\n\nCORRECTION REQUIRED:\nYour previous output was invalid: ${validationFeedback}.\nYou must return a valid JSON object matching schema.json strictly with all required fields.`;

    try {
      rawOutput = await modelCaller(systemPrompt, retryUserPrompt);
    } catch (err: unknown) {
      if (isUpstreamApiFailure(err)) {
        throw err;
      }
      throw err;
    }

    try {
      parsed = JSON.parse(rawOutput);
      isValid = Boolean(validate(parsed));
    } catch {
      isValid = false;
    }
  }

  if (!isValid || !parsed) {
    const errorDetails = validate.errors ? JSON.stringify(validate.errors) : "Invalid JSON output";
    throw new SchemaValidationError(
      `Report validation failed against schema.json: ${errorDetails}`,
      validate.errors || []
    );
  }

  const validatedReport = parsed as ReadinessReport;
  return computeVerdictAndCounts(validatedReport);
}
