const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { q } = require('../db');
const { generateVerificationToken } = require('../lib/tokens');
const { sendVerificationEmail } = require('../lib/email');
const { setFlash } = require('../middleware/flash');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

// Throttle verification-email resends per IP.
const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many resend attempts. Please wait a bit and try again.',
});

function baseUrl() {
  return (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
}

async function issueVerification(operator) {
  const token = generateVerificationToken();
  const expires = new Date(Date.now() + VERIFICATION_TTL_MS);
  await q.setVerificationToken(operator.id, token, expires);
  await sendVerificationEmail({
    to: operator.email,
    verifyUrl: `${baseUrl()}/verify/${token}`,
    businessName: operator.business_name || operator.username,
  });
}

// -------------------- Signup --------------------

router.get('/signup', (req, res) => {
  if (req.session.operatorId) return res.redirect('/dashboard');
  res.render('signup', { title: 'Sign up', error: null, form: {} });
});

router.post('/signup', async (req, res, next) => {
  try {
    const form = {
      username: String(req.body.username || '').trim(),
      business_name: String(req.body.business_name || '').trim().slice(0, 120),
      email: String(req.body.email || '').trim().slice(0, 160),
    };
    const password = String(req.body.password || '');

    const renderError = (msg) =>
      res.status(400).render('signup', { title: 'Sign up', error: msg, form });

    if (!USERNAME_RE.test(form.username)) {
      return renderError('Username must be 3–32 characters (letters, numbers, _ . -).');
    }
    if (password.length < 8) {
      return renderError('Password must be at least 8 characters.');
    }
    if (!EMAIL_RE.test(form.email)) {
      return renderError('Please enter a valid email address.');
    }
    if (await q.getOperatorByUsername(form.username)) {
      return renderError('That username is already taken.');
    }
    if (await q.getOperatorByEmail(form.email)) {
      return renderError('An account with that email already exists. Try logging in.');
    }

    const password_hash = await bcrypt.hash(password, 12);

    const op = await q.insertOperator({
      username: form.username,
      password_hash,
      business_name: form.business_name || null,
      email: form.email,
      email_verified: true,
      verification_token: null,
      verification_expires_at: null,
    });

    req.session.operatorId = op.id;
    req.session.username = op.username;
    req.session.businessName = op.business_name || op.username;
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
});

// -------------------- Login --------------------

router.get('/login', (req, res) => {
  if (req.session.operatorId) return res.redirect('/dashboard');
  res.render('login', { title: 'Log in', error: null, form: {} });
});

router.post('/login', async (req, res, next) => {
  try {
    const form = { username: String(req.body.username || '').trim() };
    const password = String(req.body.password || '');

    const op = await q.getOperatorByUsername(form.username);
    const ok = op && (await bcrypt.compare(password, op.password_hash));
    if (!ok) {
      return res.status(401).render('login', {
        title: 'Log in',
        error: 'Invalid username or password.',
        form,
      });
    }

    req.session.operatorId = op.id;
    req.session.username = op.username;
    req.session.businessName = op.business_name || op.username;
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// -------------------- Email verification --------------------

router.get('/verify/pending', async (req, res, next) => {
  try {
    const opId = req.session.pendingVerifyOperatorId;
    if (!opId) return res.redirect('/login');
    const op = await q.getOperatorById(opId);
    if (!op) {
      delete req.session.pendingVerifyOperatorId;
      return res.redirect('/login');
    }
    if (op.email_verified) {
      delete req.session.pendingVerifyOperatorId;
      setFlash(req, 'success', 'Your email is already verified — log in to continue.');
      return res.redirect('/login');
    }
    res.render('verify-pending', {
      title: 'Check your email',
      email: op.email,
      emailEnabled: !!process.env.RESEND_API_KEY,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/verify/resend', resendLimiter, async (req, res, next) => {
  try {
    const opId = req.session.pendingVerifyOperatorId;
    if (!opId) return res.redirect('/login');
    const op = await q.getOperatorById(opId);
    if (!op) {
      delete req.session.pendingVerifyOperatorId;
      return res.redirect('/login');
    }
    if (op.email_verified) {
      delete req.session.pendingVerifyOperatorId;
      setFlash(req, 'success', 'Your email is already verified.');
      return res.redirect('/login');
    }
    await issueVerification(op);
    setFlash(req, 'success', 'Verification email resent. Check your inbox.');
    res.redirect('/verify/pending');
  } catch (err) {
    next(err);
  }
});

router.get('/verify/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    const op = await q.getOperatorByVerificationToken(token);
    if (!op) {
      return res.status(400).render('verify-expired', {
        title: 'Invalid link',
        message: "This verification link isn't valid. It may have been used already, or a newer one was sent.",
      });
    }
    if (op.verification_expires_at && new Date(op.verification_expires_at) < new Date()) {
      return res.status(400).render('verify-expired', {
        title: 'Link expired',
        message: 'This verification link expired. Log in and click "Resend" to get a new one.',
      });
    }

    await q.markEmailVerified(op.id);
    delete req.session.pendingVerifyOperatorId;
    setFlash(req, 'success', 'Email verified. You can log in now.');
    res.redirect('/login');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
