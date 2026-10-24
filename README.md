# Homzy

Meal plans, one shared shopping list, chores, weekly family nutrition and food spend (groceries and food from outside) for Indian homes. It's an installable PWA with no build step.

- **Household data** (lists, meals, bills, outside food) is kept on the phone, in `localStorage`, and works offline.
- **Family sync** (optional): the owner signs in with an email code and puts the home online. Family join with a private invite link, as **Can edit** or **View only**. Phones sync through Supabase every ~15 seconds while open, and merge changes made at the same time.
- **Feedback** goes to `/api/feedback`, a Vercel function that saves it in Supabase.

## Project layout

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `js/` | The app (plain ES modules) |
| `js/nutrition.js` | Nutrition table (IFCT 2017 values), meal and weekly maths, outside-food estimates |
| `js/feedback.js` | Feedback client with an offline outbox |
| `js/cloud.js` | Email-code sign-in and database calls (plain fetch to Supabase, no library) |
| `js/sync.js` | Family sync: uploads changes, pulls others' changes, three-way merge |
| `api/feedback.js` | Vercel serverless function: validates, rate-limits, inserts into Supabase |
| `api/config.js` | Gives the app the Supabase URL and publishable key (refuses secret keys) |
| `supabase/schema.sql` | Feedback table, plus households, members, invites and their access rules |
| `vercel.json` | Security headers (CSP etc.) and cache rules |
| `tests/` | `node --test` unit tests and a local server that behaves like Vercel |

## Run locally

```bash
npm test                       # unit tests
MOCK_SUPABASE=1 npm start      # http://localhost:5173 with a fake Supabase in memory
```

On Windows PowerShell: `$env:MOCK_SUPABASE=1; npm start`.

With the mock, the sign-in code is always `123456`. To try two phones, open `http://localhost:5173` and `http://127.0.0.1:5173`: they are separate origins, so each has its own data.

## Deploy to production

### 1. Supabase (feedback database)

1. Create a project at <https://supabase.com> (pick the Mumbai region for India).
2. Open **SQL Editor → New query**, paste `supabase/schema.sql` and click **Run**.
3. In **Project Settings → API Keys**, copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **publishable key** (`sb_publishable_…`, or the legacy `anon` key). It is safe in the browser.
   - a **secret key** (`sb_secret_…`). A legacy `service_role` key also works.

   Keep the secret key private. It belongs only in Vercel's environment variables, never in the app's code.

### 1b. Supabase sign-in (for family sync)

1. **Authentication → Sign In / Providers → Email**: keep Email turned on. "Confirm email" can stay on.
2. **Authentication → Emails → Templates**: in both **Magic Link** and **Confirm signup**, add the code to the message, for example `<h2>Your Homzy code: {{ .Token }}</h2>`. Without this, people get only a link, which on phones often opens in the browser and not in the installed app.
3. **Authentication → URL Configuration**: set **Site URL** to your Vercel address (e.g. `https://homzy.vercel.app`) and add the same address under **Redirect URLs**.
4. **Authentication → Emails → SMTP Settings**: turn on custom SMTP (for example Resend, Brevo or Amazon SES). **This is required for real families.** Supabase's built-in email only delivers to your own project team's addresses and is limited to a few emails an hour.

### 2. Vercel (hosting + API)

1. Push this repo to GitHub, then in Vercel choose **Add New → Project** and import it.
   - Framework preset: **Other**. Leave the build command and output directory empty.
2. In **Settings → Environment Variables**, add these for Production and Preview:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_SECRET_KEY` = your secret key
   - `SUPABASE_PUBLISHABLE_KEY` = your publishable key (turns on family sync)
   - `ALLOWED_ORIGINS` (optional) = e.g. `https://homzy.in` if you add a custom domain
3. Deploy. To check it worked:
   - **Feedback:** open the app, go to **Family → Send feedback**, send a message, and look in Supabase **Table Editor → feedback**.
   - **Family sync:** go to **Family → Turn on family sync**, sign in with the emailed code, tap **Invite family**, and open the link on another phone.

Using the CLI instead: `npm i -g vercel`, then `vercel` for a preview and `vercel --prod` for production.

### 3. Shipping an update

Bump `VERSION` in `sw.js` (and `APP_VERSION` in `js/feedback.js`) on every release, so installed phones pick up the new files.

## Reading feedback

- **Table Editor → feedback**: every message. Use the `status` column (`new`, `read`, `planned`, `done`, `ignored`) to triage.
- **Table Editor → feedback_weekly**: messages per week, average rating, problems vs ideas, and how many households wrote in.

## How family sync works

- **Roles:** the owner (who put the home online) invites people as **Can edit** or **View only** and can change or remove them under **Family → Who can see this home**. View-only people see everything but every edit button is hidden, and the database refuses their writes anyway.
- **Invites** are 8-character codes, single use, valid for 7 days, and tied to one family member's name.
- **One account, one home.** Leaving or being removed deletes the home from that phone. Signing out does too (it stays online for everyone else).
- **Same-time edits:** each save carries a revision number. If another phone saved first, this phone merges item by item (two people adding to the list both win; a delete beats an edit; if both changed the same field, the later save wins) and saves again.
- **What stays on the phone:** who is using this phone and the voice language. Everything else is shared.
- **Tables:** `households` (one JSON document per home), `household_members` (who has which role), `household_invites`. All writes besides saving the home go through the functions in `schema.sql`, which check the caller's role.

## How nutrition is worked out

- Each recipe's ingredients are scaled to the number of people and converted to grams (pieces and packets use typical weights). They are then matched to a per-100 g table based on the Indian Food Composition Tables (ICMR-NIN, 2017).
- When a recipe lists no oil or ghee, 10 ml of cooking oil per person is added.
- Food from outside uses rough per-person averages (Light 450, Regular 750, Heavy 1,100 kcal; a snack is 45% of that). It replaces the home meal planned for the same slot.
- The guide bars compare totals with what those same meals should give an adult (ICMR-NIN 2020: 2,000 kcal, 55 g protein, 30 g fibre a day), split as breakfast 25%, lunch 35%, dinner 30% and snacks 10%.
- Only days up to today count. These numbers are estimates, not medical advice.

## Security notes

- **Feedback:** the browser never talks to the feedback table. It has RLS turned on and no public policies, so the public key can't read or write it.
- **Family sync:** the browser uses the publishable key plus the signed-in person's token. Row-level security only shows a home to its members, and only owners and editors can change it. `/api/config` refuses to hand out a secret key, even if one is set by mistake.
- The API accepts only same-origin JSON POSTs of 8 KB or less. Text is trimmed and length-checked, there's a honeypot field, and each IP is rate-limited per warm instance. For heavier traffic, add Vercel's firewall rate limiting.
- The CSP allows only the app itself, Supabase (`*.supabase.co`), the bill reader (jsDelivr, tessdata) and Google Fonts.
