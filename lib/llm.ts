/**
 * Server-side LLM provider integration for Google Gemini API.
 * Never call this from client/browser code.
 */

export class UpstreamApiError extends Error {
  statusCode?: number;
  isQuotaExceeded?: boolean;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "UpstreamApiError";
    this.statusCode = statusCode;
    this.isQuotaExceeded = statusCode === 429 || /quota/i.test(message);
  }
}

export async function callModel(system: string, user: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "gemini-3.8-flash";

  if (!apiKey) {
    throw new UpstreamApiError("GEMINI_API_KEY or LLM_API_KEY is not set in environment.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    systemInstruction: {
      parts: [{ text: system }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: user }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorDetails = "";
    try {
      const errJson = await response.json();
      errorDetails = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetails = await response.text();
    }
    const sanitizedError = errorDetails.replace(/key=[a-zA-Z0-9_\-]+/gi, "key=[REDACTED]");
    throw new UpstreamApiError(
      `Gemini API call failed with status ${response.status}: ${sanitizedError}`,
      response.status
    );
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0];

  if (!candidate || !candidate.content?.parts?.[0]?.text) {
    const finishReason = candidate?.finishReason || "unknown";
    throw new UpstreamApiError(`Gemini returned empty response (finishReason: ${finishReason})`);
  }

  const rawText = candidate.content.parts[0].text;
  return cleanJsonOutput(rawText);
}

function cleanJsonOutput(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```json")) {
    return trimmed.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  }
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return trimmed;
}
