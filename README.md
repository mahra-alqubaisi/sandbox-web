# AgentPay sandbox — public vertical slice

Static frontend + three Netlify Functions (the secure bridge).

## Env vars (Netlify dashboard → Site settings → Environment) — server-side only
- BACKEND_URL       = https://agentpay-m3.onrender.com
- CONSOLE_TOKEN     = <same token set on Render>
- ANTHROPIC_API_KEY = <your Anthropic key>
- CLAUDE_MODEL      = claude-sonnet-5   (optional)

The browser never receives any of these. It holds only the sbx_ session credential.

## Flow
open page → POST /session (creates private sandbox, stores agentKey server-side)
→ "Start today's run" → POST /instruct (validates session, gets tagged suppliers,
   real Claude calls the real MCP tools directly) → engine ALLOW/ESCALATE/DENY
→ UI re-fetches the five screens → approve the held item → re-fetch.
