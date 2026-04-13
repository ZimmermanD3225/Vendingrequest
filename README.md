# Vending Request

A self-hosted web app for vending machine operators. Stick a **QR code** on each machine — customers scan it on their phone and submit a "please stock X" request. Operators log in to see every request tied to each machine, so they can react to actual demand instead of handwritten notes (or threats about Cheetos).

```
 ┌──────────────┐    scan     ┌───────────────┐   submit    ┌──────────────────┐
 │ QR on machine│ ──────────▶ │ Public request│ ──────────▶ │ Operator dashboard│
 │  (per-machine│             │ form (no auth)│             │ (username + pass) │
 │   unique URL)│             └───────────────┘             └──────────────────┘
 └──────────────┘
```

## What it does

- **Operator accounts**: sign up with username + password (bcrypt, session cookies).
- **Machines**: an operator can create multiple machines. Each one gets its own unguessable URL and a printable QR code poster.
- **Public request form**: customers scan the QR, see a mobile-friendly form (product name, category, optional notes + contact), and submit. No login required.
- **Dashboard**: operator sees new/addressed/dismissed requests per machine, with one-click status changes.
- **Secure by default**: CSRF tokens on every POST, strict Content Security Policy, helmet headers, per-IP rate limit on submissions, honeypot field, operator-scoped queries (no IDOR).

## Tech stack

- Node.js 20 + Express 4
- `better-sqlite3` (single-file database, no server)
- EJS server-side templates, plain CSS (no build step)
- `express-session` with SQLite-backed session store
- `qrcode` for server-side QR PNG generation
- `helmet`, `express-rate-limit`, `bcryptjs`

## Project layout

```
server.js                 # Express app wiring
db.js                     # SQLite schema + prepared statements
lib/tokens.js             # Random public + CSRF tokens
lib/qr.js                 # QR PNG buffer (cached)
middleware/requireAuth.js # Redirect unauth'd users to /login
middleware/csrf.js        # Issue + verify CSRF tokens
routes/auth.js            # /signup, /login, /logout
routes/dashboard.js       # /dashboard, /machines/*, /requests/:id/status
routes/public.js          # /r/:token (customer-facing form)
views/                    # EJS templates
public/                   # styles.css, favicon, print.js
data/                     # SQLite files (gitignored, created at boot)
```

## Run locally

```bash
git clone <this-repo>
cd Vendingrequest
cp .env.example .env
# edit .env if you want — defaults are fine for local dev
npm install
npm start
```

Open http://localhost:3000 → sign up → create a machine → open the public URL in another browser window and submit a test request → watch it appear on your dashboard.

### Environment variables

| Variable         | Purpose                                                         | Default                  |
|------------------|-----------------------------------------------------------------|--------------------------|
| `PORT`           | HTTP listen port                                                | `3000`                   |
| `SESSION_SECRET` | 32+ random chars used to sign session cookies                   | dev fallback (insecure)  |
| `BASE_URL`       | Public URL of the app — this is what QR codes encode            | `http://localhost:3000`  |
| `NODE_ENV`       | `production` enables secure cookies + hides stack traces        | `development`            |

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Deploy

This is a single Node process + a SQLite file. Any host that runs Node and gives you a persistent disk works. Below are the easiest options.

### Render (free tier)

1. Push this repo to GitHub.
2. New → **Web Service** → connect the repo.
3. Runtime: **Node**.
4. Build command: `npm install`
5. Start command: `node server.js`
6. Add a **Disk**: mount at `/opt/render/project/src/data`, 1 GB is plenty.
7. Environment variables:
   - `SESSION_SECRET` = (paste a random string)
   - `BASE_URL` = `https://<your-service>.onrender.com`
   - `NODE_ENV` = `production`
8. Deploy. First load of a machine's QR page will encode the production URL.

### Railway

1. New Project → Deploy from GitHub.
2. Add a **Volume** mounted at `/app/data`.
3. Set the same three env vars (`SESSION_SECRET`, `BASE_URL`, `NODE_ENV=production`).
4. Railway runs `npm start` by default.

### Fly.io

```bash
fly launch               # accept defaults, no Postgres
fly volumes create data --size 1
# edit fly.toml: add [mounts] source="data" destination="/app/data"
fly secrets set SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
fly secrets set BASE_URL=https://<your-app>.fly.dev NODE_ENV=production
fly deploy
```

### Any VPS (systemd)

```bash
# on the server
git clone <this-repo> /opt/vending-request
cd /opt/vending-request
npm install --production
cp .env.example .env
# edit .env: set SESSION_SECRET, BASE_URL=https://yourdomain, NODE_ENV=production
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

Put nginx/Caddy in front for TLS.

## End-to-end flow

1. **Operator** visits `/`, clicks **Sign up**, creates `alice` / `hunter22222`.
2. Lands on **Dashboard**. Clicks **+ New Machine**, names it "Lobby Vending".
3. On the machine detail page, there's a QR code, a public URL, and a **Print poster** button.
4. Operator prints the poster, tapes it to the vending machine.
5. **Customer** walks up, opens their phone camera, scans the QR, lands on `/r/<token>`.
6. Fills in "Flamin' Hot Cheetos" + Snack + optional notes, submits. Sees a thank-you page.
7. Operator refreshes the dashboard, sees "1 new", clicks into the machine, marks it **Addressed** once they've restocked.

## Security notes

- Passwords are hashed with bcrypt (cost factor 12).
- Sessions are stored server-side in a separate SQLite file, cookies are `httpOnly` + `sameSite=lax`, and `secure` in production.
- All state-changing requests require a CSRF token (stored in the session, injected into every form). Public `POST /r/:token` is exempt (anonymous users have no session) but is rate-limited to 5 submissions per minute per IP and includes a honeypot field.
- Every operator-scoped query uses `WHERE operator_id = ?` so operator A can never see operator B's machines or requests.
- Strict CSP (`default-src 'self'`, no inline scripts, no inline styles).
- Machine public tokens are 128-bit random hex — not guessable.

## Backup

Back up `data/app.sqlite` (and optionally `data/sessions.sqlite`, though losing it just logs everyone out). A cron that copies the file somewhere safe is sufficient for most operators.

## Roadmap (not built yet)

- Email/SMS notifications to the operator on new requests
- Password reset flow
- Team members on a single operator account
- Analytics: top requested products, request trends over time
- NFC tag write helper (a companion that writes the same URL to an NTAG sticker)

## License

MIT (do whatever, no warranty).
