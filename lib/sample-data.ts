export interface SampleRequirement {
  id: string;
  name: string;
  badge: string;
  description: string;
  requirement: string;
  orgContext?: string;
}

export const SAMPLES: SampleRequirement[] = [
  {
    id: "01-lead-assignment",
    name: "Sample 01: Lead Assignment",
    badge: "Incomplete (Vague)",
    description: "Automatic lead routing without region mappings, queues, or permission details.",
    requirement: `User Story: Automatic Lead Assignment
As a Sales Manager, I want new leads to be automatically assigned to the appropriate sales representative, so that leads are handled quickly by the right person.

Acceptance criteria:
- New leads should be assigned automatically.
- Leads should be assigned based on their region.
- Sales Managers should be able to track lead assignments.`,
    orgContext: "Standard Sales Cloud with custom Region__c picklist on Lead.",
  },
  {
    id: "02-royalty-approval",
    name: "Sample 02: Royalty Approval",
    badge: "Incomplete (Missing Rules)",
    description: "Approval process missing financial thresholds, approver roles, and rejection paths.",
    requirement: `User Story: Author Royalty Approval
As a Finance Lead, I want royalty statements to be approved before they are sent to authors, so that payments are accurate.

Acceptance criteria:
- Statements above a certain amount need approval.
- Approved statements are emailed to authors.
- Finance can see which statements are pending.`,
    orgContext: "Custom Royalty_Statement__c object master-detail to Account.",
  },
  {
    id: "03-manuscript-reviewer",
    name: "Sample 03: Manuscript Reviewer",
    badge: "Incomplete (Access & Limits)",
    description: "Reviewer assignment without portal access, notification templates, or deadline logic.",
    requirement: `User Story: Manuscript Reviewer Assignment
As an Acquisitions Editor, I want to assign an external reviewer to each submitted manuscript, so that every manuscript gets reviewed.

Acceptance criteria:
- The editor can select a reviewer on the manuscript record.
- The reviewer is notified of the assignment.
- Reviews are completed within the deadline.`,
  },
  {
    id: "04-case-escalation",
    name: "Sample 04: Case Escalation",
    badge: "Incomplete (SLA & Notifications)",
    description: "Escalation story missing SLA hours, business hours criteria, and escalation channels.",
    requirement: `User Story: Premium Subscriber Case Escalation
As a Support Manager, I want cases from premium subscribers to be escalated automatically if they are not resolved in time, so that premium customers stay happy.

Acceptance criteria:
- Cases from premium subscribers are escalated if unresolved.
- Escalated cases are visible to the Support Manager.
- The customer is informed about the escalation.`,
    orgContext: "Service Cloud with standard Entitlement and Milestone management.",
  },
  {
    id: "05-stale-opportunities",
    name: "Sample 05: Stale Opportunities",
    badge: "Incomplete (Automation Edge Cases)",
    description: "Auto-close automation without exception criteria, opt-outs, or activity definition.",
    requirement: `User Story: Auto-Close Stale Opportunities
As a Sales Operations Manager, I want opportunities with no activity for 60 days to be closed automatically, so that the pipeline stays accurate.

Acceptance criteria:
- Opportunities with no activity for 60 days are set to Closed Lost.
- The system records why the opportunity was closed.
- The owning sales rep receives an email when this happens.`,
  },
  {
    id: "06-complete-renewal-reminders",
    name: "Sample 06: Renewal Reminders",
    badge: "Complete (Ready to Build)",
    description: "Comprehensive specification covering business rules, schema, access, scale, and test criteria.",
    requirement: `User Story: Subscription Renewal Reminders
As a Subscription Operations Specialist, I want customers to receive automatic renewal reminders before their subscription ends, so that fewer subscriptions lapse unintentionally.

Current process: Finance emails customers manually from a spreadsheet each month. This is error-prone and misses customers. The spreadsheet is retired after go-live. The admin team confirmed the only existing flow on Subscription__c is "Set Status on Expiry", which runs when Renewal_Date__c passes and does not touch any reminder fields. There are no validation rules on the new fields.

Business rules:
- Eligible: Subscription__c where Status__c = "Active" and Auto_Renew__c = false.
- Reminders are sent 60, 30 and 7 days before Renewal_Date__c. The daily run happens at 06:00 in the org's default time zone.
- Paused and Cancelled subscriptions are excluded.
- Contacts with Email Opt Out = true are skipped and a Task is created for Subscription Operations.

Data:
- New fields on Subscription__c: Last_Reminder_Sent__c (Date), Last_Reminder_Type__c (Picklist: 60/30/7).
- Recipient is the Primary_Contact__c lookup (Contact). If it is empty or has no email, create a Task for Subscription Operations instead of sending.
- About 12,000 active subscriptions; peak of roughly 1,500 reminders per day in January. Volume has been checked against the org's daily email allocation.
- No backfill: existing active subscriptions are eligible only for the next upcoming threshold. No retroactive reminders are sent on go-live.

Automation:
- A scheduled Flow runs daily at 06:00. It must be safe for bulk runs and must not send the same reminder type twice (checked using Last_Reminder_Type__c).
- Email uses a Lightning email template owned by Subscription Operations.

Access:
- Subscription Operations (profile) can view the reminder fields and the log. Finance has read-only access. The permission set "Renewal_Reminder_Admin" allows editing the template.
- The flow runs in system context. Developers and UAT testers will receive the "Renewal_Reminder_Admin" permission set in the UAT sandbox, with 50 seeded test subscriptions.

Reporting:
- Dashboard "Renewal Reminders" shows reminders sent per week, tasks created for failures, and renewals within 14 days of a reminder. Source: Last_Reminder_Sent__c, Last_Reminder_Type__c, Task records.

Acceptance criteria (Given/When/Then):
- Given an active, non-auto-renew subscription renewing in 30 days, when the daily flow runs, then the 30-day email is sent once and the fields are updated.
- Given the same subscription on the next run, then no duplicate is sent.
- Given a contact with Email Opt Out, then no email is sent and a Task is created.
- Given a Paused subscription, then nothing is sent.
- Sign-off: Head of Subscriptions after UAT in the sandbox using the 50 test subscriptions.`,
    orgContext: "Existing scheduled Flow 'Set Status on Expiry' on Subscription__c. Daily email limits checked.",
  },
];
