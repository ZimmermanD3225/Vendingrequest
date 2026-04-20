const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { q, pool } = require('../db');
const { generateVerificationToken, generateResetToken } = require('../lib/tokens');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../lib/email');
const { setFlash } = require('../middleware/flash');
const { seedDemoMachines } = require('../lib/demo-seed');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

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

    try { await seedDemoMachines(op.id); } catch (_) { /* non-fatal */ }
    try { await q.logEvent(op.id, 'signup', form.username); } catch (_) {}

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

// -------------------- Settings --------------------

function requireAuth(req, res, next) {
  if (!req.session.operatorId) return res.redirect('/login');
  next();
}

router.get('/settings', requireAuth, async (req, res, next) => {
  try {
    const op = await q.getOperatorById(req.session.operatorId);
    if (!op) return res.redirect('/login');
    res.render('settings', { title: 'Settings', op, error: null, success: null });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/profile', requireAuth, async (req, res, next) => {
  try {
    const op = await q.getOperatorById(req.session.operatorId);
    if (!op) return res.redirect('/login');
    const businessName = String(req.body.business_name || '').trim().slice(0, 120);
    const email = String(req.body.email || '').trim().slice(0, 160);

    if (!EMAIL_RE.test(email)) {
      return res.status(400).render('settings', {
        title: 'Settings', op, error: 'Please enter a valid email address.', success: null,
      });
    }

    const existing = await q.getOperatorByEmail(email);
    if (existing && existing.id !== op.id) {
      return res.status(400).render('settings', {
        title: 'Settings', op, error: 'That email is already in use by another account.', success: null,
      });
    }

    await pool.query(
      `UPDATE operators SET business_name = $1, email = $2 WHERE id = $3`,
      [businessName || null, email, op.id]
    );
    req.session.businessName = businessName || op.username;

    const updated = await q.getOperatorById(op.id);
    res.render('settings', { title: 'Settings', op: updated, error: null, success: 'Profile updated.' });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/password', requireAuth, async (req, res, next) => {
  try {
    const op = await q.getOperatorById(req.session.operatorId);
    if (!op) return res.redirect('/login');

    const current = String(req.body.current_password || '');
    const newPass = String(req.body.new_password || '');
    const confirm = String(req.body.confirm_password || '');

    const renderError = (msg) =>
      res.status(400).render('settings', { title: 'Settings', op, error: msg, success: null });

    const ok = await bcrypt.compare(current, op.password_hash);
    if (!ok) return renderError('Current password is incorrect.');
    if (newPass.length < 8) return renderError('New password must be at least 8 characters.');
    if (newPass !== confirm) return renderError('New passwords do not match.');

    const hash = await bcrypt.hash(newPass, 12);
    await q.updatePasswordHash(op.id, hash);

    res.render('settings', { title: 'Settings', op, error: null, success: 'Password changed.' });
  } catch (err) {
    next(err);
  }
});

// -------------------- Password reset --------------------

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many password reset attempts. Please wait and try again.',
});

router.get('/forgot-password', (req, res) => {
  if (req.session.operatorId) return res.redirect('/dashboard');
  res.render('forgot-password', { title: 'Forgot password', error: null });
});

router.post('/forgot-password', resetLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim();
    const op = await q.getOperatorByEmail(email);
    if (op) {
      const token = generateResetToken();
      const expires = new Date(Date.now() + RESET_TTL_MS);
      await q.setResetToken(op.id, token, expires);
      await sendPasswordResetEmail({
        to: op.email,
        resetUrl: `${baseUrl()}/reset-password/${token}`,
        businessName: op.business_name || op.username,
      });
    }
    // Always show the same message to prevent email enumeration.
    setFlash(req, 'success', 'If an account with that email exists, we sent a reset link. Check your inbox.');
    res.redirect('/forgot-password');
  } catch (err) {
    next(err);
  }
});

router.get('/reset-password/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    const op = await q.getOperatorByResetToken(token);
    if (!op) {
      return res.status(400).render('verify-expired', {
        title: 'Invalid link',
        message: "This reset link isn't valid. It may have been used already, or a newer one was sent.",
      });
    }
    if (op.reset_expires_at && new Date(op.reset_expires_at) < new Date()) {
      return res.status(400).render('verify-expired', {
        title: 'Link expired',
        message: 'This reset link has expired. Please request a new one.',
      });
    }
    res.render('reset-password', { title: 'Reset password', error: null, token });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    const password = String(req.body.password || '');
    const confirm = String(req.body.password_confirm || '');

    const renderError = (msg) =>
      res.status(400).render('reset-password', { title: 'Reset password', error: msg, token });

    const op = await q.getOperatorByResetToken(token);
    if (!op || (op.reset_expires_at && new Date(op.reset_expires_at) < new Date())) {
      return res.status(400).render('verify-expired', {
        title: 'Link expired',
        message: 'This reset link has expired or is invalid. Please request a new one.',
      });
    }
    if (password.length < 8) {
      return renderError('Password must be at least 8 characters.');
    }
    if (password !== confirm) {
      return renderError('Passwords do not match.');
    }

    const hash = await bcrypt.hash(password, 12);
    await q.updatePasswordHash(op.id, hash);
    await q.clearResetToken(op.id);

    setFlash(req, 'success', 'Password updated. You can log in now.');
    res.redirect('/login');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
