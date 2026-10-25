"use client";

import React, { useState } from "react";
import { Navbar } from "./Navbar";
import { RequirementForm } from "./RequirementForm";
import { ResultsView } from "./ResultsView";
import { Footer } from "./Footer";
import { ReadinessReport, ReviewErrorResponse } from "@/lib/types";
import { SampleRequirement } from "@/lib/sample-data";

export function ReadinessChecker() {
  const [requirement, setRequirement] = useState<string>("");
  const [orgContext, setOrgContext] = useState<string>("");
  const [selectedSampleId, setSelectedSampleId] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [isMockMode, setIsMockMode] = useState<boolean>(false);

  const handleSelectSample = (sample: SampleRequirement | null) => {
    if (!sample) {
      setSelectedSampleId("");
      return;
    }
    setSelectedSampleId(sample.id);
    setRequirement(sample.requirement);
    setOrgContext(sample.orgContext || "");
    setError(null);
  };

  const handleClear = () => {
    setRequirement("");
    setOrgContext("");
    setSelectedSampleId("");
    setError(null);
  };

  const handleReset = () => {
    setReport(null);
    setError(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedReq = requirement.trim();
    const trimmedOrg = orgContext.trim();

    if (trimmedReq.length < 20) {
      setError({
        code: "too_short",
        message: "Requirement specification must be at least 20 characters.",
      });
      return;
    }

    if (trimmedReq.length > 6000) {
      setError({
        code: "too_long",
        message: "Requirement specification exceeds maximum 6,000 characters.",
      });
      return;
    }

    if (trimmedOrg.length > 2000) {
      setError({
        code: "too_long",
        message: "Existing org context exceeds maximum 2,000 characters.",
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (process.env.NODE_ENV !== "production" && isMockMode) {
        headers["x-mock-review"] = "true";
      }

      const response = await fetch("/api/review", {
        method: "POST",
        headers,
        body: JSON.stringify({
          requirement: trimmedReq,
          org_context: trimmedOrg.length > 0 ? trimmedOrg : undefined,
        }),
      });

      if (!response.ok) {
        let errData: ReviewErrorResponse | null = null;
        try {
          errData = await response.json();
        } catch {
          // Response body was not JSON
        }

        if (response.status === 429) {
          setError({
            code: "rate_limited",
            message:
              errData?.message ||
              "Rate limit reached (10 requests per hour). Please wait before submitting another review.",
          });
        } else if (response.status === 400) {
          setError({
            code: errData?.error || "validation_error",
            message: errData?.message || "Invalid requirement length. Must be 20–6,000 characters.",
          });
        } else if (response.status === 504) {
          setError({
            code: "timeout",
            message:
              errData?.message ||
              "The readiness review timed out. The AI service took too long to respond. Please try again.",
          });
        } else {
          setError({
            code: "review_failed",
            message:
              errData?.message ||
              "Unable to complete readiness review. The upstream AI service is temporarily unavailable or busy. Please retry.",
          });
        }
        setIsLoading(false);
        return;
      }

      const reportData: ReadinessReport = await response.json();
      setReport(reportData);
      setIsLoading(false);

      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError({
        code: "network_error",
        message: "Network error occurred while connecting to the review service. Please check your connection and retry.",
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar onReset={handleReset} showReset={!!report} />

      <main className="flex-1">
        {report ? (
          <ResultsView
            report={report}
            requirement={requirement}
            onReset={handleReset}
          />
        ) : (
          <RequirementForm
            requirement={requirement}
            setRequirement={(val) => {
              setRequirement(val);
              if (selectedSampleId) setSelectedSampleId("");
            }}
            orgContext={orgContext}
            setOrgContext={setOrgContext}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            error={error}
            onClear={handleClear}
            selectedSampleId={selectedSampleId}
            onSelectSample={handleSelectSample}
            isMockMode={isMockMode}
            setIsMockMode={setIsMockMode}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}
