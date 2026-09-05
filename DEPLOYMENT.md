# Deploying "Self Study" — Step-by-Step Guide

Your stack is: a plain HTML/JS frontend, a Node/Express backend, and a MySQL database.
Each needs its own home. Below is the simplest reliable path.

## 0. Before anything else — rotate your OpenRouter key

Your `.env` (with your real OpenRouter key and Gmail app password) was inside the zip you
uploaded to me. That's fine for this conversation, but treat that OpenRouter key as
potentially exposed: generate a new one at https://openrouter.ai/keys and use the new one
going forward. Never commit `.env` to GitHub — it's already excluded via `.gitignore`.

## 1. Push the code to GitHub

```bash
cd web_project_fixed
git init
git add .
git commit -m "Initial commit"
# create a new empty repo on github.com, then:
git remote add origin https://github.com/<you>/self-study.git
git branch -M main
git push -u origin main
```

`backend/.gitignore` already excludes `node_modules/` and `.env`, so your real secrets
won't be pushed.

## 2. Set up a cloud MySQL database

Options, roughly cheapest/easiest to most robust:

- **Railway** (railway.app) — add a "MySQL" plugin to a project. No permanent free tier
  anymore (one-time trial credit, then ~$5/month), but the most beginner-friendly.
- **PandaStack** or **Aiven** — both currently offer a free managed MySQL tier suitable
  for a small student project. Check their current free-tier terms before committing,
  since these change often.
- **A VPS you already have** — install MySQL yourself if you have one.

Whichever you pick:
1. Create the database and note the host, port, username, password, and database name.
2. Recreate your tables there (export your local schema with `mysqldump -u root -p
   --no-data selfstudy > schema.sql`, then import it: `mysql -h <host> -u <user> -p
   <dbname> < schema.sql`). If you also want your existing data, drop `--no-data`.
3. Run `backend/migration_timetable_fix.sql` against this new database — it adds the
   unique keys the fixed timetable code needs.

## 3. Deploy the backend to Render

1. Go to render.com → New → Web Service → connect your GitHub repo.
2. Root directory: `backend`
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables (Render → your service → Environment):
   - `OPENROUTER_API_KEY`
   - `EMAIL_USER`, `EMAIL_PASS`
   - `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` (from step 2)
   - `FRONTEND_URL` — fill this in after step 4, once you know your frontend's URL
6. Deploy. Render gives you a URL like `https://self-study-backend.onrender.com`.

**Important caveat about the cron jobs:** your `node-cron` schedules (day-end
notifications, assignment reminders, weekly/monthly reports) only run while the Node
process is alive. Render's **free** tier spins the service down after ~15 minutes of no
traffic, so those "every minute" checks will silently stop firing until the next request
wakes it back up. Two ways to handle this:
- Upgrade to a paid Render instance (~$7/month) so it never sleeps, or
- Keep it on the free tier and use a free uptime pinger (e.g. cron-job.org) to hit your
  backend's URL every 10 minutes to keep it awake. Not perfectly reliable, but works for
  a student project.

## 4. Deploy the frontend

Any static host works — Netlify, Vercel, or GitHub Pages are all free and simple.

**Netlify (drag-and-drop, easiest):**
1. Go to app.netlify.com → "Add new site" → "Deploy manually"
2. Drag your `frontend` folder in
3. Netlify gives you a URL like `https://self-study-app.netlify.app`

**Before deploying**, open `frontend/config.js` and set:
```js
const PROD_API_URL = "https://self-study-backend.onrender.com"; // your Render URL from step 3
```
Then re-deploy the frontend with that change.

Finally, go back to Render and set `FRONTEND_URL` to your Netlify URL, so CORS only
allows your real site.

## 5. Test it end to end

- Sign up, log in
- Upload a timetable photo, add a day end time, refresh the page, confirm it's still there
- Ask the chatbot a question, then a follow-up — confirm it remembers context
- Try the summarizer and quiz generator

## A couple of things worth knowing (not blockers, just flagging)

- **Two SQL migrations to run now**: `backend/migration_timetable_fix.sql` (timetable upsert
  support) and `backend/migration_features_update.sql` (materials categories + the new quiz
  question bank for spaced repetition). Run both against your `selfstudy` database:
  ```bash
  mysql -u root -p selfstudy < backend/migration_timetable_fix.sql
  mysql -u root -p selfstudy < backend/migration_features_update.sql
  ```
- **New dependency**: the summarizer's PDF/PPTX/DOCX upload feature uses the `officeparser`
  npm package. It's already in `package.json`/`package-lock.json`, so `npm install` picks it
  up automatically — nothing extra to configure. Uploaded files are written briefly to
  `backend/uploads/tmp/` and deleted right after their text is extracted.
- **Passwords are stored in plain text** in the `users` table (`authController.js`
  compares `user.password !== password` directly). Fine for a class project demo, but if
  this ever goes further than that, hash passwords with `bcrypt` before storing/comparing.
- **`routes/chat.js` and `routes/summarizer.js`** are dead code — `server.js` defines its
  own `/api/chat`, `/api/summarize`, `/api/quiz` handlers directly and never uses those
  route files. Harmless to leave, but you can delete them if you want a cleaner repo.
