"use client";

import React from "react";
import { CloudIcon } from "./Icons";

interface NavbarProps {
  onReset?: () => void;
  showReset?: boolean;
}

export function Navbar({ onReset, showReset }: NavbarProps) {
  return (
    <header className="border-b border-slate-200 bg-white/95 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-sky-600 text-white flex items-center justify-center shadow-sm">
            <CloudIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-slate-900 text-base tracking-tight">
                Salesforce Build Readiness Checker
              </span>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                Pre-Build Rubric v1.0
              </span>
            </div>
            <p className="text-xs text-slate-500 hidden md:block">
              Identify specification gaps before sprint kickoff
            </p>
          </div>
        </div>

        {showReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center text-xs font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-md hover:bg-slate-100 transition-colors border border-slate-200"
          >
            Review Another Requirement
          </button>
        )}
      </div>
    </header>
  );
}
