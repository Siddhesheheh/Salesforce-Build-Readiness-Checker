"use client";

import React, { useState } from "react";
import { Finding, Severity } from "@/lib/types";
import {
  FindingFeedback,
  FindingRating,
  ThumbsDownReason,
  THUMBS_DOWN_REASONS,
  OverallFeedback,
  FeedbackAnswer,
  ReviewSession,
  ReviewVersion,
} from "@/lib/workflow-types";
import { compareVersions, buildRecheckInput } from "@/lib/workflow-recheck";
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  AlertCircleIcon,
  InfoIcon,
  CopyIcon,
  CheckIcon,
  ArrowLeftIcon,
  SearchIcon,
  DownloadIcon,
  TrashIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  SpinnerIcon,
  HistoryIcon,
} from "./Icons";
import { copyToClipboard, formatClarifyingQuestions } from "@/lib/clipboard";

interface ResultsViewProps {
  report?: any;
  requirement?: string;
  session?: ReviewSession;
  currentVersion?: ReviewVersion;
  onSelectVersion?: (versionNumber: number) => void;
  onUpdateFindingFeedback?: (findingId: number, feedback: FindingFeedback | null) => void;
  onUpdateAnswer?: (findingId: number, answerText: string) => void;
  onUpdateOverallFeedback?: (feedback: OverallFeedback) => void;
  onRecheck?: () => Promise<void>;
  isRechecking?: boolean;
  recheckError?: { title: string; message: string } | string | null;
  onReset?: () => void;
  onExport?: () => void;
  onClearHistory?: () => void;
}

export function ResultsView({
  report: legacyReport,
  requirement: legacyReq,
  session: propSession,
  currentVersion: propVersion,
  onSelectVersion = () => {},
  onUpdateFindingFeedback = () => {},
  onUpdateAnswer = () => {},
  onUpdateOverallFeedback = () => {},
  onRecheck = async () => {},
  isRechecking = false,
  recheckError = null,
  onReset = () => {},
  onExport = () => {},
  onClearHistory = () => {},
}: ResultsViewProps) {
  const currentVersion: ReviewVersion =
    propVersion || {
      versionNumber: 1,
      timestamp: new Date().toISOString(),
      submittedRequirement: legacyReq || "",
      report: legacyReport!,
      findingFeedback: {},
      answers: {},
    };

  const session: ReviewSession =
    propSession || {
      sessionId: "session_default",
      originalRequirement: legacyReq || "",
      versions: [currentVersion],
      currentVersionNumber: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [copiedFindingId, setCopiedFindingId] = useState<number | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [activeAnswerId, setActiveAnswerId] = useState<number | null>(null);
  const [editingAnswerText, setEditingAnswerText] = useState<string>("");
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);

  // Thumbs down reason state map (for inline feedback)
  const [feedbackEditingId, setFeedbackEditingId] = useState<number | null>(null);
  const [selectedReason, setSelectedReason] = useState<ThumbsDownReason>("Already covered in requirement");
  const [feedbackComment, setFeedbackComment] = useState<string>("");

  const report = currentVersion.report;
  const verdict = report.readiness_verdict;
  const isReady = verdict === "Ready to build";
  const isNeedsClarification = verdict === "Needs clarification";
  const isNotReady = verdict === "Not ready to build";

  const isSimulated =
    report.summary.includes("MOCK") || report.summary.includes("SIMULATED");

  // Comparison logic if version > 1
  const previousVersion =
    currentVersion.versionNumber > 1
      ? session.versions.find((v) => v.versionNumber === currentVersion.versionNumber - 1)
      : null;

  const comparison = previousVersion
    ? compareVersions(previousVersion, currentVersion)
    : null;

  // Answer stats
  const questionsCount = report.findings.filter((f) => Boolean(f.question_for_pm?.trim())).length;
  const answeredCount = Object.values(currentVersion.answers || {}).filter(
    (a) => a && a.answerText.trim().length > 0
  ).length;

  const canRecheck = answeredCount > 0 && !isRechecking;

  // Character limit validation preview for recheck
  const recheckValidation = buildRecheckInput(
    session.originalRequirement,
    currentVersion.answers || {},
    report.findings
  );

  const handleCopyAll = async () => {
    const text = formatClarifyingQuestions(report);
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2500);
    }
  };

  const handleCopyQuestion = async (finding: Finding) => {
    const text = `Question: ${finding.question_for_pm}\nContext: ${finding.title} (${finding.category})\nWhy it matters: ${finding.why_it_matters}`;
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedFindingId(finding.id);
      setTimeout(() => setCopiedFindingId(null), 2000);
    }
  };

  // Feedback Handlers
  const handleRate = (findingId: number, rating: FindingRating) => {
    const currentFb = currentVersion.findingFeedback?.[findingId];

    // If clicking same rating, remove it
    if (currentFb?.rating === rating) {
      onUpdateFindingFeedback(findingId, null);
      setFeedbackEditingId(null);
      return;
    }

    if (rating === "useful") {
      onUpdateFindingFeedback(findingId, {
        findingId,
        rating: "useful",
        updatedAt: new Date().toISOString(),
      });
      setFeedbackEditingId(null);
    } else if (rating === "not_useful") {
      setFeedbackEditingId(findingId);
      setSelectedReason(currentFb?.reason || "Already covered in requirement");
      setFeedbackComment(currentFb?.comment || "");
    }
  };

  const handleSaveNegativeFeedback = (findingId: number) => {
    onUpdateFindingFeedback(findingId, {
      findingId,
      rating: "not_useful",
      reason: selectedReason,
      comment: feedbackComment.trim() || undefined,
      updatedAt: new Date().toISOString(),
    });
    setFeedbackEditingId(null);
  };

  // Structured Answer Handlers
  const handleOpenAnswer = (finding: Finding) => {
    const existing = currentVersion.answers?.[finding.id];
    setEditingAnswerText(existing?.answerText || "");
    setActiveAnswerId(finding.id);
  };

  const handleSaveAnswer = (findingId: number, question: string) => {
    onUpdateAnswer(findingId, editingAnswerText.trim());
    setActiveAnswerId(null);
  };

  const handleClearAnswer = (findingId: number) => {
    onUpdateAnswer(findingId, "");
    setEditingAnswerText("");
    setActiveAnswerId(null);
  };

  // Overall Feedback Handlers
  const currentOverall = currentVersion.overallFeedback || {
    identifiedNewGap: null,
    wouldUseBeforeKickoff: null,
    comments: "",
    updatedAt: new Date().toISOString(),
  };

  const handleUpdateOverall = (field: "identifiedNewGap" | "wouldUseBeforeKickoff", val: FeedbackAnswer) => {
    onUpdateOverallFeedback({
      ...currentOverall,
      [field]: val,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleOverallComment = (comments: string) => {
    onUpdateOverallFeedback({
      ...currentOverall,
      comments,
      updatedAt: new Date().toISOString(),
    });
  };

  const filteredFindings = report.findings.filter((f) => {
    if (severityFilter === "ALL") return true;
    return f.severity === severityFilter;
  });

  const getSeverityBadgeClass = (severity: Severity) => {
    switch (severity) {
      case "Blocker":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      case "Important":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "Minor":
        return "bg-sky-500/10 text-sky-400 border-sky-500/20";
      default:
        return "bg-zinc-800 text-zinc-300 border-white/[0.08]";
    }
  };

  const getCategoryStatusBadge = (status: string) => {
    switch (status) {
      case "Covered":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5"></span>
            Covered
          </span>
        );
      case "Partial":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mr-1.5"></span>
            Partial
          </span>
        );
      case "Missing":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mr-1.5"></span>
            Missing
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/[0.04] text-zinc-400 border border-white/[0.06]">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 mr-1.5"></span>
            N/A
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto py-8 px-4 sm:px-6 space-y-8">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center text-xs sm:text-sm font-medium text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
          Review another requirement
        </button>

        {/* Version Switcher Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {session.versions.length > 1 && (
            <div className="flex items-center space-x-1.5 bg-[#161920] p-1 rounded-lg border border-white/[0.08]">
              <HistoryIcon className="w-3.5 h-3.5 text-zinc-400 ml-1.5 mr-0.5" />
              {session.versions.map((ver) => (
                <button
                  key={ver.versionNumber}
                  type="button"
                  onClick={() => onSelectVersion(ver.versionNumber)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    ver.versionNumber === currentVersion.versionNumber
                      ? "bg-white/[0.1] text-white shadow-xs"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  v{ver.versionNumber}
                  {ver.versionNumber === session.versions.length && " (Latest)"}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleCopyAll}
            className="inline-flex items-center justify-center px-3.5 py-1.5 border border-white/[0.08] rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
          >
            {copiedAll ? (
              <>
                <CheckIcon className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
                <span className="text-emerald-300 font-semibold">Questions Copied!</span>
              </>
            ) : (
              <>
                <CopyIcon className="w-3.5 h-3.5 mr-1.5 text-zinc-400" />
                <span>Copy Clarifying Questions</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Simulated Banner if offline mock mode */}
      {isSimulated && (
        <div
          role="status"
          className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-3.5 flex items-center space-x-3 text-amber-200 shadow-xs"
        >
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 flex-shrink-0">
            Simulated
          </span>
          <p className="text-xs sm:text-sm font-medium">
            This review was generated in Offline Mock Mode using sample benchmark data. No live Gemini API calls were made.
          </p>
        </div>
      )}

      {/* Version Comparison Card (Part E) */}
      {comparison && (
        <section aria-labelledby="comparison-heading" className="bg-[#0f1115] border border-sky-500/20 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse"></span>
              <h2 id="comparison-heading" className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
                Readiness Progression &bull; Version {comparison.previousVersionNumber} &rarr; Version {comparison.currentVersionNumber}
              </h2>
            </div>
            <span className="text-[11px] text-zinc-400">
              Calculated difference between original and clarified review
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Verdict transition */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 space-y-1">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
                Verdict Transition
              </span>
              <div className="flex items-center space-x-3 text-sm font-bold">
                <span className="text-zinc-400 line-through">{comparison.previousVerdict}</span>
                <span className="text-sky-400">&rarr;</span>
                <span className={isReady ? "text-emerald-400" : isNeedsClarification ? "text-amber-400" : "text-rose-400"}>
                  {comparison.currentVerdict}
                </span>
              </div>
            </div>

            {/* Severity count changes */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 space-y-1">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
                Severity Count Net Changes
              </span>
              <div className="flex items-center space-x-4 text-xs font-mono">
                <span className={comparison.countDiffs.blockers <= 0 ? "text-emerald-400" : "text-rose-400"}>
                  Blockers: {comparison.countDiffs.blockers > 0 ? `+${comparison.countDiffs.blockers}` : comparison.countDiffs.blockers}
                </span>
                <span className={comparison.countDiffs.important <= 0 ? "text-emerald-400" : "text-amber-400"}>
                  Important: {comparison.countDiffs.important > 0 ? `+${comparison.countDiffs.important}` : comparison.countDiffs.important}
                </span>
                <span className="text-zinc-400">
                  Minor: {comparison.countDiffs.minor > 0 ? `+${comparison.countDiffs.minor}` : comparison.countDiffs.minor}
                </span>
              </div>
            </div>
          </div>

          {/* Category status diffs */}
          {comparison.categoryDiffs.some((c) => c.changed) && (
            <div className="pt-2">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
                Category Status Improvements:
              </span>
              <div className="flex flex-wrap gap-2">
                {comparison.categoryDiffs
                  .filter((c) => c.changed)
                  .map((diff) => (
                    <span
                      key={diff.category}
                      className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    >
                      <span className="font-medium text-zinc-300">{diff.category}:</span>
                      <span className="text-zinc-400">{diff.previousStatus}</span>
                      <span>&rarr;</span>
                      <span className="font-semibold text-emerald-400">{diff.currentStatus}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Verdict Banner (Visual Centerpiece) */}
      <section
        aria-labelledby="verdict-heading"
        className={`rounded-2xl p-6 sm:p-8 border shadow-2xl backdrop-blur-xl ${
          isReady
            ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-100"
            : isNeedsClarification
            ? "bg-amber-950/20 border-amber-500/30 text-amber-100"
            : "bg-rose-950/20 border-rose-500/30 text-rose-100"
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-3 flex-1">
            <div className="flex items-center space-x-2">
              {isReady && <CheckCircleIcon className="w-5 h-5 text-emerald-400" />}
              {isNeedsClarification && <AlertCircleIcon className="w-5 h-5 text-amber-400" />}
              {isNotReady && <AlertTriangleIcon className="w-5 h-5 text-rose-400" />}
              <span className="text-xs font-bold uppercase tracking-wider opacity-75">
                Readiness Verdict (Version {currentVersion.versionNumber})
              </span>
            </div>

            <h1 id="verdict-heading" className="text-2xl sm:text-4xl font-extrabold tracking-tight">
              {verdict}
            </h1>

            <p className="text-sm sm:text-base leading-relaxed opacity-90 max-w-3xl">
              {report.summary}
            </p>
          </div>

          {/* Counts Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:min-w-[340px]">
            <div className="bg-[#161920]/80 rounded-xl p-3 border border-white/[0.08] text-center">
              <span className="block text-2xl font-bold text-rose-400 tabular-nums">
                {report.counts.blockers}
              </span>
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Blockers
              </span>
            </div>

            <div className="bg-[#161920]/80 rounded-xl p-3 border border-white/[0.08] text-center">
              <span className="block text-2xl font-bold text-amber-400 tabular-nums">
                {report.counts.important}
              </span>
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Important
              </span>
            </div>

            <div className="bg-[#161920]/80 rounded-xl p-3 border border-white/[0.08] text-center">
              <span className="block text-2xl font-bold text-sky-400 tabular-nums">
                {report.counts.minor}
              </span>
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Minor
              </span>
            </div>

            <div className="bg-[#161920]/80 rounded-xl p-3 border border-white/[0.08] text-center">
              <span className="block text-2xl font-bold text-zinc-300 tabular-nums">
                {report.counts.questions}
              </span>
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Questions
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 10 Rubric Categories Strip / Grid */}
      <section aria-labelledby="rubric-heading" className="bg-[#0f1115] rounded-2xl border border-white/[0.08] p-6 shadow-sm space-y-4">
        <div>
          <h2 id="rubric-heading" className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
            Rubric Category Coverage
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Coverage status across all 10 Salesforce implementation readiness criteria.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {report.category_status.map((item) => (
            <div
              key={item.category}
              className="p-3 rounded-xl border border-white/[0.04] bg-white/[0.02] flex flex-col justify-between space-y-2"
            >
              <span className="text-xs font-medium text-zinc-300 leading-snug line-clamp-2">
                {item.category}
              </span>
              <div>{getCategoryStatusBadge(item.status)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Prioritized Findings Section */}
      <section aria-labelledby="findings-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 id="findings-heading" className="text-xl font-bold text-zinc-100">
              Prioritized Findings ({report.findings.length})
            </h2>
            <p className="text-xs text-zinc-400">
              Ranked in order of severity (Blocker &gt; Important &gt; Minor).
            </p>
          </div>

          {/* Severity filter buttons */}
          {report.findings.length > 0 && (
            <div className="flex items-center space-x-1.5 bg-[#161920] p-1 rounded-xl border border-white/[0.08] text-xs font-medium">
              <button
                type="button"
                onClick={() => setSeverityFilter("ALL")}
                className={`px-2.5 py-1 rounded-lg transition-colors ${
                  severityFilter === "ALL"
                    ? "bg-white/[0.1] text-white shadow-xs"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                All ({report.findings.length})
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter("Blocker")}
                className={`px-2.5 py-1 rounded-lg transition-colors ${
                  severityFilter === "Blocker"
                    ? "bg-rose-500/20 text-rose-300 shadow-xs"
                    : "text-zinc-400 hover:text-rose-300"
                }`}
              >
                Blockers ({report.counts.blockers})
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter("Important")}
                className={`px-2.5 py-1 rounded-lg transition-colors ${
                  severityFilter === "Important"
                    ? "bg-amber-500/20 text-amber-300 shadow-xs"
                    : "text-zinc-400 hover:text-amber-300"
                }`}
              >
                Important ({report.counts.important})
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter("Minor")}
                className={`px-2.5 py-1 rounded-lg transition-colors ${
                  severityFilter === "Minor"
                    ? "bg-sky-500/20 text-sky-300 shadow-xs"
                    : "text-zinc-400 hover:text-sky-300"
                }`}
              >
                Minor ({report.counts.minor})
              </button>
            </div>
          )}
        </div>

        {/* Empty State */}
        {report.findings.length === 0 ? (
          <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-8 text-center space-y-3">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
              <CheckCircleIcon className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-emerald-200">
              No Blockers or Gaps Detected
            </h3>
            <p className="text-xs sm:text-sm text-emerald-300/80 max-w-lg mx-auto">
              This requirement specification satisfies all 10 rubric categories. Ready for developer kickoff.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredFindings.map((finding) => {
              const feedback = currentVersion.findingFeedback?.[finding.id];
              const answer = currentVersion.answers?.[finding.id];
              const hasAnswer = Boolean(answer?.answerText?.trim());
              const isAnswering = activeAnswerId === finding.id;

              return (
                <div
                  key={finding.id}
                  className="bg-[#0f1115] rounded-2xl border border-white/[0.08] shadow-lg overflow-hidden"
                >
                  {/* Finding Card Header */}
                  <div className="bg-white/[0.02] border-b border-white/[0.06] px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center space-x-2.5">
                      <span className="text-xs font-bold text-zinc-500 font-mono">
                        #{finding.id}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getSeverityBadgeClass(
                          finding.severity
                        )}`}
                      >
                        {finding.severity}
                      </span>
                      <span className="text-xs font-medium text-zinc-400 bg-white/[0.04] border border-white/[0.06] px-2.5 py-0.5 rounded-full">
                        {finding.category}
                      </span>
                    </div>

                    {/* Controls: Thumbs Up/Down Feedback + Copy Question */}
                    <div className="flex items-center space-x-2">
                      {/* PART A: Finding Feedback Controls */}
                      <div className="flex items-center space-x-1 bg-[#161920] px-1.5 py-1 rounded-lg border border-white/[0.08]">
                        <button
                          type="button"
                          onClick={() => handleRate(finding.id, "useful")}
                          title={feedback?.rating === "useful" ? "Rating: Useful (Click to remove)" : "Rate as Useful"}
                          aria-label={`Rate Finding #${finding.id} as Useful`}
                          className={`p-1 rounded transition-colors ${
                            feedback?.rating === "useful"
                              ? "text-emerald-400 bg-emerald-500/20"
                              : "text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          <ThumbsUpIcon className="w-3.5 h-3.5" filled={feedback?.rating === "useful"} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRate(finding.id, "not_useful")}
                          title={feedback?.rating === "not_useful" ? "Rating: Not Useful (Click to edit/remove)" : "Rate as Not Useful"}
                          aria-label={`Rate Finding #${finding.id} as Not Useful`}
                          className={`p-1 rounded transition-colors ${
                            feedback?.rating === "not_useful"
                              ? "text-rose-400 bg-rose-500/20"
                              : "text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          <ThumbsDownIcon className="w-3.5 h-3.5" filled={feedback?.rating === "not_useful"} />
                        </button>
                      </div>

                      {finding.question_for_pm?.trim() && (
                        <button
                          type="button"
                          onClick={() => handleCopyQuestion(finding)}
                          className="inline-flex items-center text-xs font-medium text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] px-2.5 py-1 rounded-lg transition-colors"
                        >
                          {copiedFindingId === finding.id ? (
                            <>
                              <CheckIcon className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                              <span className="text-emerald-300 font-semibold">Copied</span>
                            </>
                          ) : (
                            <>
                              <CopyIcon className="w-3.5 h-3.5 mr-1 text-zinc-400" />
                              <span>Copy Question</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* PART A: Negative Feedback Reason Selector Card (Inline) */}
                  {feedbackEditingId === finding.id && (
                    <div className="bg-rose-950/20 border-b border-rose-500/20 px-6 py-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-rose-300">
                          Why is Finding #{finding.id} not useful?
                        </span>
                        <button
                          type="button"
                          onClick={() => setFeedbackEditingId(null)}
                          className="text-xs text-zinc-400 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {THUMBS_DOWN_REASONS.map((r) => (
                          <label
                            key={r}
                            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                              selectedReason === r
                                ? "bg-rose-500/20 border-rose-500/40 text-rose-200 font-medium"
                                : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`reason-${finding.id}`}
                              value={r}
                              checked={selectedReason === r}
                              onChange={() => setSelectedReason(r)}
                              className="text-rose-500 focus:ring-rose-500"
                            />
                            <span>{r}</span>
                          </label>
                        ))}
                      </div>

                      <input
                        type="text"
                        value={feedbackComment}
                        onChange={(e) => setFeedbackComment(e.target.value)}
                        placeholder="Optional explanation for the team..."
                        className="w-full text-xs rounded-lg border border-white/[0.08] bg-[#161920] px-3 py-1.5 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      />

                      <div className="flex justify-end space-x-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleSaveNegativeFeedback(finding.id)}
                          className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-md text-xs font-semibold shadow-xs"
                        >
                          Save Feedback
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Feedback Saved Badge */}
                  {feedback?.rating && feedbackEditingId !== finding.id && (
                    <div className="bg-white/[0.015] border-b border-white/[0.04] px-6 py-2 flex items-center justify-between text-[11px] text-zinc-400">
                      <span>
                        Rated:{" "}
                        <strong className={feedback.rating === "useful" ? "text-emerald-400" : "text-rose-400"}>
                          {feedback.rating === "useful" ? "Useful" : `Not Useful (${feedback.reason || "Unspecified"})`}
                        </strong>
                        {feedback.comment && ` — "${feedback.comment}"`}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRate(finding.id, feedback.rating)}
                        className="text-zinc-500 hover:text-zinc-300 underline"
                      >
                        Change
                      </button>
                    </div>
                  )}

                  {/* Finding Body */}
                  <div className="p-6 space-y-4 text-sm text-zinc-300">
                    <h3 className="text-base font-bold text-zinc-100">
                      {finding.title}
                    </h3>

                    {/* Evidence quote */}
                    <div className="bg-white/[0.02] border-l-2 border-zinc-600 px-4 py-2.5 rounded-r-lg text-xs sm:text-sm text-zinc-300 italic">
                      <span className="font-semibold not-italic text-zinc-400 block text-[11px] uppercase tracking-wider mb-0.5">
                        Evidence from Requirement:
                      </span>
                      &ldquo;{finding.evidence}&rdquo;
                    </div>

                    {/* Grid: What's Missing & Why It Matters */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                      <div className="bg-rose-950/20 border border-rose-500/20 rounded-xl p-3.5 space-y-1">
                        <span className="text-[11px] font-bold text-rose-300 uppercase tracking-wider block">
                          What&apos;s Missing:
                        </span>
                        <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                          {finding.whats_missing}
                        </p>
                      </div>

                      <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-3.5 space-y-1">
                        <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider block">
                          Why It Matters:
                        </span>
                        <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                          {finding.why_it_matters}
                        </p>
                      </div>
                    </div>

                    {/* Question for PM Highlight Box */}
                    {finding.question_for_pm?.trim() && (
                      <div className="bg-sky-950/20 border border-sky-500/20 rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-sky-300 uppercase tracking-wider flex items-center">
                            <InfoIcon className="w-4 h-4 mr-1 text-sky-400" />
                            Question for the PM / BA:
                          </span>

                          <button
                            type="button"
                            onClick={() => (isAnswering ? setActiveAnswerId(null) : handleOpenAnswer(finding))}
                            className="text-xs font-semibold text-sky-400 hover:text-sky-300 underline"
                          >
                            {isAnswering ? "Close Answer" : hasAnswer ? "Edit Decision" : "+ Answer Question"}
                          </button>
                        </div>

                        <p className="text-sm font-medium text-zinc-100 leading-relaxed">
                          {finding.question_for_pm}
                        </p>

                        {/* PART C: User-Provided Answer Display */}
                        {hasAnswer && !isAnswering && (
                          <div className="mt-2 pt-2 border-t border-sky-500/20 flex flex-col space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/30">
                                User Clarification / Decision
                              </span>
                              <span className="text-[11px] text-zinc-400">
                                (Used for rechecking readiness)
                              </span>
                            </div>
                            <p className="text-xs text-zinc-200 bg-[#161920] p-2.5 rounded-lg border border-white/[0.06]">
                              {answer?.answerText}
                            </p>
                          </div>
                        )}

                        {/* PART C: Inline Answer Textarea Form */}
                        {isAnswering && (
                          <div className="mt-3 pt-3 border-t border-sky-500/20 space-y-2">
                            <label className="block text-xs font-medium text-zinc-300">
                              Your Decision / Clarification for Sprint Kickoff:
                            </label>
                            <textarea
                              rows={3}
                              value={editingAnswerText}
                              onChange={(e) => setEditingAnswerText(e.target.value)}
                              placeholder="e.g. Unassigned leads route to Central Triage Queue with Tier 1 profile. Region is mapped from the custom Region__c picklist on Lead."
                              className="w-full text-xs rounded-lg border border-white/[0.1] bg-[#161920] px-3 py-2 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-zinc-500">
                                This answer will be incorporated into the Recheck prompt.
                              </span>
                              <div className="flex space-x-2">
                                {hasAnswer && (
                                  <button
                                    type="button"
                                    onClick={() => handleClearAnswer(finding.id)}
                                    className="px-2.5 py-1 text-xs text-rose-400 hover:text-rose-300"
                                  >
                                    Clear Answer
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleSaveAnswer(finding.id, finding.question_for_pm)}
                                  className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-xs font-semibold shadow-xs"
                                >
                                  Save Decision
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Verify in Org Check */}
                    {finding.verify_in_org?.trim() && (
                      <div className="bg-[#0b101b] text-zinc-200 rounded-xl p-4 space-y-1.5 border border-sky-500/20">
                        <div className="flex items-center space-x-2">
                          <SearchIcon className="w-4 h-4 text-sky-400" />
                          <span className="text-[11px] font-bold uppercase tracking-wider text-sky-300">
                            Verify in Salesforce Org (Setup &amp; Metadata Check)
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                          {finding.verify_in_org}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* PART D: Structured Recheck Readiness Section */}
      {questionsCount > 0 && (
        <section aria-labelledby="recheck-heading" className="bg-[#0f1115] border border-white/[0.08] rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <h2 id="recheck-heading" className="text-base font-bold text-zinc-100">
                  Resolve &amp; Recheck Readiness
                </h2>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Provide answers to clarification questions above. Rechecking will consolidate your decisions into a new version.
              </p>
            </div>

            <div className="text-xs font-mono font-medium px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-zinc-300">
              {answeredCount} of {questionsCount} questions answered
            </div>
          </div>

          {/* Validation or Error State */}
          {recheckError && (
            <div
              role="alert"
              className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-4 flex items-start space-x-3 text-xs text-amber-200"
            >
              <AlertTriangleIcon className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="font-semibold text-zinc-100 text-sm">
                  {typeof recheckError === "object" ? recheckError.title : "Salesforce Readiness is temporarily busy"}
                </h3>
                <p className="text-zinc-300">
                  {typeof recheckError === "object" ? recheckError.message : recheckError}
                </p>
              </div>
            </div>
          )}

          {recheckValidation.error && answeredCount > 0 && (
            <div className="bg-rose-950/30 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-300">
              {recheckValidation.error}
            </div>
          )}

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs text-zinc-400">
              {answeredCount === 0
                ? "Answer at least one question above to enable Recheck."
                : `Ready to evaluate Version ${currentVersion.versionNumber + 1} with ${answeredCount} team decision(s).`}
            </span>

            <button
              type="button"
              disabled={!canRecheck || Boolean(recheckValidation.error) || isRechecking}
              onClick={onRecheck}
              className={`inline-flex items-center justify-center px-6 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-lg ${
                canRecheck && !recheckValidation.error && !isRechecking
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20 active:scale-[0.99] cursor-pointer"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-white/[0.04]"
              }`}
            >
              {isRechecking ? (
                <>
                  <SpinnerIcon className="w-4 h-4 mr-2" />
                  <span>Rechecking Readiness...</span>
                </>
              ) : (
                <span>Recheck Readiness (Run v{currentVersion.versionNumber + 1})</span>
              )}
            </button>
          </div>
        </section>
      )}

      {/* PART B: Overall Review Feedback */}
      <section aria-labelledby="feedback-heading" className="bg-[#0f1115] border border-white/[0.08] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div>
            <h2 id="feedback-heading" className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
              Overall Review Feedback &bull; Version {currentVersion.versionNumber}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Help calibrate the readiness rubric. Responses are saved in your local session history.
            </p>
          </div>
        </div>

        <div className="space-y-4 text-xs">
          {/* Q1 */}
          <div className="space-y-2">
            <p className="font-medium text-zinc-200">
              1. Did this review identify at least one gap you had not considered?
            </p>
            <div className="flex items-center space-x-2">
              {(["yes", "no", "not_sure"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleUpdateOverall("identifiedNewGap", opt)}
                  className={`px-3 py-1.5 rounded-lg border transition-all ${
                    currentOverall.identifiedNewGap === opt
                      ? "bg-sky-500/20 border-sky-500/40 text-sky-200 font-semibold"
                      : "bg-white/[0.02] border-white/[0.08] text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {opt === "yes" ? "Yes" : opt === "no" ? "No" : "Not sure"}
                </button>
              ))}
            </div>
          </div>

          {/* Q2 */}
          <div className="space-y-2">
            <p className="font-medium text-zinc-200">
              2. Would you use this checker before a Salesforce development kickoff?
            </p>
            <div className="flex items-center space-x-2">
              {(["yes", "no", "not_sure"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleUpdateOverall("wouldUseBeforeKickoff", opt)}
                  className={`px-3 py-1.5 rounded-lg border transition-all ${
                    currentOverall.wouldUseBeforeKickoff === opt
                      ? "bg-sky-500/20 border-sky-500/40 text-sky-200 font-semibold"
                      : "bg-white/[0.02] border-white/[0.08] text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {opt === "yes" ? "Yes" : opt === "no" ? "No" : "Not sure"}
                </button>
              ))}
            </div>
          </div>

          {/* Q3 Comments */}
          <div className="space-y-1.5 pt-1">
            <label className="block font-medium text-zinc-300">
              3. Additional comments on this review version (optional):
            </label>
            <textarea
              rows={2}
              value={currentOverall.comments || ""}
              onChange={(e) => handleOverallComment(e.target.value)}
              placeholder="e.g. The data model finding was spot-on, but severity on the reporting question felt too high..."
              className="w-full text-xs rounded-lg border border-white/[0.08] bg-[#161920] px-3 py-2 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </div>
      </section>

      {/* PART F: Session History & Export Bar */}
      <section aria-labelledby="session-heading" className="bg-[#0f1115] border border-white/[0.08] rounded-2xl p-6 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 id="session-heading" className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
              Local Session Storage &bull; {session.versions.length} Version(s) Stored
            </h2>
            <p className="text-[11px] text-zinc-500 max-w-xl">
              All review versions, team decisions, and feedback are saved privately in your browser&apos;s localStorage.
              No project requirements are transmitted to a persistent server database.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onExport}
              className="inline-flex items-center px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg text-xs font-medium text-zinc-200 transition-colors"
            >
              <DownloadIcon className="w-3.5 h-3.5 mr-1.5 text-zinc-400" />
              <span>Export History JSON</span>
            </button>

            {!showClearConfirm ? (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="inline-flex items-center px-3 py-1.5 bg-white/[0.04] hover:bg-rose-500/10 border border-white/[0.08] hover:border-rose-500/20 rounded-lg text-xs font-medium text-zinc-400 hover:text-rose-300 transition-colors"
              >
                <TrashIcon className="w-3.5 h-3.5 mr-1.5" />
                <span>Clear History</span>
              </button>
            ) : (
              <div className="inline-flex items-center space-x-1.5 bg-rose-950/40 border border-rose-500/30 px-2 py-1 rounded-lg text-xs">
                <span className="text-rose-300 text-[11px]">Clear all versions?</span>
                <button
                  type="button"
                  onClick={() => {
                    onClearHistory();
                    setShowClearConfirm(false);
                  }}
                  className="font-bold text-rose-300 hover:underline px-1"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(false)}
                  className="text-zinc-400 hover:text-white px-1"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Review Another Requirement Action */}
      <div className="pt-4 text-center">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center px-6 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Review another requirement
        </button>
      </div>
    </div>
  );
}
