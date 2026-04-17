const express = require('express');
const { stmts } = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { generatePublicToken } = require('../lib/tokens');
const { qrPngBuffer } = require('../lib/qr');

const router = express.Router();

function publicUrlFor(token) {
  const base = process.env.BASE_URL || 'http://localhost:4000';
  return `${base.replace(/\/$/, '')}/r/${token}`;
}

router.get('/dashboard', requireAuth, (req, res) => {
  const machines = stmts.listMachinesForOperator.all(req.session.operatorId);
  res.render('dashboard', {
    title: 'Dashboard',
    machines,
    username: req.session.username,
  });
});

router.get('/machines/new', requireAuth, (req, res) => {
  res.render('machine-new', { title: 'New machine', error: null, form: {} });
});

router.post('/machines', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const location = String(req.body.location || '').trim().slice(0, 160);

  if (!name) {
    return res.status(400).render('machine-new', {
      title: 'New machine',
      error: 'Machine name is required.',
      form: { name, location },
    });
  }

  // Retry on the astronomically unlikely token collision.
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      const info = stmts.insertMachine.run({
        operator_id: req.session.operatorId,
        name,
        location: location || null,
        public_token: generatePublicToken(),
      });
      return res.redirect(`/machines/${info.lastInsertRowid}`);
    } catch (err) {
      lastErr = err;
      if (!String(err.message).includes('UNIQUE')) break;
    }
  }
  throw lastErr;
});

router.get('/machines/:id', requireAuth, (req, res) => {
  const machine = stmts.getMachineForOperator.get(
    req.params.id,
    req.session.operatorId
  );
  if (!machine) return res.status(404).render('error', {
    title: 'Not found',
    message: 'Machine not found.',
    stack: null,
  });

  const status = ['new', 'addressed', 'dismissed'].includes(req.query.status)
    ? req.query.status
    : 'new';
  const requests = stmts.listRequestsForMachine.all(machine.id, status);

  res.render('machine-show', {
    title: machine.name,
    machine,
    requests,
    status,
    publicUrl: publicUrlFor(machine.public_token),
  });
});

router.get('/machines/:id/qr.png', requireAuth, async (req, res, next) => {
  try {
    const machine = stmts.getMachineForOperator.get(
      req.params.id,
      req.session.operatorId
    );
    if (!machine) return res.status(404).end();
    const buf = await qrPngBuffer(publicUrlFor(machine.public_token), { size: 512 });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

router.get('/machines/:id/qr/print', requireAuth, (req, res) => {
  const machine = stmts.getMachineForOperator.get(
    req.params.id,
    req.session.operatorId
  );
  if (!machine) return res.status(404).render('error', {
    title: 'Not found',
    message: 'Machine not found.',
    stack: null,
  });
  res.render('machine-print', {
    title: `Print — ${machine.name}`,
    machine,
    publicUrl: publicUrlFor(machine.public_token),
  });
});

router.post('/machines/:id/delete', requireAuth, (req, res) => {
  stmts.deleteMachineForOperator.run(req.params.id, req.session.operatorId);
  res.redirect('/dashboard');
});

router.post('/requests/:id/status', requireAuth, (req, res) => {
  const next = String(req.body.status || '');
  if (!['new', 'addressed', 'dismissed'].includes(next)) {
    return res.status(400).render('error', {
      title: 'Bad request',
      message: 'Invalid status.',
      stack: null,
    });
  }
  const request = stmts.getRequestForOperator.get(
    req.params.id,
    req.session.operatorId
  );
  if (!request) return res.status(404).render('error', {
    title: 'Not found',
    message: 'Request not found.',
    stack: null,
  });
  stmts.updateRequestStatus.run(next, request.id, req.session.operatorId);
  res.redirect(`/machines/${request.machine_id}?status=${next}`);
});

module.exports = router;
