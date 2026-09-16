// Server-side store mapping SHA-256(session credential) -> { agentKey, expiresAt }.
// Uses Netlify Blobs (built-in, persists across stateless function invocations).
// The raw sbx_ credential is NEVER used as the storage key, and the agentKey is
// NEVER returned to the browser — only instruct.js reads it, server-side.

import { getStore } from '@netlify/blobs';
import { sha256 } from './_shared.js';

const store = () => getStore('sandbox-agent-keys');

export async function putAgentKey(credential, agentKey, expiresAt) {
  await store().setJSON(sha256(credential), { agentKey, expiresAt });
}

export async function getAgentKey(credential) {
  const rec = await store().get(sha256(credential), { type: 'json' });
  if (!rec) return null;
  // best-effort expiry check on our side; the backend is the real gate.
  if (rec.expiresAt && Date.parse(rec.expiresAt) <= Date.now()) return null;
  return rec.agentKey;
}
