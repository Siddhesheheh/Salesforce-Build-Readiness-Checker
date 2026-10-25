import React from "react";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-white/[0.08] bg-[#08090b] py-8 text-xs text-zinc-500">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <div className="space-y-1">
          <p className="font-medium text-zinc-400">
            Salesforce Build Readiness Checker &bull; Pre-Build Review Aid
          </p>
          <p className="text-zinc-500 max-w-xl">
            Review aid only. Does not replace developer judgment or stakeholder sign-off. Do not paste confidential client data.
          </p>
          <p className="text-[11px] text-zinc-600">
            Requirements are analyzed transiently via secure AI APIs solely to generate readiness findings, with zero server retention. Review history, clarifying answers, and feedback are saved privately in this browser&apos;s local storage.
          </p>
        </div>
        <div className="flex items-center space-x-3 text-zinc-500 text-[11px]">
          <span>10 Rubric Categories</span>
          <span>&bull;</span>
          <span>Zero Data Retention</span>
        </div>
      </div>
    </footer>
  );
}
