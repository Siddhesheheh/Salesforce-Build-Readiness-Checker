"use client";

import React from "react";
import { CloudIcon, DownloadIcon, TrashIcon, RefreshCwIcon } from "./Icons";

interface NavbarProps {
  onReset?: () => void;
  showReset?: boolean;
  totalVersions?: number;
  currentVersionNumber?: number;
  onExport?: () => void;
  onClearHistory?: () => void;
}

export function Navbar({
  onReset,
  showReset,
  totalVersions = 1,
  currentVersionNumber = 1,
  onExport,
  onClearHistory,
}: NavbarProps) {
  return (
    <header className="border-b border-white/[0.08] bg-[#08090b]/80 backdrop-blur-xl sticky top-0 z-30 transition-colors">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-3.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-b from-sky-500 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-sky-500/20 ring-1 ring-white/10">
            <CloudIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-[#f4f4f6] text-sm sm:text-base tracking-tight">
                Salesforce Build Readiness Checker
              </span>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/[0.06] text-zinc-400 border border-white/[0.08]">
                Pre-Build Rubric v1.0
              </span>
              {showReset && totalVersions > 1 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono text-sky-400 bg-sky-500/10 border border-sky-500/20">
                  v{currentVersionNumber} of {totalVersions}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 hidden md:block tracking-tight">
              Pre-build specification gap analysis &amp; structured resolution
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          {showReset && onExport && (
            <button
              type="button"
              onClick={onExport}
              title="Exports include your requirement text, org context, and clarification answers. Share only if the information is nonconfidential."
              className="inline-flex items-center space-x-1.5 text-xs font-medium text-zinc-300 hover:text-white px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-all"
            >
              <DownloadIcon className="w-3.5 h-3.5 text-zinc-400" />
              <span className="hidden sm:inline">Export</span>
            </button>
          )}

          {showReset && onClearHistory && (
            <button
              type="button"
              onClick={onClearHistory}
              title="Clear all stored review versions"
              className="inline-flex items-center space-x-1.5 text-xs font-medium text-zinc-400 hover:text-rose-300 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-rose-500/10 border border-white/[0.08] hover:border-rose-500/20 transition-all"
            >
              <TrashIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Clear History</span>
            </button>
          )}

          {showReset && onReset && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center space-x-1.5 text-xs font-medium text-white px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 shadow-sm shadow-blue-500/20 transition-all"
            >
              <RefreshCwIcon className="w-3.5 h-3.5" />
              <span>Review Another Requirement</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
