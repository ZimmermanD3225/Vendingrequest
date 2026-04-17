# Vending Request

A minimalist web app for vending machine operators. Each machine gets a **QR code sticker**. Customers scan, type the product they want + their phone number, hit submit. Operators see requests in a clean dashboard.

```
  ┌─────────────┐   scan    ┌────────────────┐   submit    ┌─────────────────┐
  │ QR on machine│ ────────▶ │ 2-field form   │ ──────────▶ │ Operator        │
  │  (per machine│           │ product + phone│             │ dashboard       │
  │   unique URL)│           └────────────────┘             │ (user + pass)   │
  └─────────────┘                                           └─────────────────┘
```

**Customer flow:** scan → type product → type phone → submit. Two fields, one tap.

**Operator flow:** sign up → add machine → print QR poster → watch requests land on your dashboard with a clickable tel: link for every number.

## Stack

- Node 20 + Express
- **Postgres** (managed, any provider — Render, Railway, Fly, Neon, Supabase)
- EJS server-side templates, plain CSS, no build step
- `express-session` with Postgres-backed session store (`connect-pg-simple`)
- `qrcode` for server-side QR PNG generation
- `helmet`, `express-rate-limit`, `bcryptjs`

## Run locally

### Option A: with Docker (recommended)

```bash
git clone https://github.com/zimmermand3225/vendingrequest.git
cd vendingrequest
git checkout claude/operator-request-form-qr-acT6x
cp .env.example .env
docker compose up -d        # starts Postgres on :5432
npm install
npm start
```

Open http://localhost:4000.

### Option B: with a hosted Postgres (no Docker)

1. Create a free Postgres at [Neon](https://neon.tech) or [Supabase](https://supabase.com).
2. Copy the connection string.
3. `cp .env.example .env` and paste it into `DATABASE_URL`.
4. `npm install && npm start`.

### Test from your phone (LAN)

Phones can't reach `localhost` — point `BASE_URL` at your Mac's LAN IP:

```bash
ipconfig getifaddr en0                     # e.g. 192.168.4.41
PORT=4000 BASE_URL=http://192.168.4.41:4000 npm start
```

Open the machine page, scan the QR from your phone (same wifi).

## Environment variables

| Variable         | Purpose                                                                | Required |
|------------------|------------------------------------------------------------------------|:--------:|
| `DATABASE_URL`   | Postgres connection string                                             | ✅       |
| `SESSION_SECRET` | 32+ random chars used to sign session cookies                          | ✅ (prod)|
| `BASE_URL`       | Public URL of the app — what QR codes and verify emails link to        | ✅       |
| `PORT`           | HTTP listen port                                                       | default 4000 |
| `NODE_ENV`       | `production` enables secure cookies + TLS for pg + hides stack traces   | default development |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key for sending verification emails. **If blank, the app logs the verify link to the server console** — handy for local dev. | ❌ |
| `EMAIL_FROM`     | `From` header on outbound mail. On the Resend free tier, keep the default (`Vending Request <onboarding@resend.dev>`) until you verify a domain. | default set |

## Email verification

New signups must click a link in a verification email before they can log
in. In development, if `RESEND_API_KEY` is not set, the link is printed
to the terminal where `npm start` is running — just copy/paste into a
browser to verify.

In production, set `RESEND_API_KEY`. On the free tier you can only send
to the address your Resend account was registered with, which is fine
for smoke tests. For real users, verify your sending domain in Resend
(~10 min of DNS records) and update `EMAIL_FROM`.

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Deploy

### Render (one-click blueprint)

A `render.yaml` lives in this repo, so you can deploy the app **and** a managed Postgres in one step.

1. Push the repo to your GitHub.
2. Go to **Render → New → Blueprint** and point it at the repo.
3. Render creates two resources:
   - `vending-request` web service (free plan)
   - `vending-request-db` Postgres instance (free plan)
4. After the first deploy, set the `BASE_URL` env var on the web service to your `https://<service>.onrender.com` URL and redeploy.
5. Done — open the Render URL, sign up, create a machine.

### Railway

1. **New Project → Deploy from GitHub** → select this repo.
2. **Add Plugin → PostgreSQL**. Railway auto-injects `DATABASE_URL`.
3. Set env vars on the web service: `SESSION_SECRET`, `BASE_URL=https://<your-app>.up.railway.app`, `NODE_ENV=production`.

### Fly.io

```bash
fly launch                           # accept defaults, do NOT add Fly's Postgres here
fly postgres create --name vending-db   # provision managed pg
fly postgres attach vending-db       # sets DATABASE_URL on the app
fly secrets set \
  SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  BASE_URL=https://<your-app>.fly.dev \
  NODE_ENV=production
fly deploy
```

### Any VPS (systemd + external Postgres)

```bash
git clone <this-repo> /opt/vending-request
cd /opt/vending-request
npm install --production
cp .env.example .env
# edit .env: DATABASE_URL, SESSION_SECRET, BASE_URL=https://yourdomain, NODE_ENV=production
```

`/etc/systemd/system/vending-request.service`:

```ini
[Unit]
Description=Vending Request
After=network.target

[Service]
WorkingDirectory=/opt/vending-request
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data
EnvironmentFile=/opt/vending-request/.env

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now vending-request
```

Put nginx or Caddy in front for TLS.

## End-to-end flow

1. **Operator** visits `/`, signs up.
2. **Dashboard** → + New machine → names it "Lobby Vending".
3. Machine detail page shows a QR, the public URL, a print poster button, and a download PNG button.
4. Operator prints the poster, tapes it to the machine.
5. **Customer** scans the QR → sees a clean 2-field form (product + phone) → submits → sees a thank-you page.
6. **Operator** refreshes the dashboard — the request appears as a card under the matching machine, with a tap-to-call link on the customer's phone number. Mark **Addressed** or **Dismiss** with one click.

## Project layout

```
server.js                 # Express app wiring, async boot, /healthz
db.js                     # pg pool + schema init + query helpers
lib/tokens.js             # crypto-random public + CSRF tokens
lib/qr.js                 # QR PNG buffer (cached per URL)
middleware/requireAuth.js # Redirect unauth'd users to /login
middleware/csrf.js        # Issue + verify CSRF tokens
routes/auth.js            # /signup, /login, /logout
routes/dashboard.js       # /dashboard, /machines/*, /requests/:id/status
routes/public.js          # /r/:token customer form (2 fields)
views/                    # EJS templates (minimalist)
public/                   # styles.css, app.js, favicon
docker-compose.yml        # Local Postgres for dev
render.yaml               # One-click Render blueprint
```

## Security

- Passwords hashed with bcrypt (cost 12).
- Sessions stored server-side in Postgres (`user_sessions` table), `httpOnly` + `sameSite=lax`, `secure` in production.
- CSRF tokens on every POST (session-bound).
- Public `POST /r/:token` is exempt from CSRF (anonymous users have no session), rate-limited to 5/min/IP, and includes a honeypot field for bots.
- Every operator-scoped query uses `WHERE operator_id = $N` — no IDOR possible.
- Strict Content Security Policy (`default-src 'self'`, no inline scripts, no inline styles).
- Machine public tokens are 128-bit random hex.

## Health check

`GET /healthz` returns `{"ok": true}` after verifying Postgres connectivity. Wire your uptime monitor / platform health check to this path.

## License

MIT.
