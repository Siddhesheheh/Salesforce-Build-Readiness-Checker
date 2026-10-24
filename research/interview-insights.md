# Interview insights (3 interviews: 2 developers, 1 BA)

Treat as directional. Say "3 interviews" in the deck, never "users say". Get permission before quoting by name; default to "Salesforce Developer, 2.5 yrs" style attribution.

## Fix before you present
- A few lines in the first two interviews match the original question template word for word (Siddhesh: "received them almost weekly"; Vivek: "3-5", "15 to 25 user stories a week", "Product Owner proxy"). Confirm these were really their answers, or correct them.
- Siddhesh Q6 is cut off mid-sentence. Vivek has no answer for Q9 and Q10. Send short follow-ups.

## By interviewee
| | Siddhesh (Dev, 2.5 yrs) | Vivek (BA, 3 yrs) | Anniket (Dev) |
|---|---|---|---|
| Gap found | Missing: which users get the feature, which object a relationship field points to; client's internal workflow unclear even to client PO/BA | Developer reminds him; minor or major items missed | Existing client automation contradicted the new requirement ("every time") |
| How late | About halfway, at deployment | UAT, or after most development in sandbox | Within a week of starting build |
| Cost | Rework (implied) | Late fixes | Lost dev time and rework |
| Most missing | Permissions; developer test access | Own experience gap (Service Cloud architecture) | Schema details: object relationships, fields to populate; client does not know their org |
| Readiness check today | Architect review, then meeting with client PO and BA | Testing team results decide | BA and developer review together |
| AI use | Yes, generic solutions, Apex/triggers good, Flows decent, weak for admin process | Not permitted | Not permitted |
| Clarification loop | Tag client PO, wait about a day | n/a | Dev > Team Lead > PM > Client |
| Wish | BA/PO check the org and state requirements with a proper build structure | Know what developers need before submitting the BRD | Shared knowledge repository with decisions and reasoning |

## Themes (count of 3)
1. Gaps found late: 3/3
2. Client or BA does not know the current org or process: 2/3
3. Missing schema, relationship, access, or test-access details: 2/3
4. Slow clarification loop: 2/3
5. AI blocked by policy: 2/3
6. Inconsistent readiness checks: 3/3
7. Want a clear list of what developers need before handoff: 2/3 (Vivek, Siddhesh)
8. Want decisions captured in one place: 1/3 (Anniket)

## What each theme changed in the product
- Themes 2 and 3: new rubric categories (Data model and relationships; Current process and existing org impact) and the "verify in the org" check per finding.
- Theme 4: copy-all-questions so the BA can answer in one pass instead of a chain.
- Theme 5: synthetic samples; privacy note; honest limitation; private deployment on roadmap.
- Theme 7: BA/PM as the person who runs the check before handoff.
- Theme 8: roadmap item (review history and decision log).

## Quotes (confirm permission)
- "It happens every time." (Salesforce Developer)
- "The client completely forgot that they had an existing automation in their org that directly contradicted the new requirement." (Salesforce Developer)
- "It would have been better to know before submitting the BRD to the developer what essential things are required." (Salesforce BA, lightly cleaned)

## Still to get (3-5 more interviews)
- 1-2 Technical Architects (scale, NFRs, org impact)
- 1-2 more BAs or POs (they are the likely day-to-day users)
- Ask each: "Walk me through the last time this cost you time. How many hours or days?" so you have real cost numbers.
