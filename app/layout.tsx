import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Salesforce Build Readiness Checker",
  description:
    "Pre-build requirement quality review for Salesforce PMs, BAs, and developers. Identifies implementation gaps before kickoff.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full bg-slate-50 text-slate-900 antialiased">
      <body className="min-h-full flex flex-col font-sans selection:bg-sky-100 selection:text-sky-900">
        {children}
      </body>
    </html>
  );
}
