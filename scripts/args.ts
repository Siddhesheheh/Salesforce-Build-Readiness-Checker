// Argument parsing helpers — exported for testability

export const VALID_EXTRA_TESTS = ["injection", "vague", "nonsense"] as const;
export type ExtraTestName = (typeof VALID_EXTRA_TESTS)[number];

export interface RunArgs {
  isSmoke: boolean;
  resumeFilePath: string | null;
  sampleFilter: string | null;   // basename without .txt, e.g. "06-complete-renewal-reminders"
  runsOverride: number | null;   // 1-10, overrides default 5 (or 1 for smoke)
  extraFilter: ExtraTestName | null; // "injection" | "vague" | "nonsense"
  errors: string[];              // non-empty means invalid args
}

/** Parse process.argv-style argument list into structured RunArgs. */
export function parseRunArgs(argv: string[]): RunArgs {
  const errors: string[] = [];
  const isSmoke = argv.includes("--smoke");

  // --resume <path>
  const resumeIdx = argv.indexOf("--resume");
  const resumeFilePath =
    resumeIdx !== -1 && argv[resumeIdx + 1] && !argv[resumeIdx + 1].startsWith("--")
      ? argv[resumeIdx + 1]
      : null;
  if (resumeIdx !== -1 && !resumeFilePath) {
    errors.push("--resume requires a file path argument, e.g. --resume results/run-xxx.json");
  }

  // --sample <name-or-id>
  const sampleIdx = argv.indexOf("--sample");
  const rawSample =
    sampleIdx !== -1 && argv[sampleIdx + 1] && !argv[sampleIdx + 1].startsWith("--")
      ? argv[sampleIdx + 1]
      : null;
  if (sampleIdx !== -1 && !rawSample) {
    errors.push("--sample requires a sample id, e.g. --sample 06-complete-renewal-reminders");
  }
  // Normalize: strip optional .txt suffix
  const sampleFilter = rawSample ? rawSample.replace(/\.txt$/, "") : null;

  // --runs <n>
  const runsIdx = argv.indexOf("--runs");
  const rawRuns =
    runsIdx !== -1 && argv[runsIdx + 1] && !argv[runsIdx + 1].startsWith("--")
      ? argv[runsIdx + 1]
      : null;
  let runsOverride: number | null = null;
  if (runsIdx !== -1) {
    if (!rawRuns) {
      errors.push("--runs requires an integer argument, e.g. --runs 1");
    } else {
      const parsed = parseInt(rawRuns, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 10) {
        errors.push(`--runs must be an integer between 1 and 10 (got "${rawRuns}")`);
      } else {
        runsOverride = parsed;
      }
    }
  }

  // --extra <name>
  const extraIdx = argv.indexOf("--extra");
  const rawExtra =
    extraIdx !== -1 && argv[extraIdx + 1] && !argv[extraIdx + 1].startsWith("--")
      ? argv[extraIdx + 1]
      : null;
  let extraFilter: ExtraTestName | null = null;
  if (extraIdx !== -1) {
    if (!rawExtra) {
      errors.push("--extra requires a test name: injection, vague, or nonsense");
    } else {
      const normalized = rawExtra.toLowerCase();
      if (!VALID_EXTRA_TESTS.includes(normalized as ExtraTestName)) {
        errors.push(
          `--extra must be one of: ${VALID_EXTRA_TESTS.join(", ")} (got "${rawExtra}")`
        );
      } else {
        extraFilter = normalized as ExtraTestName;
      }
    }
  }

  // Mutual-exclusion: --smoke cannot be combined with --sample, --runs, --resume, or --extra
  if (isSmoke && (sampleFilter || runsOverride !== null || resumeFilePath || extraIdx !== -1)) {
    errors.push("--smoke cannot be combined with --sample, --runs, --resume, or --extra");
  }

  // Mutual-exclusion: --extra cannot be combined with --sample, --smoke, or --resume
  if (extraIdx !== -1 && (sampleFilter || isSmoke || resumeFilePath)) {
    errors.push("--extra cannot be combined with --sample, --smoke, or --resume");
  }

  return { isSmoke, resumeFilePath, sampleFilter, runsOverride, extraFilter, errors };
}

/** Helper to filter sample files based on RunArgs. Exported for testing isolation. */
export function filterSamplesForRun(
  allSamples: string[],
  args: Pick<RunArgs, "isSmoke" | "sampleFilter" | "extraFilter">
): string[] {
  if (args.extraFilter) {
    return [];
  }
  if (args.isSmoke) {
    return allSamples.slice(0, 1);
  }
  if (args.sampleFilter) {
    const matched = allSamples.find(
      (f) => f === `${args.sampleFilter}.txt` || f.replace(/\.txt$/, "") === args.sampleFilter
    );
    return matched ? [matched] : [];
  }
  return allSamples;
}

/** Helper to determine if a specific extra test should run. Exported for testing isolation. */
export function isExtraTestEnabled(
  test: ExtraTestName,
  extraFilter: ExtraTestName | null
): boolean {
  if (!extraFilter) return true;
  return extraFilter === test;
}
