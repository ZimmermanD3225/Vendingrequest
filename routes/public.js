const express = require('express');
const rateLimit = require('express-rate-limit');
const { stmts } = require('../db');

const router = express.Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please wait a minute and try again.',
});

router.get('/r/:token', (req, res) => {
  const machine = stmts.getMachineByToken.get(req.params.token);
  if (!machine) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: "That QR code isn't linked to a machine. Double-check the sticker or ask the operator.",
      stack: null,
    });
  }
  res.render('public-form', {
    title: `Request — ${machine.name}`,
    machine,
    error: null,
    form: {},
  });
});

router.post('/r/:token', submitLimiter, (req, res) => {
  const machine = stmts.getMachineByToken.get(req.params.token);
  if (!machine) return res.status(404).render('error', {
    title: 'Not found',
    message: 'Unknown machine.',
    stack: null,
  });

  // Honeypot: bots that fill every field get silently dropped.
  if (String(req.body.website || '').length > 0) {
    return res.redirect(`/r/${machine.public_token}/thanks`);
  }

  const product_name = String(req.body.product_name || '').trim().slice(0, 80);
  const category = ['snack', 'beverage', 'other'].includes(req.body.category)
    ? req.body.category
    : null;
  const notes = String(req.body.notes || '').trim().slice(0, 500);
  const contact = String(req.body.contact || '').trim().slice(0, 120);

  if (!product_name) {
    return res.status(400).render('public-form', {
      title: `Request — ${machine.name}`,
      machine,
      error: 'Please tell us what product you want.',
      form: { product_name, category, notes, contact },
    });
  }

  stmts.insertRequest.run({
    machine_id: machine.id,
    product_name,
    category,
    notes: notes || null,
    contact: contact || null,
  });

  res.redirect(`/r/${machine.public_token}/thanks`);
});

router.get('/r/:token/thanks', (req, res) => {
  const machine = stmts.getMachineByToken.get(req.params.token);
  if (!machine) return res.status(404).render('error', {
    title: 'Not found',
    message: 'Unknown machine.',
    stack: null,
  });
  res.render('public-thanks', { title: 'Thanks!', machine });
});

module.exports = router;
