# Salesforce Build Readiness Checker: SPEC

## 1. One-liner
A pre-build review that checks Salesforce requirement text against a fixed rubric and returns severity-ranked gaps. Each gap comes with the question to send to the BA/PM and a "verify in the org" check.

## 2. Problem
Salesforce requirements often lack implementation-critical details: who gets access, which object a field points to, what the existing org already does, what "done" means. Gaps surface mid-build or in UAT, causing rework, delays, and long clarification chains. Teams have no consistent way to check "ready to build" before kickoff.

## 3. Evidence (3 interviews: 2 developers, 1 BA. Directional only)
- All 3 found gaps late: halfway through the build, at deployment, or in UAT.
- 2 of 3 said clients do not fully understand their own org or current process (existing automation contradicting the new requirement; unclear internal workflow).
- 2 of 3 named missing schema and access details (relationship targets, populated fields, which users get access, developer test access).
- 2 of 3 described slow clarification loops (a day's wait for the client PO; developer > team lead > PM > client).
- 2 of 3 cannot use AI tools on project requirements due to company or client policy.
- The BA asked to know before sending the BRD what developers need.
- Readiness is checked inconsistently (architect plus client meeting; BA and developer review; the testing team effectively decides).

Quotes (confirm permission before using; see research/interview-insights.md):
- "It happens every time." (Developer)
- "It would have been better to know before submitting the BRD to the developer what essential things are required." (BA, lightly cleaned)

## 4. Users
- **Runs the tool (primary in the demo): BA/PM preparing the handoff.** Self-check before sending the BRD.
- **Also runs it: Developer/architect** at refinement, to turn a vague story into questions.
- **Beneficiary: developer**, who gets requirements with fewer gaps and a ready question list.

## 5. Scope
**In:** pasted requirement text; optional "org context" text the user types; gap detection across 10 categories; severity; impact explanation; clarifying questions; "verify in the org" checks; readiness verdict; per-finding usefulness rating; copy-all-questions.
**Out:** live org connection or metadata analysis; rewriting requirements; solution design; replacing human judgment and sign-off; user accounts; storing requirement text; real client data in demos (synthetic samples only).

## 6. User flow
1. Open the app. Paste a requirement or pick a sample.
2. Optionally expand "What do you know about the existing org?" and type anything relevant (existing flows, validation rules, integrations on these objects).
3. Click **Review requirement**.
4. See verdict banner, category strip, finding cards (Blocker first).
5. Copy questions; rate each finding useful or not; optionally comment.
6. Click the feedback form link in the footer.

## 7. Screens
**Single page, two states.**
- *Input state:* title; one-line explainer; textarea (max 6000 chars, live counter); collapsible org-context box (max 2000 chars); sample dropdown (6 samples); Review button; privacy note.
- *Results state:* verdict banner with counts; category strip (10 chips, color plus text); finding cards; "Copy all questions"; "Review another" button; footer disclaimer and feedback link.
- *Loading and error states:* loading with elapsed indicator; friendly error with retry; input-too-short message.

Finding card fields: title, severity badge, category tag, Evidence, What's missing, Why it matters, Question for the PM (copy button), Verify in the org (shown only if non-empty), Useful? thumbs up/down plus optional comment.

Footer text: "Review aid only. Does not replace developer judgment or stakeholder sign-off. Do not paste confidential client data."

## 8. API contract

### POST /api/review
Request: `{ "requirement": string (20..6000 chars), "org_context"?: string (max 2000) }`
Response 200: ReadinessReport (see schema.json)
Errors: 400 `{error:"too_short"|"too_long"}`; 429 `{error:"rate_limited"}`; 502 `{error:"review_failed"}`

Server logic:
1. Validate lengths. Trim.
2. System prompt = contents of rubric.md. User message = `REQUIREMENT:\n...\n\nORG CONTEXT:\n...` (or "None provided").
3. Call the LLM through one function, `callModel(system, user)` in `lib/llm.ts`, so the provider can be swapped. Temperature 0.2; request JSON output.
4. Parse and validate against schema.json (ajv). If it fails, retry once. If it fails again, return 502.
5. **Recompute `counts` and `readiness_verdict` from `findings` in code** (do not trust the model). Sort findings Blocker > Important > Minor and renumber ids.
6. Return the report. Do not persist requirement text. Log only metadata (length, verdict, latency, category counts).

### POST /api/feedback
Request: `{ session_id, sample_id?, finding_id, category, severity, useful: boolean, comment?: string (max 500) }`
Behavior: forward to `FEEDBACK_WEBHOOK_URL` (Google Apps Script writing to a Google Sheet). Return 204. Store no requirement text.

## 9. Tech and config
- Next.js (App Router, TypeScript), Tailwind, ajv, deployed on Vercel.
- Env vars: `LLM_API_KEY`, `LLM_MODEL`, `FEEDBACK_WEBHOOK_URL`. Never commit these. Set the same names in Vercel.
- Use whichever LLM provider the buildathon allows. Keep the provider call inside `lib/llm.ts` only.
- Files: `rubric.md` and `schema.json` are read on the server; samples live in `samples/` and are served to the UI as a list (exclude EXPECTED.md).

## 10. Guardrails
- Server-side calls only; key never reaches the browser.
- Input caps (6000 / 2000 chars). Best-effort per-IP rate limit (e.g. 10 per hour). In-memory limits are unreliable on serverless, so also set a spend cap or alert at the LLM provider.
- Prompt-injection: requirement text is treated as data (rubric rule 13). Test it.
- Privacy: the app does not store requirement text, but the LLM provider receives it. Tell testers to use sample or sanitized requirements.

## 11. Success metrics (set targets before testing; report honestly even if missed)
| Metric | Source | Target |
|---|---|---|
| Findings rated useful | in-app thumbs | at least 70% |
| Testers who found at least 1 gap they had not noticed | form Q7 | at least 60% |
| Would run before kickoff (4-5 of 5) | form Q11 | at least 60% |
| Preferred over a generic AI review (blind) | comparison test | majority of reviewers |
| Verdict consistency across 5 runs per sample | test script | 100% on samples 01-06 |
| False alarms on the complete sample | test script | 0 Blockers |

## 12. Definition of done
- Samples 01-05 return "Not ready to build" with at least 3 expected findings, 5 of 5 runs.
- Sample 06 never returns "Not ready to build".
- Vague one-liner returns a short prioritized list.
- Prompt-injection test passes.
- Deployed URL works on a phone and on another network.
- Thumbs up/down rows appear in the Google Sheet.
- At least 15 real testers have received the link and the feedback form.

## 13. Build order
1. `lib/llm.ts`, `/api/review`, and a script that runs all samples (no UI).
2. Test consistency; tune rubric.md only if needed. Commit.
3. UI (see prompts/03-anti-gravity-ui-prompt.md). Commit.
4. `/api/feedback` plus Google Sheet. Commit.
5. Deploy to Vercel. Test live.
6. Send to testers. Collect feedback.

## 14. Risks
| Risk | Mitigation |
|---|---|
| Generic or shallow findings | Fixed rubric, evidence quotes, specific-question rule, tester ratings |
| Over-flagging complete requirements | Sample 06 test; rubric rule 10 |
| Cannot see the org | Org-context box and "verify in the org" checks; org connection is roadmap |
| Policy blocks AI use on real requirements | Synthetic samples; note private deployment as future work |
| Inconsistent output | Low temperature, schema validation, code-computed verdict |
| Cost or abuse | Input caps, rate limit, provider spend cap |
| Tiny interview sample | Say "3 interviews" and get 3-5 more, especially an architect |

## 15. Roadmap (not in MVP)
Live org metadata check; saved review history and decision log (BA/dev request); Jira integration; private deployment for policy-restricted teams; "declarative vs custom code" signal.
