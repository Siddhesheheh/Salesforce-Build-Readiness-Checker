# Step 1: Sharpening the problem, questions, and claims

## 1. One-liner options (pick one)
A. Salesforce requirements reach developers with critical details missing. This tool finds the gaps before the build starts and writes the questions to ask.
B. Find what's missing from a Salesforce requirement before development starts, and get the exact questions to send.
C. A pre-build readiness check for Salesforce requirements: gaps, severity, and ready-to-send questions.

Recommendation: B for the deck title slide, A for the problem slide.

## 2. Weak spots in the earlier problem statement, and the fixes
| Weak spot | Fix |
|---|---|
| Primary user was the developer, but your strongest evidence (BA interview) says the BA wants to know what developers need before sending the BRD | The BA/PM runs the check before handoff; the developer benefits and can also run it at refinement |
| "Reduce rework" cannot be measured in a few days | Measure usefulness, new gaps found, preference vs generic AI, intent to use |
| Biggest pain (existing org conflicts) is out of scope | Org-context box plus "verify in the org" checklist; org connection on roadmap |
| Evidence was one quote | 3 interviews with a theme table; get 3-5 more |
| "Nothing like this exists" is unverified | Say "we found no tool focused on requirement completeness before build" only after you have searched, and name what you checked |

## 3. Questions a judge will ask, and honest answers
**Why not paste it into ChatGPT?**
You can, and generic AI is good at generic Salesforce gotchas (one developer told us so). The tool adds a fixed 10-category rubric so results are consistent, severity ranking, quoted evidence from the requirement, questions written for the BA to answer, and a verify-in-the-org checklist. We tested this with a blind comparison: [insert result].

**Can it see our org?**
No. That was the most requested feature in interviews, and it is the roadmap. For now, users can type what they know about the org, and every finding includes what to check in Setup.

**How do you know the findings are right?**
We do not claim they are always right. Every finding is rated by real users, and we report the percentage rated useful, including what they said was wrong or missing.

**What about client data and privacy?**
Two of three interviewees cannot use AI on project requirements. The demo uses synthetic requirements only, the app does not store requirement text, and a private deployment is the path for restricted teams.

**Who is the user?**
The BA/PM preparing a handoff, with the developer as beneficiary. Interview evidence: the BA asked for exactly this; two developers described the late-gap pain.

**Isn't a checklist enough?**
A static checklist does not read the requirement. One developer said their Definition of Ready is "very inconsistent" under time pressure. [Only use this quote if it came from a real interview you have.]

## 4. Success metrics (decide targets before testing)
See SPEC.md section 11. Say in the deck that targets were set before testing, and report misses.

## 5. Claims to avoid
- Statistical claims from 15-20 testers. Say "12 of 17 testers".
- Time-saved or money-saved numbers you did not measure.
- "AI-powered" as the differentiator.
- Anything implying the tool replaces human review.
