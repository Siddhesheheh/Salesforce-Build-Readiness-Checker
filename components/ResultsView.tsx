"use client";

import React, { useState } from "react";
import { ReadinessReport, Finding, Severity } from "@/lib/types";
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  AlertCircleIcon,
  InfoIcon,
  CopyIcon,
  CheckIcon,
  ArrowLeftIcon,
  SearchIcon,
  CloudIcon,
} from "./Icons";
import { copyToClipboard, formatClarifyingQuestions } from "@/lib/clipboard";

interface ResultsViewProps {
  report: ReadinessReport;
  requirement: string;
  onReset: () => void;
}

export function ResultsView({ report, requirement, onReset }: ResultsViewProps) {
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [copiedFindingId, setCopiedFindingId] = useState<number | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");

  const verdict = report.readiness_verdict;
  const isReady = verdict === "Ready to build";
  const isNeedsClarification = verdict === "Needs clarification";
  const isNotReady = verdict === "Not ready to build";
  const isSimulated =
    report.summary.includes("MOCK") || report.summary.includes("SIMULATED");

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

  const filteredFindings = report.findings.filter((f) => {
    if (severityFilter === "ALL") return true;
    return f.severity === severityFilter;
  });

  // Severity color styles
  const getSeverityBadgeClass = (severity: Severity) => {
    switch (severity) {
      case "Blocker":
        return "bg-rose-100 text-rose-800 border-rose-200 font-semibold";
      case "Important":
        return "bg-amber-100 text-amber-800 border-amber-200 font-semibold";
      case "Minor":
        return "bg-sky-100 text-sky-800 border-sky-200 font-semibold";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  // Category status chip styles
  const getCategoryStatusBadge = (status: string) => {
    switch (status) {
      case "Covered":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mr-1.5"></span>
            Covered
          </span>
        );
      case "Partial":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600 mr-1.5"></span>
            Partial
          </span>
        );
      case "Missing":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-800 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-600 mr-1.5"></span>
            Missing
          </span>
        );
      case "Not applicable":
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mr-1.5"></span>
            N/A
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto py-8 px-4 sm:px-6 space-y-8">
      {/* Navigation & Action Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
          Review another requirement
        </button>

        <div className="flex items-center space-x-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleCopyAll}
            className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {copiedAll ? (
              <>
                <CheckIcon className="w-4 h-4 mr-2 text-emerald-600" />
                <span className="text-emerald-700 font-semibold">Questions Copied!</span>
              </>
            ) : (
              <>
                <CopyIcon className="w-4 h-4 mr-2 text-slate-500" />
                <span>Copy Clarifying Questions</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Visual Indicator when Results are Mock / Simulated */}
      {isSimulated && (
        <div
          role="status"
          className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 flex items-center space-x-3 text-amber-900 shadow-xs"
        >
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-amber-200 text-amber-900 border border-amber-300 flex-shrink-0">
            Simulated
          </span>
          <p className="text-xs sm:text-sm font-medium">
            This review was generated in Offline Mock Mode using sample benchmark data. No live Gemini API calls were made.
          </p>
        </div>
      )}

      {/* Verdict Banner */}
      <section aria-labelledby="verdict-heading" className={`rounded-2xl p-6 sm:p-8 border shadow-sm ${
        isReady
          ? "bg-emerald-50/80 border-emerald-300 text-emerald-950"
          : isNeedsClarification
          ? "bg-amber-50/80 border-amber-300 text-amber-950"
          : "bg-rose-50/80 border-rose-300 text-rose-950"
      }`}>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-3 flex-1">
            <div className="flex items-center space-x-2">
              {isReady && <CheckCircleIcon className="w-6 h-6 text-emerald-600" />}
              {isNeedsClarification && <AlertCircleIcon className="w-6 h-6 text-amber-600" />}
              {isNotReady && <AlertTriangleIcon className="w-6 h-6 text-rose-600" />}
              <span className="text-xs font-bold uppercase tracking-wider opacity-75">
                Readiness Verdict
              </span>
            </div>

            <h1 id="verdict-heading" className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {verdict}
            </h1>

            <p className="text-sm sm:text-base leading-relaxed opacity-90 max-w-3xl">
              {report.summary}
            </p>
          </div>

          {/* Counts Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:min-w-[340px]">
            <div className="bg-white/80 rounded-xl p-3 border border-slate-200/60 shadow-xs text-center">
              <span className="block text-2xl font-bold text-rose-600 tabular-nums">
                {report.counts.blockers}
              </span>
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Blockers
              </span>
            </div>

            <div className="bg-white/80 rounded-xl p-3 border border-slate-200/60 shadow-xs text-center">
              <span className="block text-2xl font-bold text-amber-600 tabular-nums">
                {report.counts.important}
              </span>
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Important
              </span>
            </div>

            <div className="bg-white/80 rounded-xl p-3 border border-slate-200/60 shadow-xs text-center">
              <span className="block text-2xl font-bold text-sky-600 tabular-nums">
                {report.counts.minor}
              </span>
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Minor
              </span>
            </div>

            <div className="bg-white/80 rounded-xl p-3 border border-slate-200/60 shadow-xs text-center">
              <span className="block text-2xl font-bold text-slate-700 tabular-nums">
                {report.counts.questions}
              </span>
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Questions
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 10 Rubric Categories Strip / Grid */}
      <section aria-labelledby="rubric-heading" className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="rubric-heading" className="text-base font-bold text-slate-900">
              Rubric Category Coverage
            </h2>
            <p className="text-xs text-slate-500">
              Coverage status across all 10 Salesforce implementation readiness categories.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {report.category_status.map((item) => (
            <div
              key={item.category}
              className="p-3 rounded-lg border border-slate-100 bg-slate-50/60 flex flex-col justify-between space-y-2"
            >
              <span className="text-xs font-medium text-slate-800 leading-snug line-clamp-2">
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
            <h2 id="findings-heading" className="text-xl font-bold text-slate-900">
              Prioritized Findings ({report.findings.length})
            </h2>
            <p className="text-xs text-slate-500">
              Ranked in order of severity (Blocker &gt; Important &gt; Minor).
            </p>
          </div>

          {/* Severity filter buttons */}
          {report.findings.length > 0 && (
            <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-lg text-xs font-medium">
              <button
                type="button"
                onClick={() => setSeverityFilter("ALL")}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  severityFilter === "ALL"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                All ({report.findings.length})
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter("Blocker")}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  severityFilter === "Blocker"
                    ? "bg-white text-rose-700 shadow-xs"
                    : "text-slate-600 hover:text-rose-700"
                }`}
              >
                Blockers ({report.counts.blockers})
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter("Important")}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  severityFilter === "Important"
                    ? "bg-white text-amber-700 shadow-xs"
                    : "text-slate-600 hover:text-amber-700"
                }`}
              >
                Important ({report.counts.important})
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter("Minor")}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  severityFilter === "Minor"
                    ? "bg-white text-sky-700 shadow-xs"
                    : "text-slate-600 hover:text-sky-700"
                }`}
              >
                Minor ({report.counts.minor})
              </button>
            </div>
          )}
        </div>

        {/* Empty State when 0 findings */}
        {report.findings.length === 0 ? (
          <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-8 text-center space-y-3">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircleIcon className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-emerald-950">
              No Blockers or Gaps Detected
            </h3>
            <p className="text-xs sm:text-sm text-emerald-800 max-w-lg mx-auto">
              This requirement specification satisfies all 10 rubric categories with no missing business rules,
              access details, or unhandled edge cases. It is ready for developer kickoff.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredFindings.map((finding) => (
              <div
                key={finding.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
              >
                {/* Finding Header */}
                <div className="bg-slate-50/80 border-b border-slate-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-xs font-bold text-slate-500 font-mono">
                      #{finding.id}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${getSeverityBadgeClass(
                        finding.severity
                      )}`}
                    >
                      {finding.severity}
                    </span>
                    <span className="text-xs font-medium text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded">
                      {finding.category}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyQuestion(finding)}
                    className="inline-flex items-center text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 px-2.5 py-1 rounded transition-colors"
                  >
                    {copiedFindingId === finding.id ? (
                      <>
                        <CheckIcon className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                        <span className="text-emerald-700">Copied</span>
                      </>
                    ) : (
                      <>
                        <CopyIcon className="w-3.5 h-3.5 mr-1 text-slate-400" />
                        <span>Copy Question</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Finding Body */}
                <div className="p-6 space-y-4 text-sm text-slate-700">
                  <h3 className="text-base font-bold text-slate-900">
                    {finding.title}
                  </h3>

                  {/* Evidence quote */}
                  <div className="bg-slate-50 border-l-2 border-slate-300 px-3.5 py-2.5 rounded-r text-xs sm:text-sm text-slate-600 italic">
                    <span className="font-semibold not-italic text-slate-700 block text-xs uppercase tracking-wider mb-1">
                      Evidence from Requirement:
                    </span>
                    &ldquo;{finding.evidence}&rdquo;
                  </div>

                  {/* Grid for What's Missing & Why It Matters */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                    <div className="bg-rose-50/40 border border-rose-100 rounded-lg p-3.5 space-y-1">
                      <span className="text-xs font-bold text-rose-900 uppercase tracking-wider block">
                        What&apos;s Missing:
                      </span>
                      <p className="text-xs sm:text-sm text-slate-800 leading-relaxed">
                        {finding.whats_missing}
                      </p>
                    </div>

                    <div className="bg-amber-50/40 border border-amber-100 rounded-lg p-3.5 space-y-1">
                      <span className="text-xs font-bold text-amber-900 uppercase tracking-wider block">
                        Why It Matters:
                      </span>
                      <p className="text-xs sm:text-sm text-slate-800 leading-relaxed">
                        {finding.why_it_matters}
                      </p>
                    </div>
                  </div>

                  {/* Question for PM Highlight Box */}
                  <div className="bg-sky-50/70 border border-sky-200 rounded-lg p-4 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-sky-900 uppercase tracking-wider flex items-center">
                        <InfoIcon className="w-4 h-4 mr-1 text-sky-700" />
                        Question for the PM / BA:
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-900 leading-relaxed">
                      {finding.question_for_pm}
                    </p>
                  </div>

                  {/* DISTINCT SECTION: Verify in Org Check */}
                  {finding.verify_in_org && finding.verify_in_org.trim().length > 0 && (
                    <div className="bg-slate-900 text-slate-100 rounded-lg p-4 space-y-1.5 border border-slate-800">
                      <div className="flex items-center space-x-2">
                        <SearchIcon className="w-4 h-4 text-sky-400" />
                        <span className="text-xs font-bold uppercase tracking-wider text-sky-300">
                          Verify in Salesforce Org (Setup &amp; Metadata Check)
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                        {finding.verify_in_org}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Copy All Clarifying Questions Box */}
      {report.findings.some((f) => f.question_for_pm && f.question_for_pm.trim().length > 0) && (
        <section aria-labelledby="clarification-heading" className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h2 id="clarification-heading" className="text-base font-bold text-slate-900">
                Follow-Up Question Summary
              </h2>
              <p className="text-xs text-slate-500">
                Send these questions to the business analyst or product manager before sprint commitment.
              </p>
            </div>

            <button
              type="button"
              onClick={handleCopyAll}
              className="inline-flex items-center px-3.5 py-1.5 border border-slate-300 rounded-md text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-xs"
            >
              {copiedAll ? (
                <>
                  <CheckIcon className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                  <span className="text-emerald-700 font-bold">Copied All Questions!</span>
                </>
              ) : (
                <>
                  <CopyIcon className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                  <span>Copy Formatted Question List</span>
                </>
              )}
            </button>
          </div>

          <div className="bg-slate-50 rounded-lg p-4 font-mono text-xs text-slate-700 overflow-x-auto border border-slate-200/80 max-h-64 overflow-y-auto whitespace-pre-wrap">
            {formatClarifyingQuestions(report)}
          </div>
        </section>
      )}

      {/* Bottom Action: Review Another Requirement */}
      <div className="pt-4 text-center">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Review another requirement
        </button>
      </div>
    </div>
  );
}
