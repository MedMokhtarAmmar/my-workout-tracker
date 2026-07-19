# Workout Tracker

A personal workout tracking web app, pre-loaded with three programs (Upper/Lower 4-Day, Push Pull Legs, and a Chest+Back/Shoulders+Arms/Legs+Abs split). Runs fully containerized with a real SQLite database (your logs persist between runs).

## Running it locally

Requires Docker + Docker Compose.

```
docker compose up -d --build
```

Then open **http://localhost:3000**. See [Google sign-in and Calendar reminders](#google-sign-in-and-calendar-reminders) below to set up login — the app won't let you in without it.

To stop: `docker compose down` (your data stays in the `workout-data` volume).

## What it does

- **Today tab** — pick a date and a workout (Upper A / Lower A / Upper B / Lower B), and log weight + reps for every set against your plan's target sets/reps. You can add, remove, or replace exercises for that day without changing the underlying program. Also logs cardio minutes after lifting.
- **History tab** — browse past sessions, see what you logged, delete a session if needed.
- **Progress tab** — pick any exercise and see a chart of the weight you've used over time, plus a full table of every logged set.
- **Body Stats tab** — log body weight and waist measurement over time, with a chart.
- **Settings tab** — set what time of day workout reminders go on your Google Calendar, and sign out.

All data is stored locally in `data/app.db` (a SQLite file, persisted in the `workout-data` Docker volume). Back that up if you want to keep your history safe.

## Google sign-in and Calendar reminders

The app is multi-user: anyone signs in (or signs up — same flow) with "Continue with Google" on the login page, and gets their own private workouts, plans, body stats, and settings. That same sign-in also connects Google Calendar: every time a user starts a workout, a calendar event is automatically created for that date at the reminder time set in their Settings tab (default 6:00 PM), with a 30-minute-before popup reminder. Deleting a session removes its calendar event too.

To set this up, you need your own Google OAuth credentials (this app can't create these for you):

1. Go to the [Google Cloud Console](https://console.cloud.google.com/), create a project (or use an existing one).
2. **APIs & Services > Library** — search for "Google Calendar API" and enable it.
3. **APIs & Services > OAuth consent screen** — choose "External", fill in the required fields (app name, your email). **While the app is in "Testing" mode, only Google accounts you've explicitly added under "Test users" can sign in — this is a Google restriction, separate from the app's own logic.** To let *any* Google account sign up, you need to publish the app to "Production" (Google may require verification for sensitive scopes like Calendar access).
4. **APIs & Services > Credentials > Create Credentials > OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/auth/google/callback`
5. Copy the generated **Client ID** and **Client Secret**.
6. Copy `.env.example` to `.env` (already done for you, with a random session secret pre-filled) and fill in:
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from step 5
   - `OWNER_EMAIL` — only used once, to migrate any pre-existing single-user data to your account (see `.env.example`)
7. Restart the container: `docker compose up -d --build`

Then open http://localhost:3000, you'll be redirected to `/login.html`, and "Sign in with Google" will work end to end.

If `.env` is left unfilled, the app still runs — you just can't log in (sign-in will fail) until credentials are added.

## Deploying to your own server

The stack is fully containerized, including HTTPS: `docker-compose.yml` runs two services — the app (`workout-tracker`, not exposed to the internet directly) and [Caddy](https://caddyserver.com) as a reverse proxy, which gets and auto-renews a free Let's Encrypt certificate for your domain and forwards traffic to the app over the internal Docker network.

1. **Point a domain at your server.** Set an A record for your domain (e.g. via DuckDNS or any registrar) to your server's public IP. Confirm it resolves: `nslookup your-domain`.
2. **Open ports 80 and 443** on your server's firewall/cloud security group — Caddy needs both (80 for the ACME challenge and HTTP→HTTPS redirect, 443 for HTTPS).
3. **Edit [Caddyfile](Caddyfile)** — replace the domain on the first line with yours.
4. **Update `.env`** — set `GOOGLE_REDIRECT_URI` to `https://your-domain/auth/google/callback`.
5. **Add that same URI** to your OAuth client's "Authorized redirect URIs" in Google Cloud Console (step 4 above) — you can keep the `localhost` one there too if you still want to test locally.
6. Copy the whole project folder to your server (`git clone`/`scp`/`rsync` — whatever you use), including your filled-in `.env`.
7. On the server: `docker compose up -d --build`.
8. Watch Caddy obtain the certificate: `docker compose logs -f caddy` — look for `"certificate obtained successfully"`. This can take up to a minute and requires your domain to already be resolving to the server (step 1) and ports reachable from the internet (step 2), since Let's Encrypt connects back to your server to verify domain ownership.
9. Visit `https://your-domain`.

Since the app container has no host port mapping (`expose` only, not `ports`), it's unreachable except through Caddy — the only thing exposed to the internet is Caddy on 80/443.

## Notes

- The plan's exercises, sets, and rep ranges are defined in `db/seed.js` if you ever want to tweak the program.
