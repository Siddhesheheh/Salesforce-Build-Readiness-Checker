"use client";

import React, { useState } from "react";
import { SAMPLES, SampleRequirement } from "@/lib/sample-data";
import {
  AlertTriangleIcon,
  AlertCircleIcon,
  SpinnerIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  InfoIcon,
  SparklesIcon,
} from "./Icons";

interface RequirementFormProps {
  requirement: string;
  setRequirement: (val: string) => void;
  orgContext: string;
  setOrgContext: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: { code: string; message: string; title?: string } | null;
  onClear: () => void;
  selectedSampleId: string;
  onSelectSample: (sample: SampleRequirement | null) => void;
  isMockMode?: boolean;
  setIsMockMode?: (val: boolean) => void;
}

export function RequirementForm({
  requirement,
  setRequirement,
  orgContext,
  setOrgContext,
  onSubmit,
  isLoading,
  error,
  onClear,
  selectedSampleId,
  onSelectSample,
  isMockMode = false,
  setIsMockMode,
}: RequirementFormProps) {
  const [showOrgContext, setShowOrgContext] = useState<boolean>(orgContext.trim().length > 0);
  const [touched, setTouched] = useState<boolean>(false);

  const reqLength = requirement.trim().length;
  const orgLength = orgContext.trim().length;

  const isTooShort = touched && reqLength > 0 && reqLength < 20;
  const isTooLong = reqLength > 6000;
  const isOrgTooLong = orgLength > 2000;
  const canSubmit = reqLength >= 20 && !isTooLong && !isOrgTooLong && !isLoading;

  const handleSampleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sampleId = e.target.value;
    if (!sampleId) {
      onSelectSample(null);
      return;
    }
    const found = SAMPLES.find((s) => s.id === sampleId);
    if (found) {
      onSelectSample(found);
      if (found.orgContext) {
        setShowOrgContext(true);
      }
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-12 px-4 sm:px-6">
      {/* Apple-style Hero Section */}
      <div className="text-center mb-10 space-y-3">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] text-xs font-medium text-zinc-300 mb-2">
          <SparklesIcon className="w-3.5 h-3.5 text-sky-400" />
          <span>Pre-Sprint Readiness Review</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-[#f4f4f6]">
          Salesforce Build Readiness Checker
        </h1>

        <p className="text-sm sm:text-base text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          Reviews Salesforce requirement specifications before development begins to surface missing fields,
          unclear business rules, trigger conflicts, and access gaps.
        </p>
      </div>

      {/* Main Glass Card */}
      <div className="bg-[#0f1115]/95 rounded-2xl shadow-2xl border border-white/[0.08] overflow-hidden backdrop-blur-xl">
        {/* Quick Test Bar */}
        <div className="bg-white/[0.02] border-b border-white/[0.08] px-6 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3 w-full sm:w-auto">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              Quick Test:
            </span>
            <label htmlFor="sample-select" className="sr-only">
              Select a sample requirement
            </label>
            <select
              id="sample-select"
              value={selectedSampleId}
              onChange={handleSampleChange}
              disabled={isLoading}
              className="text-xs sm:text-sm bg-[#161920] border border-white/[0.1] rounded-lg px-3 py-1.5 text-zinc-200 hover:border-white/[0.2] focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 transition-colors"
            >
              <option value="">Choose a sample requirement...</option>
              {SAMPLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.badge})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-end">
            {process.env.NODE_ENV !== "production" && setIsMockMode && (
              <label className="inline-flex items-center space-x-1.5 cursor-pointer text-xs text-sky-300 bg-sky-500/10 border border-sky-500/20 hover:border-sky-500/30 px-2.5 py-1 rounded-md transition-colors select-none">
                <input
                  type="checkbox"
                  id="mock-mode-toggle"
                  checked={isMockMode}
                  onChange={(e) => setIsMockMode(e.target.checked)}
                  className="rounded text-sky-600 focus:ring-sky-500 bg-[#161920] border-white/[0.2] w-3.5 h-3.5 cursor-pointer"
                />
                <span className="font-medium text-sky-200">Offline Mock Mode</span>
              </label>
            )}

            {(requirement || orgContext) && (
              <button
                type="button"
                onClick={onClear}
                disabled={isLoading}
                className="text-xs text-zinc-400 hover:text-white transition-colors font-medium"
              >
                Clear input
              </button>
            )}
          </div>
        </div>

        {/* Error State Banner */}
        {error && (
          <div
            role="alert"
            className={`border-b px-6 py-4 flex items-start space-x-3 ${
              error.code === "rate_limited" || error.code === "timeout" || error.code === "overloaded"
                ? "bg-amber-950/30 border-amber-500/20 text-amber-200"
                : "bg-rose-950/30 border-rose-500/20 text-rose-200"
            }`}
          >
            {error.code === "rate_limited" || error.code === "timeout" || error.code === "overloaded" ? (
              <AlertTriangleIcon className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircleIcon className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="text-sm">
              <h2 className="font-semibold text-zinc-100">
                {error.title ||
                  (error.code === "overloaded"
                    ? "Salesforce Readiness is temporarily busy"
                    : error.code === "timeout"
                    ? "Review is taking longer than expected"
                    : error.code === "rate_limited"
                    ? "Rate limit reached"
                    : error.code === "too_short" || error.code === "too_long"
                    ? "Validation error"
                    : "Review failed")}
              </h2>
              <p className="mt-0.5 text-xs sm:text-sm text-zinc-300">{error.message}</p>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={onSubmit} className="p-6 sm:p-8 space-y-6">
          {/* Requirement Textarea */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="requirement-input"
                className="block text-sm font-semibold text-zinc-200"
              >
                Requirement Specification <span className="text-rose-400">*</span>
              </label>
              <span
                className={`text-xs font-mono tabular-nums ${
                  isTooShort || isTooLong
                    ? "text-rose-400 font-semibold"
                    : reqLength >= 20
                    ? "text-zinc-400"
                    : "text-zinc-500"
                }`}
              >
                {reqLength} / 6,000 characters
                {reqLength > 0 && reqLength < 20 && " (min 20)"}
              </span>
            </div>

            <p className="text-xs text-zinc-400">
              Paste user stories, acceptance criteria, BRD excerpts, or process descriptions.
            </p>

            <textarea
              id="requirement-input"
              rows={8}
              value={requirement}
              onChange={(e) => {
                setRequirement(e.target.value);
                if (!touched) setTouched(true);
              }}
              onBlur={() => setTouched(true)}
              disabled={isLoading}
              placeholder="User Story: As a Sales Manager, I want new leads to be automatically assigned based on region so that reps follow up within 15 minutes.

Acceptance criteria:
- New leads must be assigned automatically based on region
- If no rep is in the region, route to the default queue..."
              className={`w-full rounded-xl border px-4 py-3.5 text-sm font-normal text-zinc-100 placeholder:text-zinc-500 bg-[#161920]/80 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 transition-all ${
                isTooShort || isTooLong
                  ? "border-rose-500/50 focus:border-rose-500 focus:ring-rose-500/20"
                  : "border-white/[0.08] hover:border-white/[0.15] focus:border-sky-500"
              }`}
            />

            {isTooShort && (
              <p className="text-xs text-rose-400">
                Requirement must be at least 20 characters before checking readiness.
              </p>
            )}
            {isTooLong && (
              <p className="text-xs text-rose-400">
                Requirement exceeds 6,000 characters. Please shorten.
              </p>
            )}
          </div>

          {/* Org Context Accordion */}
          <div className="border border-white/[0.08] rounded-xl overflow-hidden bg-white/[0.02]">
            <button
              type="button"
              onClick={() => setShowOrgContext(!showOrgContext)}
              className="w-full px-4 py-3 text-left flex items-center justify-between text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span>Existing Salesforce Org Context</span>
                <span className="text-[11px] font-normal text-zinc-400 bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 rounded-full">
                  Optional
                </span>
                {orgLength > 0 && (
                  <span className="text-xs text-sky-400 font-mono">({orgLength} chars)</span>
                )}
              </div>
              <div className="text-zinc-400">
                {showOrgContext ? (
                  <ChevronUpIcon className="w-4 h-4" />
                ) : (
                  <ChevronDownIcon className="w-4 h-4" />
                )}
              </div>
            </button>

            {showOrgContext && (
              <div className="px-4 pb-4 pt-2 space-y-2 border-t border-white/[0.08] bg-[#161920]/60">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <p>Existing flows, validation rules, triggers, packages, or volume limits.</p>
                  <span
                    className={`font-mono tabular-nums ${
                      isOrgTooLong ? "text-rose-400 font-semibold" : "text-zinc-500"
                    }`}
                  >
                    {orgLength} / 2,000 characters
                  </span>
                </div>

                <textarea
                  id="org-context-input"
                  rows={3}
                  value={orgContext}
                  onChange={(e) => setOrgContext(e.target.value)}
                  disabled={isLoading}
                  placeholder="e.g. Existing Record-Triggered Flow on Lead already updates Status. Custom Region__c picklist exists. Sales Cloud Enterprise Edition."
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 bg-[#0f1115] focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 ${
                    isOrgTooLong
                      ? "border-rose-500/50 focus:border-rose-500"
                      : "border-white/[0.08] hover:border-white/[0.15] focus:border-sky-500"
                  }`}
                />
                {isOrgTooLong && (
                  <p className="text-xs text-rose-400">
                    Org context exceeds 2,000 characters. Please shorten.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Action Row */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="flex items-center text-xs text-zinc-400 space-x-2">
              <InfoIcon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
              <span>Evaluated against 10 rubric categories. No client data retained.</span>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className={`inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold text-white shadow-lg transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                canSubmit
                  ? "bg-blue-600 hover:bg-blue-500 shadow-blue-500/20 cursor-pointer active:scale-[0.99]"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-white/[0.04]"
              }`}
            >
              {isLoading ? (
                <>
                  <SpinnerIcon className="w-4 h-4 mr-2" />
                  <span>Checking Readiness...</span>
                </>
              ) : (
                <span>Check Readiness</span>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Loading state card */}
      {isLoading && (
        <div className="mt-8 p-6 bg-white/[0.02] border border-white/[0.08] rounded-2xl text-center space-y-3 backdrop-blur-md">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-sky-500/10 text-sky-400 mb-1 ring-1 ring-sky-500/20">
            <SpinnerIcon className="w-5 h-5" />
          </div>
          <h2 className="text-base font-semibold text-zinc-100">
            Analyzing requirement against Salesforce readiness rubric...
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-md mx-auto">
            Checking business rules, schema model, field definitions, access &amp; permissions, automation behavior, and org impact.
          </p>
        </div>
      )}
    </div>
  );
}
