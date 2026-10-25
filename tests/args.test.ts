import { describe, it, expect } from "vitest";
import { parseRunArgs, filterSamplesForRun, isExtraTestEnabled } from "../scripts/args";

describe("scripts/args: parseRunArgs", () => {
  it("defaults: no flags → full evaluation, 5 runs, no filter, no resume", () => {
    const a = parseRunArgs([]);
    expect(a.isSmoke).toBe(false);
    expect(a.sampleFilter).toBeNull();
    expect(a.runsOverride).toBeNull();
    expect(a.resumeFilePath).toBeNull();
    expect(a.extraFilter).toBeNull();
    expect(a.maxCalls).toBeNull();
    expect(a.minIntervalSeconds).toBe(20);
    expect(a.errors).toHaveLength(0);
  });

  it("--smoke sets isSmoke and produces no errors", () => {
    const a = parseRunArgs(["--smoke"]);
    expect(a.isSmoke).toBe(true);
    expect(a.errors).toHaveLength(0);
  });

  it("--sample <id> sets sampleFilter", () => {
    const a = parseRunArgs(["--sample", "06-complete-renewal-reminders"]);
    expect(a.sampleFilter).toBe("06-complete-renewal-reminders");
    expect(a.errors).toHaveLength(0);
  });

  it("--sample strips .txt suffix", () => {
    const a = parseRunArgs(["--sample", "06-complete-renewal-reminders.txt"]);
    expect(a.sampleFilter).toBe("06-complete-renewal-reminders");
    expect(a.errors).toHaveLength(0);
  });

  it("--runs <n> sets runsOverride", () => {
    const a = parseRunArgs(["--runs", "1"]);
    expect(a.runsOverride).toBe(1);
    expect(a.errors).toHaveLength(0);
  });

  it("--sample and --runs can be combined", () => {
    const a = parseRunArgs(["--sample", "06-complete-renewal-reminders", "--runs", "1"]);
    expect(a.sampleFilter).toBe("06-complete-renewal-reminders");
    expect(a.runsOverride).toBe(1);
    expect(a.errors).toHaveLength(0);
  });

  it("--resume <path> sets resumeFilePath", () => {
    const a = parseRunArgs(["--resume", "results/run-xxx.json"]);
    expect(a.resumeFilePath).toBe("results/run-xxx.json");
    expect(a.errors).toHaveLength(0);
  });

  it("--sample and --resume can be combined", () => {
    const a = parseRunArgs(["--resume", "results/run-xxx.json", "--sample", "03-manuscript-reviewer"]);
    expect(a.resumeFilePath).toBe("results/run-xxx.json");
    expect(a.sampleFilter).toBe("03-manuscript-reviewer");
    expect(a.errors).toHaveLength(0);
  });

  it("--sample without a value produces an error", () => {
    const a = parseRunArgs(["--sample"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/--sample requires/);
  });

  it("--runs without a value produces an error", () => {
    const a = parseRunArgs(["--runs"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/--runs requires/);
  });

  it("--runs with a non-integer value produces an error", () => {
    const a = parseRunArgs(["--runs", "abc"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/integer between 1 and 10/);
  });

  it("--runs 0 is rejected (below min)", () => {
    const a = parseRunArgs(["--runs", "0"]);
    expect(a.errors.length).toBeGreaterThan(0);
  });

  it("--runs 11 is rejected (above max)", () => {
    const a = parseRunArgs(["--runs", "11"]);
    expect(a.errors.length).toBeGreaterThan(0);
  });

  it("--resume without a value produces an error", () => {
    const a = parseRunArgs(["--resume"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/--resume requires a file path/);
  });

  it("--smoke combined with --sample produces a mutual-exclusion error", () => {
    const a = parseRunArgs(["--smoke", "--sample", "06-complete-renewal-reminders"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors.some((e) => e.includes("--smoke cannot be combined"))).toBe(true);
  });

  it("--smoke combined with --runs produces a mutual-exclusion error", () => {
    const a = parseRunArgs(["--smoke", "--runs", "3"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors.some((e) => e.includes("--smoke cannot be combined"))).toBe(true);
  });

  it("--smoke combined with --resume produces a mutual-exclusion error", () => {
    const a = parseRunArgs(["--smoke", "--resume", "results/run-xxx.json"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors.some((e) => e.includes("--smoke cannot be combined"))).toBe(true);
  });

  // --extra flag tests
  it("--extra injection sets extraFilter to 'injection'", () => {
    const a = parseRunArgs(["--extra", "injection"]);
    expect(a.extraFilter).toBe("injection");
    expect(a.errors).toHaveLength(0);
  });

  it("--extra vague sets extraFilter to 'vague'", () => {
    const a = parseRunArgs(["--extra", "vague"]);
    expect(a.extraFilter).toBe("vague");
    expect(a.errors).toHaveLength(0);
  });

  it("--extra nonsense sets extraFilter to 'nonsense'", () => {
    const a = parseRunArgs(["--extra", "nonsense"]);
    expect(a.extraFilter).toBe("nonsense");
    expect(a.errors).toHaveLength(0);
  });

  it("--extra is case-insensitive", () => {
    const a = parseRunArgs(["--extra", "INJECTION"]);
    expect(a.extraFilter).toBe("injection");
    expect(a.errors).toHaveLength(0);
  });

  it("--extra without an argument produces an error", () => {
    const a = parseRunArgs(["--extra"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/--extra requires a test name/);
  });

  it("--extra with an invalid test name produces an error listing valid names", () => {
    const a = parseRunArgs(["--extra", "foobar"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/--extra must be one of: injection, vague, nonsense/);
  });

  it("--extra combined with --sample produces a mutual-exclusion error", () => {
    const a = parseRunArgs(["--extra", "injection", "--sample", "06-complete-renewal-reminders"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors.some((e) => e.includes("--extra cannot be combined with --sample, --smoke, or --resume"))).toBe(true);
  });

  it("--extra combined with --smoke produces a mutual-exclusion error", () => {
    const a = parseRunArgs(["--extra", "injection", "--smoke"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors.some((e) => e.includes("--extra cannot be combined with --sample, --smoke, or --resume"))).toBe(true);
  });

  it("--smoke combined with --extra produces a mutual-exclusion error", () => {
    const a = parseRunArgs(["--smoke", "--extra", "injection"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors.some((e) => e.includes("--smoke cannot be combined"))).toBe(true);
  });

  it("--extra combined with --resume produces a mutual-exclusion error", () => {
    const a = parseRunArgs(["--extra", "injection", "--resume", "results/run-xxx.json"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors.some((e) => e.includes("--extra cannot be combined with --sample, --smoke, or --resume"))).toBe(true);
  });

  // --max-calls flag tests
  it("--max-calls <n> sets maxCalls to positive integer", () => {
    const a = parseRunArgs(["--max-calls", "10"]);
    expect(a.maxCalls).toBe(10);
    expect(a.errors).toHaveLength(0);
  });

  it("--max-calls 1 is accepted", () => {
    const a = parseRunArgs(["--max-calls", "1"]);
    expect(a.maxCalls).toBe(1);
    expect(a.errors).toHaveLength(0);
  });

  it("--max-calls without value produces an error", () => {
    const a = parseRunArgs(["--max-calls"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/--max-calls requires a positive integer/);
  });

  it("--max-calls 0 is rejected (not positive)", () => {
    const a = parseRunArgs(["--max-calls", "0"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/--max-calls must be a positive integer/);
  });

  it("--max-calls negative number is rejected", () => {
    const a = parseRunArgs(["--max-calls", "-3"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/--max-calls must be a positive integer/);
  });

  it("--max-calls non-integer string is rejected", () => {
    const a = parseRunArgs(["--max-calls", "ten"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/--max-calls must be a positive integer/);
  });

  it("--max-calls decimal number is rejected", () => {
    const a = parseRunArgs(["--max-calls", "2.5"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/--max-calls must be a positive integer/);
  });

  it("--max-calls can combine with --resume", () => {
    const a = parseRunArgs(["--resume", "results/run-xxx.json", "--max-calls", "10"]);
    expect(a.resumeFilePath).toBe("results/run-xxx.json");
    expect(a.maxCalls).toBe(10);
    expect(a.errors).toHaveLength(0);
  });

  it("--max-calls can combine with --sample and --runs", () => {
    const a = parseRunArgs(["--sample", "02-royalty-approval", "--runs", "1", "--max-calls", "3"]);
    expect(a.sampleFilter).toBe("02-royalty-approval");
    expect(a.runsOverride).toBe(1);
    expect(a.maxCalls).toBe(3);
    expect(a.errors).toHaveLength(0);
  });

  it("--max-calls can combine with --smoke", () => {
    const a = parseRunArgs(["--smoke", "--max-calls", "1"]);
    expect(a.isSmoke).toBe(true);
    expect(a.maxCalls).toBe(1);
    expect(a.errors).toHaveLength(0);
  });

  it("--max-calls can combine with --extra", () => {
    const a = parseRunArgs(["--extra", "injection", "--max-calls", "2"]);
    expect(a.extraFilter).toBe("injection");
    expect(a.maxCalls).toBe(2);
    expect(a.errors).toHaveLength(0);
  });

  // --min-interval / --delay flag tests
  it("--min-interval sets custom pacing interval", () => {
    const a = parseRunArgs(["--min-interval", "15"]);
    expect(a.minIntervalSeconds).toBe(15);
    expect(a.errors).toHaveLength(0);
  });

  it("--delay alias sets custom pacing interval", () => {
    const a = parseRunArgs(["--delay", "5"]);
    expect(a.minIntervalSeconds).toBe(5);
    expect(a.errors).toHaveLength(0);
  });

  it("--min-interval 0 is accepted (e.g. for fast mocked testing)", () => {
    const a = parseRunArgs(["--min-interval", "0"]);
    expect(a.minIntervalSeconds).toBe(0);
    expect(a.errors).toHaveLength(0);
  });

  it("--min-interval without value produces an error", () => {
    const a = parseRunArgs(["--min-interval"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/--min-interval requires a number of seconds/);
  });

  it("--min-interval negative number produces an error", () => {
    const a = parseRunArgs(["--min-interval", "-5"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/must be a non-negative number/);
  });

  it("--min-interval non-numeric string produces an error", () => {
    const a = parseRunArgs(["--min-interval", "fast"]);
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors[0]).toMatch(/must be a non-negative number/);
  });
});

describe("scripts/args: isolation helpers", () => {
  const allSamples = [
    "01-lead-assignment.txt",
    "02-royalty-approval.txt",
    "03-manuscript-reviewer.txt",
    "04-case-escalation.txt",
    "05-stale-opportunities.txt",
    "06-complete-renewal-reminders.txt",
  ];

  it("filterSamplesForRun skips all sample files when extraFilter is set", () => {
    const selected = filterSamplesForRun(allSamples, {
      extraFilter: "injection",
      isSmoke: false,
      sampleFilter: null,
    });
    expect(selected).toEqual([]);
  });

  it("filterSamplesForRun returns single sample when sampleFilter is set", () => {
    const selected = filterSamplesForRun(allSamples, {
      extraFilter: null,
      isSmoke: false,
      sampleFilter: "06-complete-renewal-reminders",
    });
    expect(selected).toEqual(["06-complete-renewal-reminders.txt"]);
  });

  it("filterSamplesForRun returns first sample when isSmoke is true", () => {
    const selected = filterSamplesForRun(allSamples, {
      extraFilter: null,
      isSmoke: true,
      sampleFilter: null,
    });
    expect(selected).toEqual(["01-lead-assignment.txt"]);
  });

  it("filterSamplesForRun returns all samples in full run", () => {
    const selected = filterSamplesForRun(allSamples, {
      extraFilter: null,
      isSmoke: false,
      sampleFilter: null,
    });
    expect(selected).toEqual(allSamples);
  });

  it("isExtraTestEnabled isolates the selected test when extraFilter is active", () => {
    expect(isExtraTestEnabled("injection", "injection")).toBe(true);
    expect(isExtraTestEnabled("vague", "injection")).toBe(false);
    expect(isExtraTestEnabled("nonsense", "injection")).toBe(false);
  });

  it("isExtraTestEnabled enables all extra tests when extraFilter is null", () => {
    expect(isExtraTestEnabled("injection", null)).toBe(true);
    expect(isExtraTestEnabled("vague", null)).toBe(true);
    expect(isExtraTestEnabled("nonsense", null)).toBe(true);
  });
});
