"use client";

import React, { useState, useEffect } from "react";
import { Navbar } from "./Navbar";
import { RequirementForm } from "./RequirementForm";
import { ResultsView } from "./ResultsView";
import { Footer } from "./Footer";
import { ReadinessReport, ReviewErrorResponse } from "@/lib/types";
import { SampleRequirement } from "@/lib/sample-data";
import {
  ReviewSession,
  ReviewVersion,
  FindingFeedback,
  OverallFeedback,
} from "@/lib/workflow-types";
import {
  loadSession,
  saveSession,
  clearSession,
  exportSessionToJson,
  downloadJsonFile,
} from "@/lib/workflow-storage";
import { buildRecheckInput } from "@/lib/workflow-recheck";

export function ReadinessChecker() {
  const [requirement, setRequirement] = useState<string>("");
  const [orgContext, setOrgContext] = useState<string>("");
  const [selectedSampleId, setSelectedSampleId] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRechecking, setIsRechecking] = useState<boolean>(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [recheckError, setRecheckError] = useState<string | null>(null);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [isMockMode, setIsMockMode] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);

  // Hydration-safe initial load of local storage session
  useEffect(() => {
    setMounted(true);
    const existing = loadSession();
    if (existing) {
      setSession(existing);
      setRequirement(existing.originalRequirement);
      setOrgContext(existing.originalOrgContext || "");
    }
  }, []);

  // Sync session changes to localStorage
  useEffect(() => {
    if (!mounted) return;
    if (session) {
      saveSession(session);
    }
  }, [session, mounted]);

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
    setSession(null);
    clearSession();
    setError(null);
    setRecheckError(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleClearHistory = () => {
    setSession(null);
    clearSession();
    setRecheckError(null);
  };

  const handleExportSession = () => {
    if (!session) return;
    const json = exportSessionToJson(session);
    const dateStr = new Date().toISOString().split("T")[0];
    downloadJsonFile(`salesforce-readiness-review-${dateStr}.json`, json);
  };

  const handleSubmitInitial = async (e: React.FormEvent) => {
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

      const initialVersion: ReviewVersion = {
        versionNumber: 1,
        timestamp: new Date().toISOString(),
        submittedRequirement: trimmedReq,
        orgContext: trimmedOrg || undefined,
        report: reportData,
        findingFeedback: {},
        answers: {},
      };

      const newSession: ReviewSession = {
        sessionId: `session_${Date.now()}`,
        originalRequirement: trimmedReq,
        originalOrgContext: trimmedOrg || undefined,
        versions: [initialVersion],
        currentVersionNumber: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setSession(newSession);
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

  // PART D: Recheck Readiness Handler
  const handleRecheck = async () => {
    if (!session) return;

    const currentVersion =
      session.versions.find((v) => v.versionNumber === session.currentVersionNumber) ||
      session.versions[session.versions.length - 1];

    const recheckInput = buildRecheckInput(
      session.originalRequirement,
      currentVersion.answers || {},
      currentVersion.report.findings
    );

    if (recheckInput.error) {
      setRecheckError(recheckInput.error);
      return;
    }

    setIsRechecking(true);
    setRecheckError(null);

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
          requirement: recheckInput.text,
          org_context: session.originalOrgContext || undefined,
        }),
      });

      if (!response.ok) {
        let errData: ReviewErrorResponse | null = null;
        try {
          errData = await response.json();
        } catch {
          // Response body was not JSON
        }

        const msg =
          errData?.message ||
          (response.status === 429
            ? "Rate limit reached. Please wait before rechecking readiness."
            : response.status === 504
            ? "The recheck request timed out. Please try again."
            : "Recheck failed. Upstream service was unavailable.");

        setRecheckError(msg);
        setIsRechecking(false);
        return;
      }

      const reportData: ReadinessReport = await response.json();
      const nextVersionNum = session.versions.length + 1;

      const newVersion: ReviewVersion = {
        versionNumber: nextVersionNum,
        timestamp: new Date().toISOString(),
        submittedRequirement: recheckInput.text,
        orgContext: session.originalOrgContext,
        report: reportData,
        findingFeedback: {},
        answers: {},
        parentVersionNumber: currentVersion.versionNumber,
      };

      const updatedSession: ReviewSession = {
        ...session,
        versions: [...session.versions, newVersion],
        currentVersionNumber: nextVersionNum,
        updatedAt: new Date().toISOString(),
      };

      setSession(updatedSession);
      setIsRechecking(false);

      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setRecheckError("Network error occurred during recheck. Your answers have been preserved. Please retry.");
      setIsRechecking(false);
    }
  };

  // Version switching
  const handleSelectVersion = (versionNumber: number) => {
    if (!session) return;
    setSession({
      ...session,
      currentVersionNumber: versionNumber,
    });
    setRecheckError(null);
  };

  // Feedback & Answer update handlers
  const handleUpdateFindingFeedback = (findingId: number, feedback: FindingFeedback | null) => {
    if (!session) return;
    const currentVersionNum = session.currentVersionNumber;

    const updatedVersions = session.versions.map((ver) => {
      if (ver.versionNumber !== currentVersionNum) return ver;

      const updatedFeedbackMap = { ...ver.findingFeedback };
      if (feedback === null) {
        delete updatedFeedbackMap[findingId];
      } else {
        updatedFeedbackMap[findingId] = feedback;
      }

      return {
        ...ver,
        findingFeedback: updatedFeedbackMap,
      };
    });

    setSession({
      ...session,
      versions: updatedVersions,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUpdateAnswer = (findingId: number, answerText: string) => {
    if (!session) return;
    const currentVersionNum = session.currentVersionNumber;

    const updatedVersions = session.versions.map((ver) => {
      if (ver.versionNumber !== currentVersionNum) return ver;

      const updatedAnswersMap = { ...ver.answers };
      if (!answerText || answerText.trim().length === 0) {
        delete updatedAnswersMap[findingId];
      } else {
        const finding = ver.report.findings.find((f) => f.id === findingId);
        updatedAnswersMap[findingId] = {
          findingId,
          question: finding?.question_for_pm || "Clarification",
          answerText,
          updatedAt: new Date().toISOString(),
        };
      }

      return {
        ...ver,
        answers: updatedAnswersMap,
      };
    });

    setSession({
      ...session,
      versions: updatedVersions,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUpdateOverallFeedback = (overallFeedback: OverallFeedback) => {
    if (!session) return;
    const currentVersionNum = session.currentVersionNumber;

    const updatedVersions = session.versions.map((ver) => {
      if (ver.versionNumber !== currentVersionNum) return ver;
      return {
        ...ver,
        overallFeedback,
      };
    });

    setSession({
      ...session,
      versions: updatedVersions,
      updatedAt: new Date().toISOString(),
    });
  };

  const currentVersion =
    session?.versions.find((v) => v.versionNumber === session.currentVersionNumber) ||
    session?.versions[session.versions.length - 1];

  return (
    <div className="min-h-screen flex flex-col bg-[#08090b] text-[#f4f4f6]">
      <Navbar
        onReset={handleReset}
        showReset={Boolean(session && currentVersion)}
        totalVersions={session?.versions.length || 1}
        currentVersionNumber={session?.currentVersionNumber || 1}
        onExport={handleExportSession}
        onClearHistory={handleClearHistory}
      />

      <main className="flex-1">
        {session && currentVersion ? (
          <ResultsView
            session={session}
            currentVersion={currentVersion}
            onSelectVersion={handleSelectVersion}
            onUpdateFindingFeedback={handleUpdateFindingFeedback}
            onUpdateAnswer={handleUpdateAnswer}
            onUpdateOverallFeedback={handleUpdateOverallFeedback}
            onRecheck={handleRecheck}
            isRechecking={isRechecking}
            recheckError={recheckError}
            onReset={handleReset}
            onExport={handleExportSession}
            onClearHistory={handleClearHistory}
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
            onSubmit={handleSubmitInitial}
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
