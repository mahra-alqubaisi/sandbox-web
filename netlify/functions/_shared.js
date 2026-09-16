// Shared server-side helpers for the Netlify Functions. NEVER imported by the
// browser — this module reads secrets from the function environment.

import crypto from 'node:crypto';

export const BACKEND = process.env.BACKEND_URL || 'https://agentpay-m3.onrender.com';
export const CONSOLE_TOKEN = process.env.CONSOLE_TOKEN || '';
export const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

// The fixed sandbox work queue (server-side, not accepted from the browser in v1).
export const WORK_QUEUE = [
  { supplier: 'Al Maha Laundry', handle: '@al-maha-laundry', amount: '3450.00' },
  { supplier: 'DHL',             handle: '@dhl',             amount: '14320.00' },
  { supplier: 'Office Supplies', handle: '@office-supplies', amount: '1850.00' },
  { supplier: 'New Events LLC',  handle: '@new-events-llc',  amount: '4000.00' },
];

// Guardrail: cap how much work one instruction can do.
export const MAX_TOOL_CALLS = 12;

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// A call to the backend's console surface as the trusted bridge (adds CONSOLE_TOKEN,
// and the visitor's session credential when scoping to their sandbox).
export async function backendConsole(path, { method = 'GET', session, body } = {}) {
  const headers = { authorization: `Bearer ${CONSOLE_TOKEN}` };
  if (session) headers['x-sandbox-session'] = session;
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(`${BACKEND}/console/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: r.status, json };
}

export function json(statusCode, obj) {
  return new Response(JSON.stringify(obj), {
    status: statusCode,
    headers: { 'content-type': 'application/json' },
  });
}
