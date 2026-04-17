require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const fs = require('fs');

const { csrfIssue, csrfVerify } = require('./middleware/csrf');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const publicRoutes = require('./routes/public');

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'style-src': ["'self'"],
        'script-src': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        // In dev we serve over plain http://localhost; don't force https upgrades.
        'upgrade-insecure-requests': IS_PROD ? [] : null,
      },
    },
  })
);
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const sessionDb = new Database(path.join(DATA_DIR, 'sessions.sqlite'));

app.use(
  session({
    store: new SqliteStore({
      client: sessionDb,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

app.use(csrfIssue);
// Public submit endpoints don't have a session; exempt them from CSRF.
app.use(csrfVerify(['/r/']));

// Expose session user + helpers to all templates
app.use((req, res, next) => {
  res.locals.currentUser = req.session && req.session.username
    ? { id: req.session.operatorId, username: req.session.username }
    : null;
  res.locals.pageTitle = 'Vending Request';
  next();
});

app.get('/', (req, res) => {
  res.render('index', { title: 'Vending Request' });
});

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(publicRoutes);

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: "We couldn't find that page.",
    stack: null,
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Server error',
    message: 'Something went wrong on our end.',
    stack: IS_PROD ? null : err.stack,
  });
});

app.listen(PORT, () => {
  console.log(`Vending Request listening on http://localhost:${PORT}`);
  console.log(`BASE_URL for QR codes: ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
});
