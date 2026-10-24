import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Salesforce Build Readiness Checker",
  description: "Pre-build review that checks Salesforce requirement text against a fixed rubric.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
