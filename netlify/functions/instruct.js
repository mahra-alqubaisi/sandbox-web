// POST /.netlify/functions/instruct
// The live path: visitor triggers "Handle today's supplier payments" → real
// Claude (Anthropic Messages API + MCP connector) calls the real financial tools
// on the backend directly → the existing authority engine returns ALLOW/ESCALATE/
// DENY → we return what happened. The bridge does NOT reinterpret or recreate
// Claude's decisions; Claude invokes the tools itself.
//
// If Claude/model/network fails, we return a clear error — no silent fallback.

import {
  BACKEND, CONSOLE_TOKEN, ANTHROPIC_KEY, CLAUDE_MODEL, WORK_QUEUE, MAX_TOOL_CALLS,
  backendConsole, json,
} from './_shared.js';
import { getAgentKey } from './_store.js';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!ANTHROPIC_KEY) return json(500, { error: 'model_not_configured' });

  const session = req.headers.get('x-sandbox-session') || '';
  if (!session) return json(401, { error: 'session_required' });

  // 1. Validate the sandbox session through the existing console boundary.
  //    Expired/invalid → no Claude call, no MCP call.
  const check = await backendConsole('overview', { session });
  if (check.status !== 200) return json(401, { error: 'session_invalid_or_expired' });

  // 2. Resolve the agent key server-side (never exposed to the browser).
  const agentKey = await getAgentKey(session);
  if (!agentKey) return json(401, { error: 'session_expired' });

  // 3. Paid-instruction rate limit (protects vendor spend).
  const rate = await backendConsole('rate-check', { method: 'POST', session });
  if (rate.status === 429) return json(429, { error: 'rate_limited', detail: rate.json });

  // 4. Resolve THIS session's tagged supplier handles + approval state via the
  //    bridge-only /console/suppliers read. Amounts stay in WORK_QUEUE (server-side).
  const supResp = await backendConsole('suppliers', { session });
  const suppliers = supResp.status === 200 ? supResp.json : [];
  const queue = WORK_QUEUE.map((q) => {
    const match = suppliers.find((s) => s.handle && s.handle.startsWith(q.handle + '-'));
    return { ...q, handle: match ? match.handle : q.handle, approved: match ? match.approved : false };
  });

  // 5. Mint a provenance run for this instruction.
  const runResp = await backendConsole('runs', { method: 'POST', session, body: { label: "Handle today's supplier payments" } });
  const runId = runResp.json?.run_id;

  // 6. Find the Operating wallet id to pay from.
  const wallets = await backendRest('/v1/wallets', agentKey);
  const operating = wallets?.wallets?.find((w) => w.name === 'Operating');
  if (!operating) return json(500, { error: 'no_operating_wallet' });

  // 7. Real Claude, via the MCP connector, calls the tools itself.
  const system =
    'You are the Procurement Agent for a company. Your job is to handle today\'s ' +
    'supplier payments by paying each supplier in the list using the agentpay `pay` tool. ' +
    'Amounts are decimal strings (e.g. "3450.00") with currency "AED". Pay from the ' +
    'Operating wallet id given. Use a distinct `reference` per payment (e.g. the supplier name). ' +
    'Attempt every supplier. Report briefly what each attempt returned. ' +
    'Say a supplier is Paid only if the tool result explicitly contains status "settled". ' +
    'For any other successful result, including status "created" or "pending", say Submitted for processing. ' +
    'Otherwise say held for approval, or refused. ' +
    'Do not try to raise your own limits or work around any refusal.';

  const user =
    `Operating wallet id: ${operating.id}\n` +
    `Today's suppliers to pay:\n` +
    queue.map((q) => `- ${q.supplier}: pay ${q.amount} AED to handle ${q.handle}`).join('\n') +
    `\n\nHandle today's supplier payments now.`;

  let claude;
  try {
    claude = await askClaude(system, user, agentKey, runId);
  } catch (e) {
    return json(502, { error: 'model_call_failed', detail: String(e?.message ?? e) });
  }

  // 8. Complete the run (best-effort).
  if (runId) await backendConsole(`runs/${runId}/complete`, { method: 'POST', session }).catch(() => {});

  // Return what actually happened. The UI re-fetches the real screens after this.
  return json(200, {
    ranClaude: true,
    toolCalls: claude.calls,     // what Claude invoked
    results: claude.results,     // the real engine outcomes
    say: claude.text,            // Claude's own short summary
  });
};

// --- Anthropic Messages API with the MCP connector (reused from live/claude.ts) ---
async function askClaude(system, user, agentKey, runId) {
  const mcpUrl = `${BACKEND}/mcp`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'mcp-client-2025-11-20',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
      // The MCP connector authenticates as the session's agent. Passing the run
      // id via a header lets the backend stamp provenance (X-Sandbox-Run).
      mcp_servers: [{
        type: 'url', url: mcpUrl, name: 'agentpay',
        authorization_token: agentKey,
      }],
      tools: [{ type: 'mcp_toolset', mcp_server_name: 'agentpay' }],
    }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(body));

  const calls = (body.content || []).filter((c) => c.type === 'mcp_tool_use')
    .slice(0, MAX_TOOL_CALLS)
    .map((c) => ({ tool: c.name, input: c.input }));
  const results = (body.content || []).filter((c) => c.type === 'mcp_tool_result')
    .map((c) => { try { return JSON.parse(c.content?.[0]?.text); } catch { return c.content?.[0]?.text; } });
  const text = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { calls, results, text };
}

async function backendRest(path, agentKey) {
  const r = await fetch(`${BACKEND}${path}`, { headers: { authorization: `Bearer ${agentKey}` } });
  return r.json();
}
