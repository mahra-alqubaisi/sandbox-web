// /.netlify/functions/console
// A STRICT whitelist proxy to the backend console surface. No generic ?path=
// passthrough — only the exact sandbox operations below are allowed, each with
// its permitted method. The visitor's session credential comes in the
// 'x-sandbox-session' header; CONSOLE_TOKEN is added server-side here.

import { backendConsole, json } from './_shared.js';

// exact allowed operations: op -> { method, backendPath(fn) }
const READS = new Set(['overview', 'agents', 'payments', 'approvals', 'wallets']);

export default async (req) => {
  const url = new URL(req.url);
  const op = url.searchParams.get('op') || '';
  const session = req.headers.get('x-sandbox-session') || '';
  if (!session) return json(401, { error: 'session_required' });

  // --- reads (GET only) ---
  if (req.method === 'GET' && READS.has(op)) {
    const { status, json: body } = await backendConsole(op, { session });
    return json(status, body);
  }

  // --- approve / decline (POST only), id from query ---
  if (req.method === 'POST' && (op === 'approve' || op === 'decline')) {
    const id = url.searchParams.get('id') || '';
    if (!/^[0-9a-f-]{36}$/.test(id)) return json(400, { error: 'bad_approval_id' });
    const { status, json: body } = await backendConsole(`approvals/${id}/${op}`, { method: 'POST', session });
    return json(status, body);
  }

  return json(403, { error: 'operation_not_allowed' });
};
