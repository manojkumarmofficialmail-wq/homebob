// POST /api/understand — the AI helper, used only when Homzy's own parser isn't sure.
// Two jobs:
//   { task: 'speech', text, lang }  → { kind: 'items'|'dish'|'stock', name, items: [{ name, qty, unit }] }
//   { task: 'nutrition', names }    → { foods: [{ name, v: [kcal, protein, carbs, fat, fibre, gPiece, gPacket] }] }
// Calls Google Gemini (free tier). Only the sentence or the ingredient names are sent: never
// names of people, lists, bills or anything else from the home.
//
// Env vars:
//   GEMINI_API_KEY   free key from https://aistudio.google.com/apikey
//   GEMINI_MODEL     optional, defaults to gemini-flash-latest
import { text, rateLimiter, readPost } from './_lib.js';

const MAX_BODY = 4_000;
const limited = rateLimiter({ windowMs: 10 * 60_000, max: 30 }); // per IP, per warm instance
const UNITS = ['kg', 'g', 'L', 'ml', 'pcs', 'pkt', 'dozen', 'bottle'];
const LANGS = { 'en-IN': 'English', 'ml-IN': 'Malayalam', 'hi-IN': 'Hindi', 'ta-IN': 'Tamil' };

const SPEECH_PROMPT = `You turn what an Indian family said to their kitchen app into JSON.
Decide the kind:
- "dish": they describe a dish they cooked or want to save (a name and maybe its ingredients).
- "stock": they tell what is now in the kitchen / pantry / what they bought.
- "items": things to buy (a shopping list). This is the default.
Return English item names as sold in Indian shops (e.g. "Toor dal", "Coconut oil", "Curd").
qty is a number or null. unit is one of ${UNITS.join(', ')} or null. For a dish, quantities are for 4 people.
Never invent items that were not said. Keep the dish name short and in Title Case.`;

const NUTRITION_PROMPT = `For each Indian kitchen ingredient, give typical nutrition per 100 g of the edible
raw ingredient as bought (Indian Food Composition Tables if known, else USDA): kcal, protein, carbs, fat and
fibre in grams. Also give grams for one piece (g_piece) when it is usually counted in pieces, and grams in a
common packet (g_packet) when it is usually sold in packets; otherwise 0. If something is not food, use all zeros.`;

const SPEECH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['items', 'dish', 'stock'] },
    name: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, qty: { type: 'NUMBER', nullable: true }, unit: { type: 'STRING', nullable: true } },
        required: ['name'],
      },
    },
  },
  required: ['kind', 'items'],
};

const NUTRITION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    foods: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' }, kcal: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, carbs: { type: 'NUMBER' },
          fat: { type: 'NUMBER' }, fibre: { type: 'NUMBER' }, g_piece: { type: 'NUMBER' }, g_packet: { type: 'NUMBER' },
        },
        required: ['name', 'kcal', 'protein', 'carbs', 'fat', 'fibre'],
      },
    },
  },
  required: ['foods'],
};

/** Returns { task, prompt, schema, input } or { error }. Exported for tests. */
export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid body' };
  if (body.task === 'speech') {
    const said = text(body.text, 500);
    if (!said) return { error: 'Nothing to understand' };
    const lang = LANGS[body.lang] || 'English';
    return { task: 'speech', prompt: SPEECH_PROMPT, schema: SPEECH_SCHEMA, input: `Language spoken: ${lang}.\nThey said: "${said}"` };
  }
  if (body.task === 'nutrition') {
    const names = Array.isArray(body.names) ? [...new Set(body.names.map((n) => text(n, 40)).filter(Boolean))].slice(0, 12) : [];
    if (!names.length) return { error: 'No ingredients' };
    return { task: 'nutrition', prompt: NUTRITION_PROMPT, schema: NUTRITION_SCHEMA, input: `Ingredients:\n${names.map((n) => `- ${n}`).join('\n')}` };
  }
  return { error: 'Unknown task' };
}

const num = (x, max) => (Number.isFinite(+x) && +x >= 0 && +x <= max ? Math.round(+x * 10) / 10 : null);

/** Make Gemini's answer safe to hand to the app. Exported for tests. */
export function clean(task, out) {
  if (!out || typeof out !== 'object') return null;
  if (task === 'speech') {
    const kind = ['items', 'dish', 'stock'].includes(out.kind) ? out.kind : 'items';
    const items = (Array.isArray(out.items) ? out.items : []).slice(0, 30).map((x) => ({
      name: text(x?.name, 40),
      qty: x?.qty == null ? null : num(x.qty, 100000),
      unit: UNITS.find((u) => u.toLowerCase() === String(x?.unit || '').toLowerCase()) || null,
    })).filter((x) => x.name);
    return { kind, name: kind === 'dish' ? text(out.name, 60) : null, items };
  }
  const foods = (Array.isArray(out.foods) ? out.foods : []).slice(0, 12).map((f) => {
    const v = [num(f?.kcal, 900), num(f?.protein, 100), num(f?.carbs, 100), num(f?.fat, 100), num(f?.fibre, 100)];
    if (v.some((x) => x == null) || v[0] === 0) return null; // unknown or not food
    const piece = num(f?.g_piece, 5000), packet = num(f?.g_packet, 10000);
    if (piece || packet) v.push(piece || null);
    if (packet) v.push(packet);
    return { name: text(f?.name, 40), v };
  }).filter((f) => f && f.name);
  return { foods };
}

export default async function handler(req, res) {
  const body = readPost(req, res, { maxBytes: MAX_BODY, limited });
  if (!body) return;
  const job = validate(body);
  if (job.error) return res.status(400).json({ error: job.error });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'The AI helper is not set up' });
  const model = (process.env.GEMINI_MODEL || 'gemini-flash-latest').replace(/[^a-z0-9.\-]/gi, '');
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: job.prompt }] },
        contents: [{ role: 'user', parts: [{ text: job.input }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: job.schema, maxOutputTokens: 1500 },
      }),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) {
      console.error('understand: Gemini failed', r.status, (await r.text()).slice(0, 300));
      return res.status(r.status === 429 ? 429 : 502).json({ error: r.status === 429 ? 'The AI helper is busy. Try again in a minute.' : 'The AI helper failed' });
    }
    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* handled below */ }
    const out = clean(job.task, parsed);
    if (!out) return res.status(502).json({ error: 'The AI helper gave no answer' });
    return res.status(200).json(out);
  } catch (err) {
    console.error('understand: Gemini unreachable', err?.message);
    return res.status(502).json({ error: 'The AI helper is not reachable' });
  }
}
