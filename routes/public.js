const express = require('express');
const rateLimit = require('express-rate-limit');
const { q } = require('../db');

const router = express.Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please wait a minute and try again.',
});

// Lenient phone validation: accept any string that contains at least 7 digits.
// We keep the original user-entered format (pretty) plus store digits-only for tel: links.
function parsePhone(raw) {
  const str = String(raw || '').trim().slice(0, 40);
  const digits = str.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return str;
}

router.get('/r/:token', async (req, res, next) => {
  try {
    const machine = await q.getMachineByToken(req.params.token);
    if (!machine) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: "That QR code isn't linked to a machine. Check the sticker or ask the operator.",
        stack: null,
      });
    }
    res.render('public-form', {
      title: `Request a product`,
      machine,
      error: null,
      form: {},
    });
  } catch (err) {
    next(err);
  }
});

router.post('/r/:token', submitLimiter, async (req, res, next) => {
  try {
    const machine = await q.getMachineByToken(req.params.token);
    if (!machine) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: 'Unknown machine.',
        stack: null,
      });
    }

    // Honeypot: bots fill every field. Accept silently but don't store.
    if (String(req.body.website || '').length > 0) {
      return res.redirect(`/r/${machine.public_token}/thanks`);
    }

    const product_name = String(req.body.product_name || '').trim().slice(0, 120);
    const phone = parsePhone(req.body.phone);

    if (!product_name) {
      return res.status(400).render('public-form', {
        title: `Request a product`,
        machine,
        error: 'Please tell us what product you want.',
        form: { product_name: req.body.product_name, phone: req.body.phone },
      });
    }
    if (!phone) {
      return res.status(400).render('public-form', {
        title: `Request a product`,
        machine,
        error: 'Please enter a valid phone number (at least 7 digits).',
        form: { product_name, phone: req.body.phone },
      });
    }

    await q.insertRequest({
      machine_id: machine.id,
      product_name,
      phone,
      notes: null,
    });

    res.redirect(`/r/${machine.public_token}/thanks`);
  } catch (err) {
    next(err);
  }
});

// -------------------- Report an issue --------------------

router.get('/r/:token/issue', async (req, res, next) => {
  try {
    const machine = await q.getMachineByToken(req.params.token);
    if (!machine) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: "That QR code isn't linked to a machine.",
        stack: null,
      });
    }
    res.render('public-issue', {
      title: 'Report an issue',
      machine,
      error: null,
      form: {},
    });
  } catch (err) {
    next(err);
  }
});

router.post('/r/:token/issue', submitLimiter, async (req, res, next) => {
  try {
    const machine = await q.getMachineByToken(req.params.token);
    if (!machine) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: 'Unknown machine.',
        stack: null,
      });
    }

    if (String(req.body.website || '').length > 0) {
      return res.redirect(`/r/${machine.public_token}/thanks`);
    }

    const issue = String(req.body.issue || '').trim().slice(0, 300);
    const phone = parsePhone(req.body.phone);

    if (!issue) {
      return res.status(400).render('public-issue', {
        title: 'Report an issue',
        machine,
        error: 'Please describe the issue.',
        form: { issue: req.body.issue, phone: req.body.phone },
      });
    }
    if (!phone) {
      return res.status(400).render('public-issue', {
        title: 'Report an issue',
        machine,
        error: 'Please enter a valid phone number (at least 7 digits).',
        form: { issue, phone: req.body.phone },
      });
    }

    await q.insertRequest({
      machine_id: machine.id,
      product_name: issue,
      phone,
      notes: null,
      type: 'issue',
    });

    res.redirect(`/r/${machine.public_token}/thanks?type=issue`);
  } catch (err) {
    next(err);
  }
});

router.get('/r/:token/thanks', async (req, res, next) => {
  try {
    const machine = await q.getMachineByToken(req.params.token);
    if (!machine) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: 'Unknown machine.',
        stack: null,
      });
    }
    res.render('public-thanks', { title: 'Thanks!', machine, type: req.query.type || 'request' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
