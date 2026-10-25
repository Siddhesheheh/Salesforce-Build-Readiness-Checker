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
} from "./Icons";

interface RequirementFormProps {
  requirement: string;
  setRequirement: (val: string) => void;
  orgContext: string;
  setOrgContext: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: { code: string; message: string } | null;
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
    <div className="w-full max-w-4xl mx-auto py-8 px-4 sm:px-6">
      {/* Title & Introduction */}
      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
          Salesforce Build Readiness Checker
        </h1>
        <p className="mt-3 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Reviews Salesforce requirement specifications before development begins to surface missing fields,
          unclear business rules, trigger conflicts, and access gaps.
        </p>
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Sample Selection Bar */}
        <div className="bg-slate-50/80 border-b border-slate-200 px-6 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
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
              className="text-xs sm:text-sm bg-white border border-slate-300 rounded-md px-3 py-1.5 text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 disabled:opacity-50"
            >
              <option value="">Choose a sample requirement...</option>
              {SAMPLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.badge})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-3">
            {process.env.NODE_ENV !== "production" && setIsMockMode && (
              <label className="inline-flex items-center space-x-1.5 cursor-pointer text-xs text-slate-700 bg-white border border-slate-300 hover:border-slate-400 px-2.5 py-1 rounded-md transition-colors select-none">
                <input
                  type="checkbox"
                  id="mock-mode-toggle"
                  checked={isMockMode}
                  onChange={(e) => setIsMockMode(e.target.checked)}
                  className="rounded text-sky-600 focus:ring-sky-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="font-medium text-slate-700">Offline Mock Mode</span>
              </label>
            )}

            {(requirement || orgContext) && (
              <button
                type="button"
                onClick={onClear}
                disabled={isLoading}
                className="text-xs text-slate-500 hover:text-slate-800 transition-colors font-medium"
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
              error.code === "rate_limited"
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : error.code === "timeout"
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : "bg-rose-50 border-rose-200 text-rose-900"
            }`}
          >
            {error.code === "rate_limited" || error.code === "timeout" ? (
              <AlertTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircleIcon className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="text-sm">
              <h2 className="font-semibold">
                {error.code === "rate_limited"
                  ? "Rate limit reached"
                  : error.code === "timeout"
                  ? "Review request timed out"
                  : error.code === "too_short" || error.code === "too_long"
                  ? "Validation error"
                  : "Review failed"}
              </h2>
              <p className="mt-0.5 text-xs sm:text-sm opacity-90">{error.message}</p>
            </div>
          </div>
        )}

        {/* Form Form */}
        <form onSubmit={onSubmit} className="p-6 space-y-6">
          {/* Requirement Textarea */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="requirement-input"
                className="block text-sm font-semibold text-slate-900"
              >
                Requirement Specification <span className="text-rose-600">*</span>
              </label>
              <span
                className={`text-xs font-mono tabular-nums ${
                  isTooShort || isTooLong
                    ? "text-rose-600 font-semibold"
                    : reqLength >= 20
                    ? "text-slate-500"
                    : "text-slate-400"
                }`}
              >
                {reqLength} / 6,000 characters
                {reqLength > 0 && reqLength < 20 && " (min 20)"}
              </span>
            </div>

            <p className="text-xs text-slate-500">
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
              className={`w-full rounded-lg border px-3.5 py-3 text-sm font-normal text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50 disabled:text-slate-500 ${
                isTooShort || isTooLong
                  ? "border-rose-400 focus:border-rose-500 focus:ring-rose-200"
                  : "border-slate-300 hover:border-slate-400 focus:border-sky-500"
              }`}
            />

            {/* Validation feedback */}
            {isTooShort && (
              <p className="text-xs text-rose-600 flex items-center space-x-1">
                <span>Requirement must be at least 20 characters before checking readiness.</span>
              </p>
            )}
            {isTooLong && (
              <p className="text-xs text-rose-600 flex items-center space-x-1">
                <span>Requirement exceeds 6,000 characters. Please shorten.</span>
              </p>
            )}
          </div>

          {/* Org Context Accordion / Optional Field */}
          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
            <button
              type="button"
              onClick={() => setShowOrgContext(!showOrgContext)}
              className="w-full px-4 py-3 text-left flex items-center justify-between text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100/60 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span>Existing Salesforce Org Context</span>
                <span className="text-xs font-normal text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded">
                  Optional
                </span>
                {orgLength > 0 && (
                  <span className="text-xs text-sky-700 font-medium">({orgLength} chars)</span>
                )}
              </div>
              <div className="flex items-center text-slate-400">
                {showOrgContext ? (
                  <ChevronUpIcon className="w-4 h-4" />
                ) : (
                  <ChevronDownIcon className="w-4 h-4" />
                )}
              </div>
            </button>

            {showOrgContext && (
              <div className="px-4 pb-4 pt-1 space-y-2 border-t border-slate-200 bg-white">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <p>
                    Existing flows, triggers, validation rules, third-party packages, or data volumes.
                  </p>
                  <span
                    className={`font-mono tabular-nums ${
                      isOrgTooLong ? "text-rose-600 font-semibold" : "text-slate-400"
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
                  placeholder="e.g. Existing Record-Triggered Flow on Lead already updates Status to 'Working'. Custom Region__c picklist with 6 values already exists on Lead. Sales Cloud Enterprise Edition."
                  className={`w-full rounded-md border px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50 ${
                    isOrgTooLong
                      ? "border-rose-400 focus:border-rose-500 focus:ring-rose-200"
                      : "border-slate-300 hover:border-slate-400 focus:border-sky-500"
                  }`}
                />
                {isOrgTooLong && (
                  <p className="text-xs text-rose-600">
                    Org context exceeds 2,000 characters. Please shorten.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Action Row */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="flex items-center text-xs text-slate-500 space-x-2">
              <InfoIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span>Evaluated against 10 rubric categories. No requirement text is saved.</span>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className={`inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold text-white shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 ${
                canSubmit
                  ? "bg-sky-600 hover:bg-sky-700 active:bg-sky-800 cursor-pointer"
                  : "bg-slate-300 text-slate-500 cursor-not-allowed"
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

      {/* Loading state indicator card when request is executing */}
      {isLoading && (
        <div className="mt-8 p-6 bg-sky-50/70 border border-sky-200 rounded-xl text-center space-y-3">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-sky-100 text-sky-700 mb-1">
            <SpinnerIcon className="w-5 h-5" />
          </div>
          <h2 className="text-base font-semibold text-slate-900">
            Analyzing requirement against Salesforce readiness rubric...
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto">
            Checking business rules, data model, field definitions, access & permissions, automation behavior, and org impact.
          </p>
        </div>
      )}
    </div>
  );
}
