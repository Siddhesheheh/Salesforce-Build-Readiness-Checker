# Step 3: Anti-Gravity UI prompt

Open the same repo in Anti-Gravity. Give the agent the prompt below. Keep to one screen's worth of changes per request, review the diff, run it locally, then commit.

```
You are building the front end for the Salesforce Build Readiness Checker. Read SPEC.md (sections 5-8, 10), schema.json, and lib/types.ts first.

SCOPE
Build a single page at app/page.tsx plus components in components/. Do NOT edit anything in app/api/, lib/, rubric.md, schema.json, or samples/. If you need a change there, stop and tell me.

DATA FOR DEVELOPMENT
Use fixtures/sample-report.json (mock data, UI development only) and fixtures/real-report-05.json if present. Add a development-only toggle (visible only when NODE_ENV is development) that loads a fixture instead of calling the API. The live page must call POST /api/review.

INPUT STATE
- Title "Salesforce Build Readiness Checker" and a one-line explainer: "Paste a requirement. Find what a developer would still need to know before building."
- Large textarea with live character counter (max 6000).
- Collapsible section "What do you know about the existing org? (optional)" with a smaller textarea (max 2000) and helper text: "Existing flows, validation rules, integrations, or reports on the objects involved."
- "Load sample" dropdown with these six names: Lead assignment, Royalty approval, Manuscript reviewer, Case escalation, Stale opportunities, Complete example (renewal reminders). Selecting one fills the textarea. Samples come from a prop or a small server-provided list; do not hardcode text in the component.
- Primary button "Review requirement", disabled under 20 characters.
- Privacy note under the button: "Use sample or sanitized requirements only. Do not paste confidential client data."

LOADING AND ERROR STATES
- Loading: button shows progress, results area shows a skeleton and a message that this takes 10-20 seconds. Disable inputs.
- Errors: too_short, too_long, rate_limited, review_failed each show a friendly message and a retry button. Keep the user's text.

RESULTS STATE
1. Verdict banner: verdict text, summary, and counts (Blockers, Important, Minor, Questions). Color plus icon plus text (never color alone). Not ready = red, Needs clarification = amber, Ready = green.
2. Category strip: 10 chips in the schema order showing name and status (Covered, Partial, Missing, Not applicable) with icon plus text. On mobile, make it wrap or scroll horizontally.
3. Finding cards in the order given by the API. Each card shows: title, severity badge, category tag; then labeled sections Evidence (styled as a quote), What's missing, Why it matters, Question for the PM (with a copy button and "Copied" confirmation), and Verify in the org (render only when non-empty, visually distinct as a checklist-style note).
4. On every card: "Was this useful?" thumbs up and thumbs down (toggleable, one selection) and an optional comment field that appears after a rating. On rating, POST to /api/feedback with session_id (random UUID kept in sessionStorage), sample_id if a sample was used, finding_id, category, severity, useful, comment. Never send requirement text. Failures are silent to the user but logged to the console.
5. "Copy all questions" button above the cards: copies a numbered list of every question_for_pm.
6. "Review another requirement" button that returns to the input state.
7. Footer: "Review aid only. Does not replace developer judgment or stakeholder sign-off. Do not paste confidential client data." plus a "Share feedback" link using NEXT_PUBLIC_FEEDBACK_FORM_URL (placeholder if unset).

DESIGN DIRECTION
Calm, document-like, high legibility, generous spacing, one accent color, system or a single clean sans-serif font. This is a professional review tool, not a marketing page. Responsive down to 375px width, keyboard accessible (visible focus, buttons not divs, aria-labels on icon buttons), and contrast that passes WCAG AA. Support light and dark mode.

ACCEPTANCE CHECKS (verify and tell me the result)
- Fixture renders all 10 categories and every finding with no layout break at 375px and 1280px.
- A finding with an empty verify_in_org shows no empty box.
- Copy all questions produces a clean numbered list.
- Rating one finding does not change the others.
- No localStorage; only sessionStorage for session_id.
- TypeScript compiles with no errors.
```

## How to work with it
1. Ask for the input state only first. Check it. Commit.
2. Then ask for the results state using the fixture. Check at phone width. Commit.
3. Then wire to the live API and feedback endpoint. Test end to end with a sample. Commit.
4. Only then polish. Every extra hour of styling is an hour not spent on testers.
