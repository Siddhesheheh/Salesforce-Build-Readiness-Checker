import React from "react";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white py-6 text-xs text-slate-500">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
        <div>
          <p className="font-medium text-slate-600">
            Salesforce Build Readiness Checker &bull; Pre-Build Review Aid
          </p>
          <p className="mt-1 text-slate-500">
            Review aid only. Does not replace developer judgment or stakeholder sign-off. Do not paste confidential client data.
          </p>
        </div>
        <div className="flex items-center space-x-4 text-slate-400">
          <span>Evaluates 10 Rubric Categories</span>
          <span>&bull;</span>
          <span>Zero Data Retention</span>
        </div>
      </div>
    </footer>
  );
}
