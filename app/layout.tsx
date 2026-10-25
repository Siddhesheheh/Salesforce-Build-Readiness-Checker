import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Salesforce Build Readiness Checker",
  description:
    "Pre-build requirement quality review and structured resolution workflow for Salesforce PMs, BAs, and developers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark h-full bg-[#08090b] text-[#f4f4f6] antialiased">
      <body className="min-h-full flex flex-col font-sans selection:bg-sky-500/30 selection:text-sky-200 bg-[#08090b]">
        {children}
      </body>
    </html>
  );
}
