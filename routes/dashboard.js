const express = require('express');
const crypto = require('crypto');
const { q } = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { setFlash } = require('../middleware/flash');
const { generatePublicToken } = require('../lib/tokens');
const { qrPngBuffer } = require('../lib/qr');
const { forwardGeocode, reverseGeocode, searchSuggestions } = require('../lib/geocode');

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

router.get('/map', requireAuth, async (req, res, next) => {
  try {
    const machines = await q.listMachinesForOperator(req.session.operatorId);
    const pins = machines
      .filter((m) => m.lat && m.lng)
      .map((m) => ({ id: m.id, name: m.name, location: m.location || '', address: m.address || '', lat: m.lat, lng: m.lng, new_count: m.new_count }));
    res.render('map', { title: 'Map', pins: JSON.stringify(pins) });
  } catch (err) {
    next(err);
  }
});

router.get('/api/geocode', requireAuth, async (req, res) => {
  const address = String(req.query.q || '').trim();
  if (!address) return res.json({ ok: false });
  const result = await forwardGeocode(address);
  res.json(result ? { ok: true, ...result } : { ok: false });
});

router.get('/api/geocode-reverse', requireAuth, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng)) return res.json({ ok: false });
  const result = await reverseGeocode(lat, lng);
  res.json(result ? { ok: true, ...result } : { ok: false });
});

router.get('/api/geocode-suggest', requireAuth, async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 3) return res.json({ ok: true, results: [] });
  const results = await searchSuggestions(query, 5);
  res.json({ ok: true, results });
});

router.post('/machines/:id/location', requireAuth, async (req, res, next) => {
  try {
    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ ok: false });
    const machine = await q.getMachineForOperator(req.params.id, req.session.operatorId);
    if (!machine) return res.status(404).json({ ok: false });
    const rev = await reverseGeocode(lat, lng);
    const address = rev ? rev.display : machine.address;
    await q.updateMachineLocation(req.params.id, req.session.operatorId, { address, lat, lng });
    res.json({ ok: true, address });
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
    const address = String(req.body.address || '').trim().slice(0, 300);
    let lat = parseFloat(req.body.lat) || null;
    let lng = parseFloat(req.body.lng) || null;

    if (!name) {
      return res.status(400).render('machine-new', {
        title: 'New machine',
        error: 'Machine name is required.',
        form: { name, location, address },
      });
    }

    if (address && !lat) {
      const geo = await forwardGeocode(address);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }

    let created;
    for (let i = 0; i < 5; i++) {
      try {
        created = await q.insertMachine({
          operator_id: req.session.operatorId,
          name,
          location: location || null,
          public_token: generatePublicToken(),
          address,
          lat,
          lng,
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
