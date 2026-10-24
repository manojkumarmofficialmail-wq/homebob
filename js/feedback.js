// Sends feedback to /api/feedback. Messages wait on the phone when offline
// and go out the next time Homzy is open with internet.
export const APP_VERSION = '1.3.0';

const OUTBOX = 'homzy:feedback-outbox';
const INSTALL = 'homzy:install-id';
const ENDPOINT = '/api/feedback';

const read = () => { try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch { return []; } };
const write = (list) => { try { localStorage.setItem(OUTBOX, JSON.stringify(list.slice(-20))); } catch { /* storage full or blocked */ } };

/** A random id for this install, so repeat feedback can be grouped. Not linked to a person. */
export function installId() {
  try {
    let id = localStorage.getItem(INSTALL);
    if (!id) { id = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(INSTALL, id); }
    return id;
  } catch { return null; }
}

async function post(entry) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
    keepalive: true,
  });
  // 4xx (except rate limits) means the message itself was rejected: don't retry it forever.
  if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) return res.ok ? 'sent' : 'rejected';
  throw new Error('Server error ' + res.status);
}

/**
 * Send one piece of feedback. Resolves to 'sent', 'queued' (offline or server down)
 * or 'rejected'.
 */
export async function sendFeedback(fields) {
  const entry = {
    ...fields,
    app_version: APP_VERSION,
    install_id: installId(),
    locale: navigator.language || null,
    platform: matchMedia?.('(display-mode: standalone)').matches ? 'installed' : 'browser',
    created_on_device: new Date().toISOString(),
  };
  if (!navigator.onLine) { write([...read(), entry]); return 'queued'; }
  try {
    return await post(entry);
  } catch {
    write([...read(), entry]);
    return 'queued';
  }
}

/** Try to send anything waiting. Safe to call often. */
let flushing = false;
export async function flushOutbox() {
  if (flushing || !navigator.onLine) return;
  const list = read();
  if (!list.length) return;
  flushing = true;
  const left = [];
  for (const entry of list) {
    try { await post(entry); } catch { left.push(entry); }
  }
  write(left);
  flushing = false;
}

export const pendingCount = () => read().length;

window.addEventListener('online', () => { flushOutbox(); });
