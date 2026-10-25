import fs from "fs";
import path from "path";
import { resolveModelName } from "../lib/llm";

export interface RawGeminiModel {
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  temperature?: number;
  topP?: number;
  topK?: number;
}

export type ModelRecommendation =
  | "CURRENT_MODEL"
  | "RECOMMENDED"
  | "COMPATIBLE"
  | "EVALUATE_FAST"
  | "UNSUPPORTED";

export interface ModelAssessment {
  id: string;
  displayName: string;
  supportsGenerateContent: boolean;
  supportsStructuredJson: boolean;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  recommendation: ModelRecommendation;
  recommendationNote: string;
}

/**
 * Masks an API key for safe terminal display without exposing the secret.
 */
export function maskApiKey(key?: string | null): string {
  if (!key) return "[NOT SET]";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "[CONFIGURED]";
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)} (${trimmed.length} chars)`;
}

/**
 * Loads environment variables from .env.local or .env safely without logging.
 */
export function loadEnvironment(): void {
  const envLocalPath = path.join(process.cwd(), ".env.local");
  const envPath = path.join(process.cwd(), ".env");

  const targetFile = fs.existsSync(envLocalPath)
    ? envLocalPath
    : fs.existsSync(envPath)
    ? envPath
    : null;

  if (targetFile) {
    try {
      const content = fs.readFileSync(targetFile, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }
}

/**
 * Assesses whether a Gemini model supports generateContent and structured JSON outputs.
 * Does not assume a model supports JSON schema merely because it has generateContent.
 */
export function assessModel(raw: RawGeminiModel, currentModelId: string): ModelAssessment {
  const rawName = raw.name || "";
  const id = rawName.replace(/^models\//i, "");
  const displayName = raw.displayName || id;
  const methods = raw.supportedGenerationMethods || [];
  const supportsGenerateContent = methods.includes("generateContent");

  const lowerId = id.toLowerCase();

  // Exclude non-text, embedding, or vision-only specialized endpoints
  const isExcluded =
    lowerId.includes("embedding") ||
    lowerId.includes("aqa") ||
    lowerId.includes("imagen") ||
    lowerId.includes("bison");

  // Models with documented native JSON Schema enforcement (responseMimeType: "application/json" + schema.json)
  // Gemini 1.5 family, 2.0 family, 2.5 family, and 3.x Flash
  const isSupportedFamily =
    /^(gemini-2\.5|gemini-2\.0|gemini-1\.5|gemini-3\.)/i.test(id) &&
    !lowerId.includes("thinking"); // thinking models generate chain-of-thought tokens that break strict JSON schema parsing

  const supportsStructuredJson = supportsGenerateContent && !isExcluded && isSupportedFamily;

  let recommendation: ModelRecommendation = "UNSUPPORTED";
  let recommendationNote = "Does not support structured JSON schema output.";

  const isCurrent = id === currentModelId;

  if (supportsStructuredJson) {
    if (isCurrent) {
      recommendation = "CURRENT_MODEL";
      recommendationNote = "Active model configured in .env.local.";
    } else if (lowerId.includes("2.0-flash") && !lowerId.includes("lite")) {
      recommendation = "RECOMMENDED";
      recommendationNote = "High speed, native JSON schema support, dedicated cloud capacity.";
    } else if (lowerId.includes("1.5-flash")) {
      recommendation = "RECOMMENDED";
      recommendationNote = "Stable, mature Flash model with high free-tier availability.";
    } else if (lowerId.includes("lite")) {
      recommendation = "EVALUATE_FAST";
      recommendationNote = "Ultra-low latency; test accuracy on 10-category Salesforce rubric.";
    } else if (lowerId.includes("pro")) {
      recommendation = "COMPATIBLE";
      recommendationNote = "Superior reasoning for complex rules; higher latency & lower RPM quota.";
    } else {
      recommendation = "COMPATIBLE";
      recommendationNote = "Supports generateContent and structured JSON schema output.";
    }
  } else if (supportsGenerateContent && lowerId.includes("thinking")) {
    recommendation = "UNSUPPORTED";
    recommendationNote = "Thinking model produces unstructured reasoning tokens incompatible with schema.json.";
  }

  return {
    id,
    displayName,
    supportsGenerateContent,
    supportsStructuredJson,
    inputTokenLimit: raw.inputTokenLimit ?? null,
    outputTokenLimit: raw.outputTokenLimit ?? null,
    recommendation,
    recommendationNote,
  };
}

/**
 * Queries Google's supported Gemini ListModels endpoint using the provided API key.
 * Never logs or prints the API key.
 */
export async function fetchAccessibleModels(
  apiKey: string,
  fetchFn: typeof fetch = fetch
): Promise<RawGeminiModel[]> {
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetchFn(endpoint, {
      method: "GET",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      let errText = "";
      try {
        const errJson = await response.json();
        errText = errJson?.error?.message || JSON.stringify(errJson);
      } catch {
        errText = await response.text();
      }
      const sanitized = errText.replace(/key=[a-zA-Z0-9_\-]+/gi, "key=[REDACTED]");
      throw new Error(`Google API returned status ${response.status}: ${sanitized}`);
    }

    const data = await response.json();
    return Array.isArray(data?.models) ? data.models : [];
  } catch (err: any) {
    const rawMsg = err?.message || "Failed to fetch model list from Google API";
    const sanitized = rawMsg.replace(/key=[a-zA-Z0-9_\-]+/gi, "key=[REDACTED]");
    throw new Error(sanitized);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Formats model assessments into a clean, human-readable CLI summary table.
 */
export function formatModelTable(models: ModelAssessment[], currentModel: string): string {
  const lines: string[] = [];

  lines.push("=========================================================================================");
  lines.push(" Salesforce Build Readiness Checker - Accessible Gemini Models Diagnosis");
  lines.push("=========================================================================================");
  lines.push(`Active Model in .env.local: ${currentModel}`);
  lines.push("");

  const structuredModels = models.filter((m) => m.supportsStructuredJson);
  const unsupportedModels = models.filter((m) => !m.supportsStructuredJson);

  lines.push(`Total Models Accessible: ${models.length} (${structuredModels.length} support structured JSON Schema)`);
  lines.push("");
  lines.push("-----------------------------------------------------------------------------------------");
  lines.push(
    " " +
      "Model ID (for .env.local)".padEnd(30) +
      " " +
      "Structured JSON".padEnd(17) +
      " " +
      "Recommendation".padEnd(20) +
      " " +
      "Notes"
  );
  lines.push("-----------------------------------------------------------------------------------------");

  for (const m of structuredModels) {
    const recTag =
      m.id === currentModel
        ? "[CURRENT]"
        : m.recommendation === "RECOMMENDED"
        ? "RECOMMENDED"
        : m.recommendation === "COMPATIBLE"
        ? "COMPATIBLE"
        : m.recommendation === "EVALUATE_FAST"
        ? "EVALUATE FAST"
        : "UNSUPPORTED";

    lines.push(
      " " +
        m.id.padEnd(30) +
        " " +
        "YES (Schema)".padEnd(17) +
        " " +
        recTag.padEnd(20) +
        " " +
        m.recommendationNote
    );
  }

  if (unsupportedModels.length > 0) {
    lines.push("-----------------------------------------------------------------------------------------");
    lines.push(`Other Models (No Structured JSON Support): ${unsupportedModels.map((u) => u.id).join(", ")}`);
  }

  lines.push("=========================================================================================\n");
  lines.push("To test an alternative model without changing code:");
  lines.push("1. Open .env.local");
  lines.push("2. Update: LLM_MODEL=<selected-model-id>  (e.g. LLM_MODEL=gemini-2.0-flash)");
  lines.push("3. Restart dev server (npm run dev) or run evaluation CLI.");
  lines.push("=========================================================================================");

  return lines.join("\n");
}

export async function main() {
  loadEnvironment();

  const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  const currentModel = resolveModelName();

  console.log("=========================================================================================");
  console.log(" Querying Google Gemini Models API (v1beta)...");
  console.log(` Configured Key: ${maskApiKey(apiKey)}`);
  console.log(` Current Model:  ${currentModel}`);
  console.log("=========================================================================================\n");

  if (!apiKey) {
    console.error("❌ Error: No GEMINI_API_KEY or LLM_API_KEY found in environment or .env.local.");
    console.error("Please add your Gemini API key to .env.local to query accessible models.\n");
    process.exit(1);
  }

  try {
    const rawModels = await fetchAccessibleModels(apiKey);
    const assessed = rawModels.map((m) => assessModel(m, currentModel));
    const table = formatModelTable(assessed, currentModel);
    console.log(table);
  } catch (err: any) {
    console.error(`\n❌ Failed to query Gemini models: ${err.message}\n`);
    process.exit(1);
  }
}

// Auto-run if executed directly via CLI
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
