require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const { pool, initSchema } = require('./db');
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
        'upgrade-insecure-requests': IS_PROD ? [] : null,
      },
    },
  })
);
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(csrfIssue);
app.use(csrfVerify(['/r/']));

app.use((req, res, next) => {
  res.locals.currentUser = req.session && req.session.username
    ? { id: req.session.operatorId, username: req.session.username, businessName: req.session.businessName }
    : null;
  next();
});

app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/', (_req, res) => {
  res.render('index', { title: 'Vending Request' });
});

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(publicRoutes);

app.use((_req, res) => {
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

(async () => {
  try {
    await initSchema();
    app.listen(PORT, () => {
      console.log(`Vending Request listening on http://localhost:${PORT}`);
      console.log(`BASE_URL: ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
    });
  } catch (err) {
    console.error('Failed to init database:', err);
    process.exit(1);
  }
})();
