# Salesforce Build Readiness Checker

**Catch missing Salesforce requirements before they become sprint rework.**

Salesforce Build Readiness Checker is an AI-assisted web app that helps Salesforce developers, business analysts, and solution architects review user stories **before implementation**. It flags missing information, prioritizes clarification questions, and supports iterative review until a requirement is clearer and more actionable.

> **Live demo:** Add your Vercel deployment URL here  
> **Project case study:** Add your portfolio URL here (optional)

## The problem

Salesforce requirements can look complete on paper while omitting crucial details: user access, object relationships, existing automations, business workflows, or field behavior. These gaps often emerge only after a developer starts building.

In **three qualitative interviews** with Salesforce professionals:

- A developer reported discovering missing permission, relationship, and workflow details midway through implementation.
- A business analyst described overlooked technical requirements being raised during development or UAT.
- Another developer encountered existing automation that contradicted a new requirement, discovered within the first week of implementation and causing rework.

These interviews shaped the MVP. They are exploratory research, **not** evidence of measured time savings or broad market prevalence.

## The solution

1. **Paste a requirement** and optionally provide relevant Salesforce org context.
2. **Review readiness** against a structured, Salesforce-specific 10-category rubric.
3. **Inspect findings** labeled **Blocker**, **Important**, or **Minor**, along with clarification questions and suggested org checks.
4. **Answer open questions** and **recheck readiness**.
5. **Compare versions**, review changes, and export results as JSON.

The app returns one of three readiness assessments: **Not Ready**, **Needs Clarification**, or **Ready**.

## Key features

- Salesforce-specific requirement gap analysis
- Severity-ranked findings and actionable clarification questions
- Suggested manual checks for existing Salesforce org configuration
- Iterative **Resolve & Recheck** workflow
- Side-by-side review version comparison
- Browser-local review history and feedback
- JSON export
- Input validation, sanitized error handling, and API rate limiting

## Technology

| Layer | Implementation |
| --- | --- |
| Frontend | Next.js 14 (App Router), React, TypeScript, Tailwind CSS |
| AI analysis | Google Gemini, called server-side |
| Deployment | Vercel |
| Rate limiting | Upstash Redis, per-IP request limits |
| Local persistence | Browser `localStorage` |
| Testing | Vitest and automated application checks |

**Architecture at a glance:** Browser → Next.js API route → Gemini analysis → structured findings → review UI. Review history and user feedback are stored in the browser; there is no application database in the current MVP.

## Run locally

**Prerequisites:** Node.js, npm, and access to a Gemini API key. Upstash credentials may also be required depending on the repository's rate-limit configuration.

```bash
git clone <YOUR_REPOSITORY_URL>
cd <YOUR_REPOSITORY_DIRECTORY>
npm install
```

Create `.env.local` using the environment variable names documented in your codebase or `.env.example`. **Do not commit API keys or `.env.local`.** Then run:

```bash
npm run dev
```

Open `http://localhost:3000`.

> Before publishing, confirm the exact environment variable names and available npm scripts in `package.json`. This README intentionally does not guess secret variable names.

## Validation

The application has been exercised through automated tests and production deployment checks. The project has also been evaluated against sample Salesforce requirements. Test coverage and automated pass counts should be updated from the latest CI/test run rather than treated as permanent claims.

**Product success metrics to evaluate in future user testing:**

- At least 70% of flagged findings rated useful by testers
- At least 60% of testers discover a previously unnoticed gap
- At least 60% express willingness to use the tool before kickoff

These are **targets**, not achieved outcomes.

## Current limitations

- **No live Salesforce org integration:** org checks are recommendations for human verification, not actual metadata validation.
- **AI output requires review:** findings may be incomplete or incorrect; architects and developers remain responsible for final decisions.
- **Browser-local history:** clearing local storage or switching devices can remove saved reviews.
- **External AI processing:** do not submit confidential client requirements without the necessary organizational authorization.
- **No shared team workspace** in the current MVP.

## Planned improvements

1. **Requirement document upload**, so users can review files instead of only pasted text.
2. **Visible evaluation rubric**, so users understand the categories used to assess readiness.

These are planned enhancements, **not current features**.

## Product approach

**Research → Specification → Design → Build → Test → Go-to-Market**

The project started with interviews about requirements handoff failures, moved into an MVP focused on gap detection and clarification, and was implemented as a working AI-assisted review workflow. The goal is to support existing BA/developer/architect reviews—not replace them.

## Privacy and responsible use

Only use requirements that you are permitted to share with the configured AI provider. Remove customer identifiers, secrets, production data, and confidential implementation details from sample inputs. Local browser persistence does not mean the submitted requirement stays entirely on-device: analysis requests are sent to the backend and AI provider.

## Author

**Siddhesh Mahadik** — Salesforce Developer exploring Product Management through research-led product building.

---

*This is an independent portfolio project and is not affiliated with or endorsed by Salesforce.*
