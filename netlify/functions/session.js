// POST /.netlify/functions/session
// Creates a private sandbox session. Returns to the BROWSER only the sandbox
// credential and expiry. The session's agent key is captured here (bridge-only
// bootstrap) and stored server-side; it is never sent to the browser.

import { backendConsole, json } from './_shared.js';
import { putAgentKey } from './_store.js';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const { status, json: body } = await backendConsole('sessions', { method: 'POST' });
  if (status !== 200) return json(status, { error: 'session_create_failed', detail: body?.error });

  const { session, expiresAt, agentKey } = body;
  if (!session || !agentKey) return json(502, { error: 'bad_session_response' });

  // Keep the agent key server-side, keyed by the hash of the credential.
  await putAgentKey(session, agentKey, expiresAt);

  // Browser gets ONLY the credential and expiry. Never the agent key.
  return json(200, { session, expiresAt });
};
