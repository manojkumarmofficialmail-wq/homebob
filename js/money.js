// Household money: daily help (milk, maid, newspaper…), bills and renewals, UPI links,
// grocery orders and the daily reminder digest. Pure functions only (no DOM, no storage):
// the app uses them, and so does the reminder server (api/remind.js).

// ---------- Dates (YYYY-MM-DD strings, no time zones) ----------
const pad = (n) => String(n).padStart(2, '0');
const parse = (d) => { const [y, m, dd] = d.split('-').map(Number); return { y, m, d: dd }; };
export const ymOf = (date) => date.slice(0, 7);
export const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const addDays = (date, n) => { const { y, m, d } = parse(date); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 864e5);
const ymd = (date) => { const { y, m, d } = parse(date); return [y, m - 1, d]; };
export const weekdayOf = (date) => new Date(Date.UTC(...ymd(date))).getUTCDay(); // 0 = Sunday
/** Same day `n` months later, kept inside the month (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(date, n, day = parse(date).d) {
  const { y, m } = parse(date);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const ym = t.toISOString().slice(0, 7);
  return `${ym}-${pad(Math.min(day, daysInMonth(ym)))}`;
}
export const prevMonth = (ym) => addMonths(`${ym}-01`, -1).slice(0, 7);
export const monthName = (ym, style = 'long', loc = 'en-IN') => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(loc, { month: style, timeZone: 'UTC' });
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- Daily help & deliveries ----------
// per: 'unit' → rate × quantity (milk ₹56 a litre), 'day' → rate × days it came (newspaper),
// 'month' → a fixed monthly amount (maid's salary), whatever the days.
export const SERVICE_KINDS = {
  milk: { label: 'Milk', emoji: '🥛', per: 'unit', unit: 'L', qty: 1, rate: 56 },
  newspaper: { label: 'Newspaper', emoji: '📰', per: 'day', unit: '', qty: 1, rate: 8 },
  maid: { label: 'Maid', emoji: '🧹', per: 'month', unit: '', qty: 1, rate: 4000 },
  cook: { label: 'Cook', emoji: '👩‍🍳', per: 'month', unit: '', qty: 1, rate: 6000 },
  water: { label: 'Water can', emoji: '💧', per: 'unit', unit: 'can', qty: 1, rate: 40 },
  driver: { label: 'Driver', emoji: '🚗', per: 'month', unit: '', qty: 1, rate: 12000 },
  other: { label: 'Other', emoji: '🧾', per: 'day', unit: '', qty: 1, rate: 0 },
};
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Is this service due to come on `date`? days: 'daily' or weekday digits ('123456' = Mon–Sat). */
export function scheduled(svc, date) {
  if (!svc || svc.active === false) return false;
  if (svc.since && date < svc.since) return false;
  if (svc.until && date > svc.until) return false;
  const days = svc.days || 'daily';
  return days === 'daily' || days.includes(String(weekdayOf(date)));
}

/** What came on a day: the family's note for that day, else the usual amount if scheduled. */
export function dayQty(log, svc, date) {
  const v = log?.[svc.id]?.[date];
  if (v != null) return +v;
  return scheduled(svc, date) ? +svc.qty || 1 : 0;
}

/**
 * One service for one month, counting days up to `upto` (today) for the current month.
 * Returns { days, came, missed, extra, qty, amount, paid, due, full }; full = the month is over.
 */
export function serviceMonth(svc, log, payments, ym, upto) {
  const last = `${ym}-${pad(daysInMonth(ym))}`;
  const end = upto && upto < last ? upto : last;
  let days = 0, came = 0, missed = 0, extra = 0, qty = 0;
  for (let d = 1; d <= daysInMonth(ym); d++) {
    const date = `${ym}-${pad(d)}`;
    if (date > end) break;
    const sch = scheduled(svc, date);
    const q = dayQty(log, svc, date);
    if (sch) days++;
    if (q > 0) { came++; qty += q; if (!sch) extra++; } else if (sch) missed++;
  }
  let amount;
  if (svc.per === 'month') {
    // A fixed salary; only a month they started part-way through is shared out by days.
    const starts = svc.since && svc.since > `${ym}-01` ? svc.since : null;
    let all = 0, from = 0;
    for (let d = 1; d <= daysInMonth(ym); d++) {
      const date = `${ym}-${pad(d)}`;
      const sch = scheduled({ ...svc, since: null }, date);
      if (sch) { all++; if (!starts || date >= starts) from++; }
    }
    amount = starts ? (all ? (+svc.rate || 0) * from / all : 0) : +svc.rate || 0;
    if (svc.since && svc.since > last) amount = 0;
  } else if (svc.per === 'day') amount = came * (+svc.rate || 0);
  else amount = qty * (+svc.rate || 0);
  const paid = (payments || []).filter((p) => p.kind === 'service' && p.ref === svc.id && p.period === ym).reduce((a, p) => a + (+p.amount || 0), 0);
  amount = Math.round(amount);
  return { days, came, missed, extra, qty: round2(qty), amount, paid, due: Math.max(0, amount - paid), full: end === last };
}

/** Next state when someone taps a day on the calendar: came → missed → extra (×2) → came. */
export function nextDayState(svc, current) {
  const usual = +svc.qty || 1;
  if (current == null || current === usual) return 0;            // came → missed
  if (current === 0) return usual * 2;                            // missed → double
  return null;                                                    // anything else → back to usual
}

// ---------- Bills & renewals ----------
export const DUE_KINDS = {
  electricity: { label: 'Electricity', emoji: '💡', every: 'm2' },
  water: { label: 'Water', emoji: '🚰', every: 'm2' },
  gas: { label: 'Gas cylinder', emoji: '🔥', every: 'gas' },
  mobile: { label: 'Mobile recharge', emoji: '📱', every: 'd28' },
  dth: { label: 'DTH / cable', emoji: '📺', every: 'm1' },
  internet: { label: 'Internet', emoji: '🌐', every: 'm1' },
  rent: { label: 'Rent', emoji: '🏠', every: 'm1' },
  school: { label: 'School fees', emoji: '🎒', every: 'm3' },
  insurance: { label: 'Insurance', emoji: '🛡️', every: 'm12' },
  emi: { label: 'EMI / loan', emoji: '🏦', every: 'm1' },
  other: { label: 'Other', emoji: '🧾', every: 'm1' },
};
export const EVERY = {
  m1: 'Every month', m2: 'Every 2 months', m3: 'Every 3 months', m6: 'Every 6 months', m12: 'Every year',
  d28: 'Every 28 days', d56: 'Every 56 days', d84: 'Every 84 days', gas: 'When the cylinder runs out', once: 'Only once',
};

/** The due date after `due` for a repeat rule. `day` keeps "the 5th of every month" across short months. */
export function nextDue(due, every, day) {
  const m = /^m(\d+)$/.exec(every || '');
  if (m) return addMonths(due, +m[1], day);
  const d = /^d(\d+)$/.exec(every || '');
  if (d) return addDays(due, +d[1]);
  return null; // once, or gas (worked out from deliveries)
}

/** Days between gas deliveries on average (last 4), or a typical 45 days. */
export function gasGap(history) {
  const h = [...(history || [])].sort();
  if (h.length < 2) return 45;
  const gaps = h.slice(-5).map((x, i, a) => (i ? daysBetween(a[i - 1], x) : null)).filter((g) => g > 5);
  return gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 45;
}
/** When to book the next cylinder: a few days before the usual gap runs out. */
export const gasBookBy = (history, lead = 5) => {
  const last = [...(history || [])].sort().pop();
  return last ? addDays(last, Math.max(1, gasGap(history) - lead)) : null;
};

/** How urgent a bill is: { days, tone: 'over'|'today'|'soon'|'later' }. */
export function dueState(due, today, remind = 3) {
  if (!due) return { days: null, tone: 'later' };
  const days = daysBetween(today, due);
  return { days, tone: days < 0 ? 'over' : days === 0 ? 'today' : days <= Math.max(remind, 0) ? 'soon' : 'later' };
}

/** The date a bill should show: its due date, or for gas, when to book (unless already booked). */
export const dueDateOf = (b) => (b.every === 'gas' ? (b.booked ? null : gasBookBy(b.history) || b.due || null) : b.due);

/** Bills to look at now: overdue or within their reminder window, soonest first. */
export function duesSoon(dues, today) {
  return (dues || [])
    .filter((b) => b.active !== false)
    .map((b) => ({ b, date: dueDateOf(b) }))
    .filter(({ b, date }) => date && dueState(date, today, b.remind ?? 3).tone !== 'later')
    .sort((x, y) => x.date.localeCompare(y.date))
    .map(({ b, date }) => ({ ...b, date, ...dueState(date, today, b.remind ?? 3) }));
}

// ---------- UPI ----------
export const validUpi = (vpa) => /^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(String(vpa || '').trim());

/** A UPI payment link that GPay, PhonePe, Paytm and BHIM open with everything filled in. */
export function upiLink({ vpa, name, amount, note }) {
  if (!validUpi(vpa)) return null;
  const q = new URLSearchParams({ pa: vpa.trim(), pn: String(name || 'Payee').slice(0, 40), cu: 'INR' });
  if (amount > 0) q.set('am', (Math.round(amount * 100) / 100).toFixed(2));
  if (note) q.set('tn', String(note).slice(0, 50));
  // Keep '@' readable: some UPI apps don't decode %40 in the UPI ID.
  return `upi://pay?${q.toString().replace(/\+/g, '%20').replace(/%40/g, '@')}`;
}

// ---------- Grocery orders ----------
const fmt = (qty, unit) => {
  if (qty == null) return '';
  let q = +qty, u = unit || '';
  if (u === 'g' && q >= 1000) { q /= 1000; u = 'kg'; }
  if (u === 'ml' && q >= 1000) { q /= 1000; u = 'L'; }
  return `${+q.toFixed(2)}${u && u !== 'pcs' ? ' ' + u : ''}`;
};
/** The shopping list as a message for the shop. */
export function orderText(items, { home, shop } = {}) {
  const lines = items.map((i, n) => `${n + 1}. ${i.name}${i.qty != null ? ` – ${fmt(i.qty, i.unit)}` : ''}${i.note ? ` (${i.note})` : ''}`);
  return [`${shop ? `Hello ${shop}, ` : 'Hello, '}please send:`, '', ...lines, '', `– ${home || 'Homelu'}${'\n'}(sent from Homelu)`].join('\n');
}
/** A WhatsApp link to one shop's number (10-digit Indian numbers get +91). */
export function whatsappLink(phone, text) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.length === 10) p = '91' + p;
  if (p.length === 11 && p.startsWith('0')) p = '91' + p.slice(1);
  return `https://wa.me/${p.length >= 11 ? p : ''}?text=${encodeURIComponent(text)}`;
}

// ---------- The daily reminder ----------
const rupees = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const when = (days) => (days < 0 ? `${-days} day${days === -1 ? '' : 's'} late` : days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : `due in ${days} days`);

/**
 * The morning digest for a home: { title, body, count } or null when nothing needs doing.
 * Bills in their reminder window, and daily help still unpaid for last month (first week of a month).
 */
export function digest(home, today) {
  const parts = [];
  for (const b of duesSoon(home.dues, today)) {
    parts.push(b.every === 'gas' ? `Book gas cylinder (${when(b.days).replace('due', 'by')})` : `${b.name}${b.amount ? ' ' + rupees(b.amount) : ''} ${when(b.days)}`);
  }
  const day = +today.slice(8, 10);
  if (day <= 7) {
    const last = prevMonth(ymOf(today));
    for (const svc of home.services || []) {
      if (svc.active === false) continue;
      const m = serviceMonth(svc, home.svcLog, home.payments, last, null);
      if (m.due > 0) parts.push(`Pay ${svc.name} ${rupees(m.due)} for ${monthName(last)}`);
    }
  }
  if (!parts.length) return null;
  return { title: parts.length === 1 ? 'Homelu: 1 thing today' : `Homelu: ${parts.length} things today`, body: parts.slice(0, 4).join(' · ') + (parts.length > 4 ? ` · +${parts.length - 4} more` : ''), count: parts.length };
}
