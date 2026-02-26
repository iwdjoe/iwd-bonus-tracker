# IWD Agency — Project Memory

## Active Focus
Currently building the **Expense Tracker** app in `/public/expense-tracker/`.
Do NOT modify the bonus tracker (`/public/index.html`) unless explicitly asked.

## Project Structure
This is a monorepo with two apps, both served as static sites via Netlify:

- `/public/` — Netlify publish directory (everything here is deployed)
  - `index.html` — **Bonus Tracker Dashboard** (stable, do not touch)
  - `expense-tracker/` — **Expense Tracker Dashboard** (ACTIVE DEVELOPMENT)
- `/functions/` — Netlify serverless functions (Slack cron, API proxy)
- `/bonus-bot/` — Slack bot for bonus notifications
- `/scripts/` — Data-fetching scripts (pulse cache)

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS — no build step, no framework
- **CSS**: Tailwind via CDN + custom stylesheet
- **Charts**: Chart.js via CDN
- **Database**: Supabase (PostgreSQL) with localStorage fallback
- **Hosting**: Netlify (static site, `publish = "public"`)
- **Auth**: Netlify Identity (bonus tracker only); expense tracker auto-signs in as Joe/Admin

## Expense Tracker Architecture
- `db.js` — Database abstraction layer (Supabase + localStorage fallback)
- `app.js` — Main application logic (IIFE pattern, vanilla JS)
- `styles.css` — Custom styles on top of Tailwind
- `index.html` — Single-page app with modals for CRUD
- `supabase-schema.sql` — Database schema (run in Supabase SQL Editor)

## Key URLs
- Live site: https://iwd-bonus-tracker.netlify.app
- Expense tracker: https://iwd-bonus-tracker.netlify.app/expense-tracker/
- GitHub repo: https://github.com/iwdjoe/iwd-bonus-tracker

## Conventions
- No build step — all files are served directly
- Use vanilla JS (no ES6 modules, use IIFEs and `var`)
- Supabase anon key is hardcoded in db.js (public, RLS-protected)
- Dark mode via Tailwind `dark:` classes with `class` strategy
