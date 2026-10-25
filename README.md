# Homzy

Meal plans, one shared shopping list, chores, weekly family nutrition and food spend (groceries and food from outside) for Indian homes. It's an installable PWA with no build step.

- **Household data** (lists, meals, bills, outside food) is kept on the phone, in `localStorage`, and works offline.
- **Family sync** (optional, no email or password): on the Family tab, the owner taps **Connect** next to a family member and a QR code appears. That person scans it with their phone camera and their phone joins the home as **Can edit** or **View only**. Phones sync through Supabase every ~15 seconds while open, and merge changes made at the same time.
- **Feedback** goes to `/api/feedback`, a Vercel function that saves it in Supabase.

## Project layout

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `js/` | The app (plain ES modules) |
| `js/nutrition.js` | Nutrition table (IFCT 2017 values), meal and weekly maths, outside-food estimates |
| `js/feedback.js` | Feedback client with an offline outbox |
| `js/cloud.js` | A private anonymous account per phone, and database calls (plain fetch to Supabase, no library) |
| `js/vendor/qrcode.js` | QR code drawing ([qrcode-generator](https://www.npmjs.com/package/qrcode-generator) 1.4.4, MIT) |
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

To try two phones with the mock, open `http://localhost:5173` and `http://127.0.0.1:5173`: they are separate origins, so each has its own data.

## Deploy to production

### 1. Supabase (feedback database)

1. Create a project at <https://supabase.com> (pick the Mumbai region for India).
2. Open **SQL Editor → New query**, paste `supabase/schema.sql` and click **Run**.
3. In **Project Settings → API Keys**, copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **publishable key** (`sb_publishable_…`, or the legacy `anon` key). It is safe in the browser.
   - a **secret key** (`sb_secret_…`). A legacy `service_role` key also works.

   Keep the secret key private. It belongs only in Vercel's environment variables, never in the app's code.

### 1b. Supabase setting for family sync

**Authentication → Sign In / Providers**: turn on **Allow anonymous sign-ins**. Each phone then gets its own private account automatically. Nobody types an email or password; scanning the QR code is what gives a phone access.

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
   - **Family sync:** add a family member on the Family tab, tap **Connect** next to their name, and scan the QR code with another phone's camera.

Using the CLI instead: `npm i -g vercel`, then `vercel` for a preview and `vercel --prod` for production.

### 3. Shipping an update

Bump `VERSION` in `sw.js` (and `APP_VERSION` in `js/feedback.js`) on every release, so installed phones pick up the new files.

## Reading feedback

- **Table Editor → feedback**: every message. Use the `status` column (`new`, `read`, `planned`, `done`, `ignored`) to triage.
- **Table Editor → feedback_weekly**: messages per week, average rating, problems vs ideas, and how many households wrote in.

## How family sync works

- **Roles:** the owner (the first phone to share the home) connects each person as **Can edit** or **View only**. Tapping **Connected** next to their name changes the role or disconnects their phone. View-only people see everything but every edit button is hidden, and the database refuses their writes anyway.
- **QR codes** carry a link with an 8-character code. Each works once, for 7 days, and is tied to one family member, so their phone knows who they are. Without a camera app, they can type the code in Homzy ("I have a QR code").
- **Phone accounts** are anonymous Supabase accounts kept on the phone. If a phone is reset or Homzy's data is cleared, make that person a new QR code. **The owner's phone holds the owner account**, so keep a backup (Family → Download a backup); a lost owner phone can't manage the others.
- **One phone, one home.** Disconnecting or being disconnected removes the home from that phone. It stays online for everyone else.
- **Same-time edits:** each save carries a revision number. If another phone saved first, this phone merges item by item (two people adding to the list both win; a delete beats an edit; if both changed the same field, the later save wins) and saves again.
- **Deleting:** every list item, task, planned meal, bill and outside-food entry has a bin button (and list rows can be swiped left), with an Undo toast. No tombstones are needed: each phone keeps the last copy it agreed with the server, so the three-way merge sees "was there, now gone" as a delete and keeps it deleted even if another phone edited it at the same time (`tests/sync-delete.test.js` runs the real sync loop for two phones).
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
- **Family sync:** the browser uses the publishable key plus the phone's own account token. Row-level security only shows a home to its members, and only owners and editors can change it. `/api/config` refuses to hand out a secret key, even if one is set by mistake.
- The API accepts only same-origin JSON POSTs of 8 KB or less. Text is trimmed and length-checked, there's a honeypot field, and each IP is rate-limited per warm instance. For heavier traffic, add Vercel's firewall rate limiting.
- The CSP allows only the app itself, Supabase (`*.supabase.co`), the bill reader (jsDelivr, tessdata) and Google Fonts.
