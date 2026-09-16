// AgentPay sandbox frontend. Holds only the sandbox session credential.
// Never sees CONSOLE_TOKEN, the Anthropic key, or the agent key — those live in
// the Netlify Functions. All backend access goes through /.netlify/functions/*.

const state = {
  session: null,       // the sbx_ credential (the only thing the browser holds)
  screen: 'Home',
  overview: null, agents: null, payments: null, approvals: null, wallets: null,
  running: false, lastRun: null, error: null,
};
const money = (minor, cur = 'AED') => `${cur} ${(minor / 100).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;

// ---- function calls ----
async function fn(name, opts = {}) {
  const headers = {};
  if (state.session) headers['x-sandbox-session'] = state.session;
  if (opts.body) headers['content-type'] = 'application/json';
  const r = await fetch(`/.netlify/functions/${name}${opts.qs || ''}`, {
    method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const read = (op) => fn('console', { qs: `?op=${op}` });

// ---- landing ----
function landing() {
  return `
    <div class="landing">
      <h1>Watch an AI agent do a company's supplier payments — safely.</h1>
      <p>The Procurement Agent already has its job, its suppliers, and its spending limits.
         Start its run and watch it work — while the platform, not the AI, decides what's allowed.</p>
      <div class="three">
        <div><b>The agent works</b>It pays today's suppliers on its own.</div>
        <div><b>You set the limits</b>Per-payment caps and approved suppliers.</div>
        <div><b>The platform decides</b>Each payment is paid, held, or refused.</div>
      </div>
      <button class="cta" onclick="startSandbox()">Open the sandbox</button>
      <div class="sandbox-note">Demonstration · simulated funds · no real money moves</div>
    </div>`;
}

async function startSandbox() {
  render(true);   // show a simple loading state
  const r = await fn('session', { method: 'POST' });
  if (r.status !== 200 || !r.json?.session) { state.error = 'Could not start the sandbox. Please try again.'; return render(); }
  state.session = r.json.session;
  await refreshAll();
  state.screen = 'Home';
  render();
}

// ---- data ----
async function refreshAll() {
  const [ov, ag, pay, apr, wal] = await Promise.all([read('overview'), read('agents'), read('payments'), read('approvals'), read('wallets')]);
  state.overview = ov.json; state.agents = ag.json; state.payments = pay.json;
  state.approvals = apr.json; state.wallets = wal.json;
}

// ---- the app ----
const NAV = ['Home', 'Agents', 'Payments', 'Approvals', 'Wallets'];
function openApprovals() { return (state.approvals || []).filter(a => a.status === 'open'); }

function shell(inner) {
  const pending = openApprovals().length;
  const tab = (n) => `<button class="${state.screen === n ? 'on' : ''}" onclick="go('${n}')">${n}${n === 'Approvals' && pending ? `<span class="badge">${pending}</span>` : ''}</button>`;
  return `
    <div class="app">
      <nav class="rail"><div class="co">${state.overview?.party?.name || 'Sandbox'}</div>${NAV.map(tab).join('')}</nav>
      <main class="canvas"><div class="view">${inner}</div></main>
    </div>
    <div class="simnote">Simulated funds · demo</div>`;
}

function homeView() {
  const proc = (state.agents || []).find(a => a.name === 'Procurement Agent') || {};
  const auth = `
    <h2>Procurement Agent · authority</h2>
    <div class="auth">
      <div class="line"><span>Wallets</span><span class="muted">${(proc.wallets || []).join(', ')}</span></div>
      <div class="line"><span>Pay</span><span class="yes">Yes ✓</span></div>
      <div class="line"><span>Transfer</span><span class="no">No ✕</span></div>
      <div class="line"><span>Request</span><span class="yes">Yes ✓</span></div>
      <div class="line"><span>Per payment</span><span class="muted">${money(proc.maxTransaction || 0)}</span></div>
      <div class="line"><span>Per day</span><span class="muted">${money(proc.dailyAuthority || 0)}</span></div>
      <div class="line"><span>Suppliers</span><span class="muted">Approved suppliers only</span></div>
    </div>`;

  // Today's work queue is the agent's own task list — shown, not typed.
  const queue = [
    { name: 'Al Maha Laundry', amount: 'AED 3,450.00' },
    { name: 'DHL', amount: 'AED 14,320.00' },
    { name: 'Office Supplies', amount: 'AED 1,850.00' },
    { name: 'New Events LLC', amount: 'AED 4,000.00' },
  ];
  const work = `
    <h2>Today's supplier payments</h2>
    <div class="instruct">
      ${queue.map(q => `<div class="row"><div class="t">${q.name}</div><div class="r v">${q.amount}</div></div>`).join('')}
      ${state.error ? `<div class="err">${state.error}</div>` : ''}
      ${state.running
        ? `<div class="working">Procurement Agent is working through today's payments…</div>`
        : (state.lastRun ? '' : `<button class="runbtn" onclick="runInstruction()">Start today's run</button>`)}
      ${state.lastRun ? runSummary() : ''}
    </div>`;

  const balance = `<h2>Total balance</h2><div class="big">${money(state.overview?.totalMinor || 0)}</div>`;
  return balance + auth + work;
}

function runSummary() {
  const pending = openApprovals().length;
  return `
    <h2>What happened</h2>
    <div class="muted" style="margin-bottom:10px">${state.lastRun.say ? esc(state.lastRun.say) : 'The agent finished.'}</div>
    ${(state.payments || []).slice(0, 6).map(paymentRow).join('')}
    ${pending ? `<div class="working" style="margin-top:14px">${pending} payment needs your approval — see the Approvals tab.</div>` : ''}`;
}

function paymentRow(p) {
  const w = p.status === 'settled' || p.status === 'created' ? 'go' : p.outcome === 'escalate' ? 'wait' : p.status;
  const label = p.status === 'settled' ? 'Paid' : p.status === 'created' ? 'Paid' : p.status;
  return `<div class="row"><div><div class="t">${p.counterparty ? cleanHandle(p.counterparty) : (p.agent || '')}</div><div class="s">${p.purpose || ''}</div></div>
    <div class="r"><div class="v">${money(p.amount, p.currency)}</div><div class="status ${w}">${label}</div></div></div>`;
}

function agentsView() {
  return `<h2>Agents</h2>` + (state.agents || []).map(a => `
    <div class="row"><div><div class="t">${a.name}</div><div class="s">${(a.wallets || []).join(', ') || 'No wallet access'}</div></div>
      <div class="r"><div class="status go">${a.status === 'active' ? 'Active' : a.status}</div></div></div>`).join('');
}

function paymentsView() {
  const list = state.payments || [];
  if (!list.length) return `<h2>Payments</h2><div class="muted">No payments yet. Run today's task from Home.</div>`;
  return `<h2>Payments</h2>` + list.map(paymentRow).join('');
}

function approvalsView() {
  const open = openApprovals();
  const resolved = (state.approvals || []).filter(a => a.status !== 'open');
  if (!open.length && !resolved.length) return `<h2>Approvals</h2><div class="muted">Nothing to approve.</div>`;
  return `<h2>Approvals</h2>` + open.map(a => `
    <div class="appr">
      <div class="amt">${money(a.amount, a.currency)}</div>
      <div class="to">${cleanHandle(a.counterparty)}</div>
      <div class="rsn">Over the agent's ${money(a.breachedLimit)} per-payment limit.</div>
      <div class="acts">
        <button class="ok" onclick="approve('${a.id}', true)">Approve</button>
        <button class="no" onclick="approve('${a.id}', false)">Decline</button>
      </div>
    </div>`).join('') + resolved.map(a => `<div class="done">${money(a.amount, a.currency)} · ${cleanHandle(a.counterparty)} — ${a.status}</div>`).join('');
}

function walletsView() {
  return `<h2>Total balance</h2><div class="big">${money(state.overview?.totalMinor || 0)}</div>
    <h2>Wallets</h2>` + (state.wallets?.wallets || []).map(w => `
    <div class="row"><div><div class="t">${w.name}</div><div class="s">${w.purpose === 'vault' ? 'Reserve — agents cannot spend from it' : 'Agent-spendable'}</div></div>
      <div class="r"><div class="v">${money(w.balance, w.currency)}</div></div></div>`).join('');
}

// ---- actions ----
async function runInstruction() {
  state.running = true; state.error = null; render();
  const r = await fn('instruct', { method: 'POST' });
  state.running = false;
  if (r.status !== 200) {
    state.error = r.json?.error === 'rate_limited'
      ? 'The sandbox is busy right now — please try again in a few minutes.'
      : 'The agent could not complete the task. Please try again.';
    return render();
  }
  state.lastRun = r.json;
  await refreshAll();
  render();
}

async function approve(id, ok) {
  const decoded = id.replace(/^apr_/, '').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  await fn('console', { method: 'POST', qs: `?op=${ok ? 'approve' : 'decline'}&id=${decoded}` });
  await refreshAll();
  render();
}

// ---- render ----
function go(s) { state.screen = s; render(); }
function render(loading = false) {
  const root = document.getElementById('root');
  if (loading && !state.session) { root.innerHTML = `<div class="landing"><h1>Starting your sandbox…</h1></div>`; return; }
  if (!state.session) { root.innerHTML = landing(); return; }
  const views = { Home: homeView, Agents: agentsView, Payments: paymentsView, Approvals: approvalsView, Wallets: walletsView };
  root.innerHTML = shell(views[state.screen]());
}

// ---- helpers ----
function cleanHandle(h) { return String(h || '').replace(/^@/, '').replace(/-[0-9a-f]{8}$/, '').replace(/-/g, ' '); }
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
window.startSandbox = startSandbox; window.go = go; window.runInstruction = runInstruction; window.approve = approve;

render();
