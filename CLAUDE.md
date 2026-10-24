# Project context for Claude Code
Read SPEC.md first, then rubric.md and schema.json. They are the source of truth.
- Do not change rubric.md or schema.json unless asked. If code and spec disagree, tell me.
- Never call the LLM from browser code. Server-side API routes only.
- Never commit .env files or keys.
- Keep the app small: one page, two API routes. No database, no auth.
- After each working step, summarize what changed and suggest a commit message.
