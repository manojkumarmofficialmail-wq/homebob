// Money layer: daily help, bills, UPI links, grocery orders and the morning reminder.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as $ from '../js/money.js';
import * as M from '../js/model.js';
import { merge3 } from '../js/sync.js';
import remindHandler, { sendReminders, todayIST } from '../api/remind.js';

const home = () => { const s = M.fresh(); s.setup = true; s.me = M.addMember(s, 'Meera').id; return s; };
const milk = { id: 'm', name: 'Raju milk', per: 'unit', qty: 1, unit: 'L', rate: 56, days: 'daily', since: '2026-01-01' };

// ---------- Daily help ----------
test('milk: litres × rate, missed days and extra litres', () => {
  const log = { m: { '2026-11-03': 0, '2026-11-10': 0, '2026-11-12': 2 } };
  const r = $.serviceMonth(milk, log, [], '2026-11', null);
  assert.deepEqual([r.days, r.came, r.missed, r.qty, r.amount, r.full], [30, 28, 2, 29, 1624, true]);
});

test('the current month counts only up to today', () => {
  const r = $.serviceMonth(milk, {}, [], '2026-11', '2026-11-05');
  assert.deepEqual([r.came, r.amount, r.full], [5, 280, false]);
});

test('newspaper per day, Monday to Saturday only', () => {
  const paper = { id: 'p', per: 'day', qty: 1, rate: 8, days: '123456' };
  const r = $.serviceMonth(paper, {}, [], '2026-11', null);
  assert.equal(r.came, 25); // November 2026 has 5 Sundays
  assert.equal(r.amount, 200);
  assert.equal($.scheduled(paper, '2026-11-01'), false, '1 Nov 2026 is a Sunday');
});

test('a monthly salary is the full amount whatever the days, shared out only for a part month', () => {
  const maid = { id: 'x', per: 'month', rate: 4000, days: 'daily', since: '2026-01-01' };
  const log = { x: { '2026-11-03': 0, '2026-11-04': 0 } };
  const r = $.serviceMonth(maid, log, [], '2026-11', null);
  assert.deepEqual([r.missed, r.amount], [2, 4000]);
  assert.equal($.serviceMonth({ ...maid, since: '2026-11-16' }, {}, [], '2026-11', null).amount, 2000);
  assert.equal($.serviceMonth({ ...maid, since: '2026-12-01' }, {}, [], '2026-11', null).amount, 0);
});

test('payments for the month reduce what is due', () => {
  const pays = [{ kind: 'service', ref: 'm', period: '2026-11', amount: 1000 }, { kind: 'service', ref: 'm', period: '2026-10', amount: 9999 }];
  const r = $.serviceMonth(milk, {}, pays, '2026-11', null);
  assert.deepEqual([r.amount, r.paid, r.due], [1680, 1000, 680]);
});

test('tapping a calendar day cycles came → missed → double → usual', () => {
  assert.equal($.nextDayState(milk, null), 0);
  assert.equal($.nextDayState(milk, 0), 2);
  assert.equal($.nextDayState(milk, 2), null);
  assert.equal($.nextDayState(milk, 1), 0, 'a ticked "came" day goes to missed');
});

test('model: new help counts from the 1st, today\'s question, and the month total', () => {
  const s = home();
  const v = M.saveService(s, { kind: 'milk', name: 'Raju milk', upi: 'raju@okaxis' });
  assert.equal(v.since, M.today().slice(0, 8) + '01');
  assert.deepEqual(M.unansweredToday(s).map((x) => x.id), [v.id]);
  M.markService(s, v.id, M.today(), 1);
  assert.deepEqual(M.unansweredToday(s), []);
  M.markService(s, v.id, M.today(), null);
  assert.equal(s.svcLog[v.id], undefined, 'clearing the last note leaves no empty object behind');
  const ym = M.today().slice(0, 7);
  assert.equal(M.monthMoney(s, ym).help, M.serviceMonth(s, v, ym).amount);
});

// ---------- Bills ----------
test('next due dates keep the day of the month and handle short months', () => {
  assert.equal($.nextDue('2026-01-31', 'm1', 31), '2026-02-28');
  assert.equal($.nextDue('2026-02-28', 'm1', 31), '2026-03-31');
  assert.equal($.nextDue('2026-11-07', 'm2'), '2027-01-07');
  assert.equal($.nextDue('2026-11-05', 'd28'), '2026-12-03');
  assert.equal($.nextDue('2026-11-05', 'm12'), '2027-11-05');
  assert.equal($.nextDue('2026-11-05', 'once'), null);
});

test('paying a bill records it and moves it on; paying very late skips past today', () => {
  const s = home();
  const b = M.saveDue(s, { kind: 'electricity', amount: 1240, due: '2026-11-07' });
  assert.equal(b.every, 'm2');
  M.payDue(s, b.id, { date: '2026-11-06' });
  assert.equal(b.due, '2027-01-07');
  assert.equal(s.payments[0].amount, 1240);
  const rent = M.saveDue(s, { kind: 'rent', amount: 15000, due: '2026-08-05' });
  M.payDue(s, rent.id, { date: '2026-11-20', amount: 15000 });
  assert.equal(rent.due, '2026-12-05');
  const once = M.saveDue(s, { kind: 'other', name: 'Car insurance', every: 'once', amount: 9000, due: '2026-11-10' });
  M.payDue(s, once.id, { date: '2026-11-10' });
  assert.equal(once.active, false);
  assert.equal(M.monthMoney(s, '2026-11').bills, 1240 + 15000 + 9000);
});

test('gas: next booking date learnt from the gaps between deliveries', () => {
  assert.equal($.gasGap(['2026-06-01']), 45);
  assert.equal($.gasGap(['2026-06-01', '2026-07-15', '2026-08-28']), 44);
  assert.equal($.gasBookBy(['2026-06-01', '2026-07-15', '2026-08-28']), '2026-10-06');
  const s = home();
  const g = M.saveDue(s, { kind: 'gas', amount: 905 });
  M.gasDelivered(s, g.id, { date: '2026-09-20' });
  assert.equal(g.due, '2026-10-30');
  M.gasBooked(s, g.id, '2026-10-29');
  assert.equal($.dueDateOf(g), null, 'once booked it stops asking');
  M.payDue(s, g.id, { date: '2026-11-02' });
  assert.equal(g.booked, null);
  assert.deepEqual(g.history, ['2026-09-20', '2026-11-02']);
});

test('bills to look at: overdue and within their reminder window, soonest first', () => {
  const dues = [
    { id: 'a', name: 'Later', due: '2026-12-30', every: 'm1', remind: 3 },
    { id: 'b', name: 'Soon', due: '2026-11-07', every: 'm1', remind: 3 },
    { id: 'c', name: 'Late', due: '2026-11-01', every: 'm1', remind: 3 },
    { id: 'd', name: 'Off', due: '2026-11-01', every: 'm1', active: false },
  ];
  assert.deepEqual($.duesSoon(dues, '2026-11-05').map((x) => [x.name, x.tone, x.days]), [['Late', 'over', -4], ['Soon', 'soon', 2]]);
});

// ---------- UPI and orders ----------
test('UPI links have the payee, amount and note, and bad UPI IDs are refused', () => {
  assert.equal($.upiLink({ vpa: 'raju@okaxis', name: 'Raju milk', amount: 1568, note: 'Milk Nov' }),
    'upi://pay?pa=raju@okaxis&pn=Raju%20milk&cu=INR&am=1568.00&tn=Milk%20Nov');
  assert.equal($.validUpi('9847012345@ybl'), true);
  assert.equal($.validUpi('raju'), false);
  assert.equal($.validUpi('raju@'), false);
  assert.equal($.upiLink({ vpa: 'nope', amount: 10 }), null);
});

test('the order message lists items with amounts, and WhatsApp numbers get +91', () => {
  const text = $.orderText([{ name: 'Rice', qty: 5000, unit: 'g' }, { name: 'Eggs', qty: 12, unit: 'pcs' }, { name: 'Coriander', qty: null }], { home: 'Test home', shop: 'Anand Stores' });
  assert.match(text, /^Hello Anand Stores, please send:/);
  assert.match(text, /1\. Rice – 5 kg\n2\. Eggs – 12\n3\. Coriander/);
  assert.match($.whatsappLink('98470 12345', 'hi'), /^https:\/\/wa\.me\/919847012345\?text=hi$/);
  assert.match($.whatsappLink('09847012345', 'hi'), /wa\.me\/919847012345/);
});

// ---------- Sync ----------
test('daily help, bills and payments from two phones merge', () => {
  const base = home();
  const v = M.saveService(base, { kind: 'milk' });
  const a = JSON.parse(JSON.stringify(base)), b = JSON.parse(JSON.stringify(base));
  M.markService(a, v.id, '2026-11-03', 0);
  M.markService(b, v.id, '2026-11-04', 2);
  M.saveDue(a, { kind: 'rent', amount: 15000, due: '2026-12-05' });
  M.recordPayment(b, { kind: 'service', ref: v.id, name: 'Milk', period: '2026-11', amount: 500 });
  const m = merge3(base, a, b);
  assert.deepEqual(m.svcLog[v.id], { '2026-11-03': 0, '2026-11-04': 2 });
  assert.equal(m.dues.length, 1);
  assert.equal(m.payments.length, 1);
});

// ---------- The morning reminder ----------
test('the digest lists bills in their window and last month\'s unpaid help in the first week', () => {
  const h = { dues: [{ id: 'e', name: 'Electricity', amount: 1240, due: '2026-12-03', every: 'm2', remind: 3 }, { id: 'g', name: 'Gas', every: 'gas', history: ['2026-10-20'], booked: null }],
    services: [milk], svcLog: {}, payments: [{ kind: 'service', ref: 'm', period: '2026-11', amount: 680 }] };
  const d = $.digest(h, '2026-12-02');
  assert.equal(d.count, 3);
  assert.match(d.body, /Electricity ₹1,240 due tomorrow/);
  assert.match(d.body, /Book gas cylinder \(\d+ days late\)|Book gas cylinder \(by/);
  assert.match(d.body, /Pay Raju milk ₹1,000 for November/);
  assert.equal($.digest({ dues: [], services: [milk], svcLog: {}, payments: [] }, '2026-12-15'), null, 'help is only nagged about in the first week');
});

test('todayIST is the date in India', () => {
  assert.equal(todayIST(Date.UTC(2026, 10, 5, 20, 0)), '2026-11-06'); // 1:30 am IST
  assert.equal(todayIST(Date.UTC(2026, 10, 5, 10, 0)), '2026-11-05');
});

function fakeSupabase(state) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push([opts.method || 'GET', url]);
    const u = new URL(url);
    let body = [];
    if (u.pathname.endsWith('/push_subscriptions') && (opts.method || 'GET') === 'GET') body = state.subs;
    if (u.pathname.endsWith('/push_subscriptions') && opts.method === 'DELETE') { state.subs = state.subs.filter((x) => `eq.${x.endpoint}` !== u.searchParams.get('endpoint')); body = null; }
    if (u.pathname.endsWith('/households')) body = state.homes;
    return new Response(body == null ? '' : JSON.stringify(body), { status: 200 });
  };
  return calls;
}

test('reminders go to every subscribed phone of homes with something due; gone phones are removed', async () => {
  const realFetch = globalThis.fetch;
  const state = {
    subs: [
      { endpoint: 'https://push/1', p256dh: 'k', auth: 'a', household_id: 'h1' },
      { endpoint: 'https://push/2', p256dh: 'k', auth: 'a', household_id: 'h1' },
      { endpoint: 'https://push/3', p256dh: 'k', auth: 'a', household_id: 'h2' },
    ],
    homes: [
      { id: 'h1', data: { dues: [{ id: 'e', name: 'Rent', amount: 15000, due: '2026-11-05', every: 'm1', remind: 3 }] } },
      { id: 'h2', data: { dues: [] } },
    ],
  };
  fakeSupabase(state);
  const sent = [];
  try {
    const out = await sendReminders({
      url: 'https://x.supabase.co', key: 'sb_secret_test', today: '2026-11-05',
      send: async (sub, payload) => {
        if (sub.endpoint === 'https://push/2') throw Object.assign(new Error('gone'), { statusCode: 410 });
        sent.push([sub.endpoint, JSON.parse(payload)]);
      },
    });
    assert.deepEqual(out, { homes: 1, sent: 1, removed: 1, failed: 0 });
    assert.equal(sent[0][0], 'https://push/1');
    assert.match(sent[0][1].body, /Rent ₹15,000 due today/);
    assert.equal(sent[0][1].url, '/?do=today');
    assert.deepEqual(state.subs.map((x) => x.endpoint), ['https://push/1', 'https://push/3']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the reminder endpoint needs the cron secret', async () => {
  const res = () => { const r = { headers: {}, setHeader() {}, status(c) { r.code = c; return r; }, json(o) { r.body = o; return r; } }; return r; };
  const old = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    let r = res(); await remindHandler({ headers: {} }, r); assert.equal(r.code, 503);
    process.env.CRON_SECRET = 'shh';
    r = res(); await remindHandler({ headers: { authorization: 'Bearer wrong' } }, r); assert.equal(r.code, 401);
    r = res(); await remindHandler({ headers: {} }, r); assert.equal(r.code, 401);
  } finally {
    if (old === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = old;
  }
});
