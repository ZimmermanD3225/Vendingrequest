const express = require('express');
const crypto = require('crypto');
const { q } = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { setFlash } = require('../middleware/flash');
const { generatePublicToken } = require('../lib/tokens');
const { qrPngBuffer } = require('../lib/qr');

const router = express.Router();

function publicUrlFor(token) {
  const base = process.env.BASE_URL || 'http://localhost:4000';
  return `${base.replace(/\/$/, '')}/r/${token}`;
}

// Short hash of the encoded URL — used as a ?v= cache buster on the <img>
// so the browser refetches the QR whenever BASE_URL changes.
function qrVersion(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
}

router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const machines = await q.listMachinesForOperator(req.session.operatorId);
    const recent = machines.length
      ? await q.listRecentRequestsForMachines(machines.map((m) => m.id), 3)
      : [];
    const recentByMachine = new Map();
    for (const r of recent) {
      if (!recentByMachine.has(r.machine_id)) recentByMachine.set(r.machine_id, []);
      recentByMachine.get(r.machine_id).push(r);
    }
    res.render('dashboard', {
      title: 'Dashboard',
      machines: machines.map((m) => ({ ...m, recent: recentByMachine.get(m.id) || [] })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/machines/new', requireAuth, (req, res) => {
  res.render('machine-new', { title: 'New machine', error: null, form: {} });
});

router.post('/machines', requireAuth, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const location = String(req.body.location || '').trim().slice(0, 160);

    if (!name) {
      return res.status(400).render('machine-new', {
        title: 'New machine',
        error: 'Machine name is required.',
        form: { name, location },
      });
    }

    let created;
    for (let i = 0; i < 5; i++) {
      try {
        created = await q.insertMachine({
          operator_id: req.session.operatorId,
          name,
          location: location || null,
          public_token: generatePublicToken(),
        });
        break;
      } catch (err) {
        if (!/duplicate key|unique/i.test(String(err.message))) throw err;
      }
    }
    if (!created) throw new Error('Could not generate a unique machine token.');
    setFlash(req, 'success', `"${name}" is ready. Print the poster and stick it on the machine.`);
    res.redirect(`/machines/${created.id}`);
  } catch (err) {
    next(err);
  }
});

router.get('/machines/:id', requireAuth, async (req, res, next) => {
  try {
    const machine = await q.getMachineForOperator(req.params.id, req.session.operatorId);
    if (!machine) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: 'Machine not found.',
        stack: null,
      });
    }

    const status = ['new', 'addressed', 'dismissed'].includes(req.query.status)
      ? req.query.status
      : 'new';
    const requests = await q.listRequestsForMachine(machine.id, status);

    const publicUrl = publicUrlFor(machine.public_token);
    res.render('machine-show', {
      title: machine.name,
      machine,
      requests,
      status,
      publicUrl,
      qrVersion: qrVersion(publicUrl),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/machines/:id/qr.png', requireAuth, async (req, res, next) => {
  try {
    const machine = await q.getMachineForOperator(req.params.id, req.session.operatorId);
    if (!machine) return res.status(404).end();
    const buf = await qrPngBuffer(publicUrlFor(machine.public_token));
    res.set('Content-Type', 'image/png');
    // Short cache — the version query param immutably identifies this render
    // (different BASE_URL → different ?v= → different entry), so it's safe.
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

router.get('/machines/:id/qr/print', requireAuth, async (req, res, next) => {
  try {
    const machine = await q.getMachineForOperator(req.params.id, req.session.operatorId);
    if (!machine) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: 'Machine not found.',
        stack: null,
      });
    }
    const publicUrl = publicUrlFor(machine.public_token);
    res.render('machine-print', {
      title: `Print — ${machine.name}`,
      machine,
      publicUrl,
      qrVersion: qrVersion(publicUrl),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/machines/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await q.deleteMachineForOperator(req.params.id, req.session.operatorId);
    setFlash(req, 'success', 'Machine deleted.');
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:id/status', requireAuth, async (req, res, next) => {
  try {
    const nextStatus = String(req.body.status || '');
    if (!['new', 'addressed', 'dismissed'].includes(nextStatus)) {
      return res.status(400).render('error', {
        title: 'Bad request',
        message: 'Invalid status.',
        stack: null,
      });
    }
    const request = await q.getRequestForOperator(req.params.id, req.session.operatorId);
    if (!request) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: 'Request not found.',
        stack: null,
      });
    }
    await q.updateRequestStatus(nextStatus, request.id, req.session.operatorId);
    const msg = {
      addressed: 'Marked as addressed.',
      dismissed: 'Request dismissed.',
      new: 'Request reopened.',
    }[nextStatus];
    setFlash(req, 'success', msg);
    res.redirect(`/machines/${request.machine_id}?status=${nextStatus}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
