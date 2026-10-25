import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assessModel,
  maskApiKey,
  fetchAccessibleModels,
  formatModelTable,
  RawGeminiModel,
} from "../scripts/list-models";
import { resolveModelName } from "../lib/llm";

describe("Model Configuration & Diagnosis (Prompt E)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("resolveModelName", () => {
    it("defaults to gemini-3.8-flash when LLM_MODEL is not set", () => {
      delete process.env.LLM_MODEL;
      expect(resolveModelName()).toBe("gemini-3.8-flash");
    });

    it("respects LLM_MODEL from environment", () => {
      process.env.LLM_MODEL = "gemini-2.0-flash";
      expect(resolveModelName()).toBe("gemini-2.0-flash");
    });

    it("trims surrounding whitespace from model name", () => {
      process.env.LLM_MODEL = "   gemini-1.5-flash \r\n";
      expect(resolveModelName()).toBe("gemini-1.5-flash");
    });

    it("strips leading 'models/' prefix if user copies full resource name from API", () => {
      process.env.LLM_MODEL = "models/gemini-2.0-flash";
      expect(resolveModelName()).toBe("gemini-2.0-flash");
    });

    it("allows explicit programmatic override via argument", () => {
      process.env.LLM_MODEL = "gemini-3.8-flash";
      expect(resolveModelName("models/gemini-2.5-pro")).toBe("gemini-2.5-pro");
    });
  });

  describe("maskApiKey", () => {
    it("masks API keys properly and hides secret characters", () => {
      const masked = maskApiKey("AIzaSyD-TestKey1234567890SecretKey");
      expect(masked).toBe("AIzaSy...tKey (34 chars)");
      expect(masked).not.toContain("TestKey1234567890");
    });

    it("returns safe placeholder when key is empty or undefined", () => {
      expect(maskApiKey(null)).toBe("[NOT SET]");
      expect(maskApiKey(undefined)).toBe("[NOT SET]");
      expect(maskApiKey("")).toBe("[NOT SET]");
    });
  });

  describe("assessModel", () => {
    const rawFlash20: RawGeminiModel = {
      name: "models/gemini-2.0-flash",
      displayName: "Gemini 2.0 Flash",
      supportedGenerationMethods: ["generateContent", "countTokens"],
      inputTokenLimit: 1048576,
      outputTokenLimit: 8192,
    };

    const rawEmbedding: RawGeminiModel = {
      name: "models/text-embedding-004",
      displayName: "Text Embedding 004",
      supportedGenerationMethods: ["embedContent"],
    };

    const rawThinking: RawGeminiModel = {
      name: "models/gemini-2.0-flash-thinking-exp-01-21",
      displayName: "Gemini 2.0 Flash Thinking",
      supportedGenerationMethods: ["generateContent"],
    };

    const rawFlash15: RawGeminiModel = {
      name: "models/gemini-1.5-flash",
      displayName: "Gemini 1.5 Flash",
      supportedGenerationMethods: ["generateContent", "countTokens"],
      inputTokenLimit: 1048576,
      outputTokenLimit: 8192,
    };

    const rawPro15: RawGeminiModel = {
      name: "models/gemini-1.5-pro",
      displayName: "Gemini 1.5 Pro",
      supportedGenerationMethods: ["generateContent", "countTokens"],
      inputTokenLimit: 2097152,
      outputTokenLimit: 8192,
    };

    it("identifies gemini-2.0-flash as supporting structured JSON and recommends it", () => {
      const assessed = assessModel(rawFlash20, "gemini-3.8-flash");
      expect(assessed.id).toBe("gemini-2.0-flash");
      expect(assessed.supportsGenerateContent).toBe(true);
      expect(assessed.supportsStructuredJson).toBe(true);
      expect(assessed.recommendation).toBe("RECOMMENDED");
    });

    it("identifies embedding models as unsupported for text and JSON schema", () => {
      const assessed = assessModel(rawEmbedding, "gemini-3.8-flash");
      expect(assessed.id).toBe("text-embedding-004");
      expect(assessed.supportsGenerateContent).toBe(false);
      expect(assessed.supportsStructuredJson).toBe(false);
      expect(assessed.recommendation).toBe("UNSUPPORTED");
    });

    it("identifies thinking models as unsupported for strict JSON schema output", () => {
      const assessed = assessModel(rawThinking, "gemini-3.8-flash");
      expect(assessed.supportsGenerateContent).toBe(true);
      expect(assessed.supportsStructuredJson).toBe(false);
      expect(assessed.recommendation).toBe("UNSUPPORTED");
    });

    it("identifies gemini-1.5-flash as RECOMMENDED", () => {
      const assessed = assessModel(rawFlash15, "gemini-3.8-flash");
      expect(assessed.supportsStructuredJson).toBe(true);
      expect(assessed.recommendation).toBe("RECOMMENDED");
    });

    it("identifies gemini-1.5-pro as COMPATIBLE with reasoning note", () => {
      const assessed = assessModel(rawPro15, "gemini-3.8-flash");
      expect(assessed.supportsStructuredJson).toBe(true);
      expect(assessed.recommendation).toBe("COMPATIBLE");
    });

    it("identifies the active model as CURRENT_MODEL", () => {
      const assessed = assessModel(rawFlash20, "gemini-2.0-flash");
      expect(assessed.recommendation).toBe("CURRENT_MODEL");
    });
  });

  describe("fetchAccessibleModels", () => {
    it("queries v1beta/models endpoint using header auth and returns parsed list", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-1.5-flash", supportedGenerationMethods: ["generateContent"] },
          ],
        }),
      });

      const models = await fetchAccessibleModels("test-key", mockFetch as any);
      expect(models.length).toBe(2);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "x-goog-api-key": "test-key",
          }),
        })
      );
    });

    it("sanitizes API keys from error messages if upstream fails", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: { message: "Permission denied for key=AIzaSySecretApiKey123" },
        }),
      });

      await expect(fetchAccessibleModels("test-key", mockFetch as any)).rejects.toThrow(
        /Google API returned status 403: Permission denied for key=\[REDACTED\]/
      );
    });
  });

  describe("formatModelTable", () => {
    it("renders formatted table with structured models, active indicators, and config instructions", () => {
      const assessed = [
        assessModel(
          { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
          "gemini-3.8-flash"
        ),
        assessModel(
          { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
          "gemini-3.8-flash"
        ),
        assessModel(
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          "gemini-3.8-flash"
        ),
      ];

      const table = formatModelTable(assessed, "gemini-3.8-flash");
      expect(table).toContain("Active Model in .env.local: gemini-3.8-flash");
      expect(table).toContain("gemini-2.0-flash");
      expect(table).toContain("gemini-3.8-flash");
      expect(table).toContain("[CURRENT]");
      expect(table).toContain("RECOMMENDED");
      expect(table).toContain("Other Models (No Structured JSON Support): text-embedding-004");
      expect(table).toContain("Update: LLM_MODEL=<selected-model-id>");
    });
  });
});
