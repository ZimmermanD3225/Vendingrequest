const express = require('express');
const bcrypt = require('bcryptjs');
const { stmts } = require('../db');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

router.get('/signup', (req, res) => {
  if (req.session.operatorId) return res.redirect('/dashboard');
  res.render('signup', { title: 'Sign up', error: null, form: {} });
});

router.post('/signup', (req, res) => {
  const form = {
    username: String(req.body.username || '').trim(),
    business_name: String(req.body.business_name || '').trim().slice(0, 120),
    email: String(req.body.email || '').trim().slice(0, 120),
  };
  const password = String(req.body.password || '');

  const renderError = (msg) =>
    res.status(400).render('signup', { title: 'Sign up', error: msg, form });

  if (!USERNAME_RE.test(form.username)) {
    return renderError('Username must be 3-32 characters: letters, numbers, _ . -');
  }
  if (password.length < 8) {
    return renderError('Password must be at least 8 characters.');
  }
  if (stmts.getOperatorByUsername.get(form.username)) {
    return renderError('That username is already taken.');
  }

  const password_hash = bcrypt.hashSync(password, 12);
  const info = stmts.insertOperator.run({
    username: form.username,
    password_hash,
    business_name: form.business_name || null,
    email: form.email || null,
  });
  req.session.operatorId = info.lastInsertRowid;
  req.session.username = form.username;
  res.redirect('/dashboard');
});

router.get('/login', (req, res) => {
  if (req.session.operatorId) return res.redirect('/dashboard');
  res.render('login', { title: 'Log in', error: null, form: {} });
});

router.post('/login', (req, res) => {
  const form = { username: String(req.body.username || '').trim() };
  const password = String(req.body.password || '');

  const op = stmts.getOperatorByUsername.get(form.username);
  const ok = op && bcrypt.compareSync(password, op.password_hash);
  if (!ok) {
    return res.status(401).render('login', {
      title: 'Log in',
      error: 'Invalid username or password.',
      form,
    });
  }
  req.session.operatorId = op.id;
  req.session.username = op.username;
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
