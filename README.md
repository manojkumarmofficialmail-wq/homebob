# Homzy

Meal plans, one shared shopping list, chores, weekly family nutrition and food spend (groceries and food from outside) for Indian homes. It's an installable PWA with no build step.

- **Household data** (lists, meals, bills, outside food) stays on the phone, in `localStorage`.
- **Feedback** is the only thing uploaded. It goes to `/api/feedback`, a Vercel function that saves it in Supabase.

## Project layout

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `js/` | The app (plain ES modules) |
| `js/nutrition.js` | Nutrition table (IFCT 2017 values), meal and weekly maths, outside-food estimates |
| `js/feedback.js` | Feedback client with an offline outbox |
| `api/feedback.js` | Vercel serverless function: validates, rate-limits, inserts into Supabase |
| `supabase/schema.sql` | The `feedback` table, RLS lock-down and a weekly summary view |
| `vercel.json` | Security headers (CSP etc.) and cache rules |
| `tests/` | `node --test` unit tests and a local server that behaves like Vercel |

## Run locally

```bash
npm test                       # unit tests
MOCK_SUPABASE=1 npm start      # http://localhost:5173 (feedback rows print in the terminal)
```

On Windows PowerShell: `$env:MOCK_SUPABASE=1; npm start`.

## Deploy to production

### 1. Supabase (feedback database)

1. Create a project at <https://supabase.com> (pick the Mumbai region for India).
2. Open **SQL Editor → New query**, paste `supabase/schema.sql` and click **Run**.
3. In **Project Settings → API Keys**, copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - a **secret key** (`sb_secret_…`). A legacy `service_role` key also works.

   Keep the secret key private. It belongs only in Vercel's environment variables, never in the app's code.

### 2. Vercel (hosting + API)

1. Push this repo to GitHub, then in Vercel choose **Add New → Project** and import it.
   - Framework preset: **Other**. Leave the build command and output directory empty.
2. In **Settings → Environment Variables**, add these for Production and Preview:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_SECRET_KEY` = your secret key
   - `ALLOWED_ORIGINS` (optional) = e.g. `https://homzy.in` if you add a custom domain
3. Deploy. To check it worked, open the app, go to **Family → Send feedback**, send a message, and look in Supabase **Table Editor → feedback**.

Using the CLI instead: `npm i -g vercel`, then `vercel` for a preview and `vercel --prod` for production.

### 3. Shipping an update

Bump `VERSION` in `sw.js` (and `APP_VERSION` in `js/feedback.js`) on every release, so installed phones pick up the new files.

## Reading feedback

- **Table Editor → feedback**: every message. Use the `status` column (`new`, `read`, `planned`, `done`, `ignored`) to triage.
- **Table Editor → feedback_weekly**: messages per week, average rating, problems vs ideas, and how many households wrote in.

## How nutrition is worked out

- Each recipe's ingredients are scaled to the number of people and converted to grams (pieces and packets use typical weights). They are then matched to a per-100 g table based on the Indian Food Composition Tables (ICMR-NIN, 2017).
- When a recipe lists no oil or ghee, 10 ml of cooking oil per person is added.
- Food from outside uses rough per-person averages (Light 450, Regular 750, Heavy 1,100 kcal; a snack is 45% of that). It replaces the home meal planned for the same slot.
- The guide bars compare totals with what those same meals should give an adult (ICMR-NIN 2020: 2,000 kcal, 55 g protein, 30 g fibre a day), split as breakfast 25%, lunch 35%, dinner 30% and snacks 10%.
- Only days up to today count. These numbers are estimates, not medical advice.

## Security notes

- The browser never talks to Supabase directly. The table has RLS turned on and no public policies, so the public anon key can't read or write it.
- The API accepts only same-origin JSON POSTs of 8 KB or less. Text is trimmed and length-checked, there's a honeypot field, and each IP is rate-limited per warm instance. For heavier traffic, add Vercel's firewall rate limiting.
- The CSP allows only the app itself plus the bill reader (jsDelivr, tessdata) and Google Fonts.
