const express = require('express');
const bcrypt = require('bcryptjs');
const { q, pool } = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { generatePublicToken } = require('../lib/tokens');
const { forwardGeocode, reverseGeocode, searchSuggestions } = require('../lib/geocode');
const { seedDemoMachines } = require('../lib/demo-seed');
const walmart = require('../lib/walmart');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// API-specific auth middleware: returns 401 JSON instead of redirecting
function apiAuth(req, res, next) {
  if (!req.session || !req.session.operatorId) {
    return res.status(401).json({ ok: false, error: 'Not authenticated.' });
  }
  next();
}

// Sanitize operator object for API responses
function sanitizeOperator(op) {
  return {
    id: op.id,
    username: op.username,
    business_name: op.business_name,
    email: op.email,
  };
}

// ==================== Auth ====================

router.post('/auth/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const op = await q.getOperatorByUsername(username);
    const ok = op && (await bcrypt.compare(password, op.password_hash));
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'Invalid username or password.' });
    }

    req.session.operatorId = op.id;
    req.session.username = op.username;
    req.session.businessName = op.business_name || op.username;
    res.json({ ok: true, operator: sanitizeOperator(op) });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/signup', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const business_name = String(req.body.business_name || '').trim().slice(0, 120);
    const email = String(req.body.email || '').trim().slice(0, 160);
    const password = String(req.body.password || '');

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ ok: false, error: 'Username must be 3-32 characters (letters, numbers, _ . -).' });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters.' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    }
    if (await q.getOperatorByUsername(username)) {
      return res.status(400).json({ ok: false, error: 'That username is already taken.' });
    }
    if (await q.getOperatorByEmail(email)) {
      return res.status(400).json({ ok: false, error: 'An account with that email already exists.' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const op = await q.insertOperator({
      username,
      password_hash,
      business_name: business_name || null,
      email,
      email_verified: true,
      verification_token: null,
      verification_expires_at: null,
    });

    try { await seedDemoMachines(op.id); } catch (_) { /* non-fatal */ }
    try { await q.logEvent(op.id, 'signup', username); } catch (_) {}

    req.session.operatorId = op.id;
    req.session.username = op.username;
    req.session.businessName = op.business_name || op.username;

    const full = await q.getOperatorById(op.id);
    res.json({ ok: true, operator: sanitizeOperator(full) });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.post('/auth/forgot-password', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim();
    const op = await q.getOperatorByEmail(email);
    if (op) {
      const { generateResetToken } = require('../lib/tokens');
      const { sendPasswordResetEmail } = require('../lib/email');
      const token = generateResetToken();
      const expires = new Date(Date.now() + 60 * 60 * 1000);
      await q.setResetToken(op.id, token, expires);
      const base = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
      await sendPasswordResetEmail({
        to: op.email,
        resetUrl: `${base}/reset-password/${token}`,
        businessName: op.business_name || op.username,
      });
    }
    // Always return ok to prevent email enumeration
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/auth/me', apiAuth, async (req, res, next) => {
  try {
    const op = await q.getOperatorById(req.session.operatorId);
    if (!op) {
      return res.status(401).json({ ok: false, error: 'Account not found.' });
    }
    res.json({ ok: true, operator: sanitizeOperator(op) });
  } catch (err) {
    next(err);
  }
});

router.patch('/auth/me', apiAuth, async (req, res, next) => {
  try {
    const op = await q.getOperatorById(req.session.operatorId);
    if (!op) {
      return res.status(401).json({ ok: false, error: 'Account not found.' });
    }

    const businessName = String(req.body.business_name || '').trim().slice(0, 120);
    const email = String(req.body.email || '').trim().slice(0, 160);

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    }

    const existing = await q.getOperatorByEmail(email);
    if (existing && existing.id !== op.id) {
      return res.status(400).json({ ok: false, error: 'That email is already in use by another account.' });
    }

    await pool.query(
      `UPDATE operators SET business_name = $1, email = $2 WHERE id = $3`,
      [businessName || null, email, op.id]
    );
    req.session.businessName = businessName || op.username;

    const updated = await q.getOperatorById(op.id);
    res.json({ ok: true, operator: sanitizeOperator(updated) });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/change-password', apiAuth, async (req, res, next) => {
  try {
    const op = await q.getOperatorById(req.session.operatorId);
    if (!op) {
      return res.status(401).json({ ok: false, error: 'Account not found.' });
    }

    const current = String(req.body.current_password || '');
    const newPass = String(req.body.new_password || '');
    const confirm = String(req.body.confirm_password || '');

    const ok = await bcrypt.compare(current, op.password_hash);
    if (!ok) return res.status(400).json({ ok: false, error: 'Current password is incorrect.' });
    if (newPass.length < 8) return res.status(400).json({ ok: false, error: 'New password must be at least 8 characters.' });
    if (newPass !== confirm) return res.status(400).json({ ok: false, error: 'New passwords do not match.' });

    const hash = await bcrypt.hash(newPass, 12);
    await q.updatePasswordHash(op.id, hash);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ==================== Machines ====================

router.get('/machines', apiAuth, async (req, res, next) => {
  try {
    const machines = await q.listMachinesForOperator(req.session.operatorId);
    res.json({ ok: true, machines });
  } catch (err) {
    next(err);
  }
});

router.get('/machines/:id', apiAuth, async (req, res, next) => {
  try {
    const machine = await q.getMachineForOperator(req.params.id, req.session.operatorId);
    if (!machine) {
      return res.status(404).json({ ok: false, error: 'Machine not found.' });
    }

    // If 'all' is passed (or no status), return all requests for the iOS app
    const wantAll = req.query.status === 'all' || !req.query.status;
    let requests;
    if (wantAll) {
      const { rows } = await pool.query(
        `SELECT * FROM requests WHERE machine_id = $1 ORDER BY created_at DESC`,
        [machine.id]
      );
      requests = rows;
    } else {
      const type = req.query.type === 'issue' ? 'issue' : 'request';
      const status = req.query.status;
      const filterType = status === 'new' ? type : null;
      requests = await q.listRequestsForMachine(machine.id, status, filterType);
    }

    res.json({ ok: true, machine, requests });
  } catch (err) {
    next(err);
  }
});

router.post('/machines', apiAuth, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const location = String(req.body.location || '').trim().slice(0, 160);
    const address = String(req.body.address || '').trim().slice(0, 300);
    let lat = parseFloat(req.body.lat) || null;
    let lng = parseFloat(req.body.lng) || null;

    if (!name) {
      return res.status(400).json({ ok: false, error: 'Machine name is required.' });
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
    try { await q.logEvent(req.session.operatorId, 'add_machine', name); } catch (_) {}

    const machine = await q.getMachineForOperator(created.id, req.session.operatorId);
    res.json({ ok: true, machine });
  } catch (err) {
    next(err);
  }
});

router.delete('/machines/:id', apiAuth, async (req, res, next) => {
  try {
    const machine = await q.getMachineForOperator(req.params.id, req.session.operatorId);
    if (!machine) {
      return res.status(404).json({ ok: false, error: 'Machine not found.' });
    }
    await q.deleteMachineForOperator(req.params.id, req.session.operatorId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/machines/:id/location', apiAuth, async (req, res, next) => {
  try {
    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ ok: false, error: 'Valid lat and lng are required.' });
    }
    const machine = await q.getMachineForOperator(req.params.id, req.session.operatorId);
    if (!machine) {
      return res.status(404).json({ ok: false, error: 'Machine not found.' });
    }
    const rev = await reverseGeocode(lat, lng);
    const address = rev ? rev.display : machine.address;
    await q.updateMachineLocation(req.params.id, req.session.operatorId, { address, lat, lng });
    res.json({ ok: true, address });
  } catch (err) {
    next(err);
  }
});

// ==================== Requests ====================

router.patch('/requests/:id/status', apiAuth, async (req, res, next) => {
  try {
    const nextStatus = String(req.body.status || '');
    if (!['new', 'addressed', 'dismissed'].includes(nextStatus)) {
      return res.status(400).json({ ok: false, error: 'Invalid status. Must be new, addressed, or dismissed.' });
    }
    const request = await q.getRequestForOperator(req.params.id, req.session.operatorId);
    if (!request) {
      return res.status(404).json({ ok: false, error: 'Request not found.' });
    }
    await q.updateRequestStatus(nextStatus, request.id, req.session.operatorId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ==================== Restocks ====================

router.get('/machines/:id/restocks', apiAuth, async (req, res, next) => {
  try {
    const machine = await q.getMachineForOperator(req.params.id, req.session.operatorId);
    if (!machine) {
      return res.status(404).json({ ok: false, error: 'Machine not found.' });
    }
    const restocks = await q.listRestocksForMachine(machine.id);
    res.json({ ok: true, restocks });
  } catch (err) {
    next(err);
  }
});

router.post('/machines/:id/restocks', apiAuth, async (req, res, next) => {
  try {
    const machine = await q.getMachineForOperator(req.params.id, req.session.operatorId);
    if (!machine) {
      return res.status(404).json({ ok: false, error: 'Machine not found.' });
    }

    const rawItems = req.body.items;
    const items = [];

    if (Array.isArray(rawItems)) {
      // JSON body: [{ name, qty }, ...]
      for (const item of rawItems) {
        const name = String(item.name || '').trim();
        const qty = parseInt(item.qty, 10) || 0;
        if (name && qty > 0) items.push({ name, qty });
      }
    } else {
      // Form-encoded fallback (item_name[] / item_qty[])
      const names = [].concat(req.body['item_name'] || []);
      const qtys = [].concat(req.body['item_qty'] || []);
      for (let i = 0; i < names.length; i++) {
        const name = String(names[i] || '').trim();
        const qty = parseInt(qtys[i], 10) || 0;
        if (name && qty > 0) items.push({ name, qty });
      }
    }

    if (items.length === 0) {
      return res.status(400).json({ ok: false, error: 'Add at least one item with a quantity.' });
    }

    const notes = String(req.body.notes || '').trim().slice(0, 500) || null;
    const restock = await q.insertRestock({ machine_id: machine.id, operator_id: req.session.operatorId, items, notes });
    try { await q.logEvent(req.session.operatorId, 'restock', machine.name); } catch (_) {}

    res.json({ ok: true, restock: { id: restock.id, items, notes, machine_id: machine.id } });
  } catch (err) {
    next(err);
  }
});

// ==================== Suppliers ====================

router.get('/suppliers', apiAuth, async (req, res, next) => {
  try {
    const suppliers = await q.listSuppliersForOperator(req.session.operatorId);
    res.json({ ok: true, suppliers });
  } catch (err) {
    next(err);
  }
});

router.post('/suppliers', apiAuth, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 120);
    if (!name) {
      return res.status(400).json({ ok: false, error: 'Supplier name is required.' });
    }
    const supplier = await q.insertSupplier({
      operator_id: req.session.operatorId,
      name,
      contact: String(req.body.contact || '').trim().slice(0, 120),
      phone: String(req.body.phone || '').trim().slice(0, 40),
      email: String(req.body.email || '').trim().slice(0, 160),
      notes: String(req.body.notes || '').trim().slice(0, 500),
    });
    res.json({ ok: true, supplier: { id: supplier.id, name } });
  } catch (err) {
    next(err);
  }
});

router.delete('/suppliers/:id', apiAuth, async (req, res, next) => {
  try {
    const supplier = await q.getSupplierForOperator(req.params.id, req.session.operatorId);
    if (!supplier) {
      return res.status(404).json({ ok: false, error: 'Supplier not found.' });
    }
    await q.deleteSupplierForOperator(req.params.id, req.session.operatorId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ==================== Reorder ====================

router.get('/reorder', apiAuth, async (req, res, next) => {
  try {
    const reorderData = await q.getReorderData(req.session.operatorId);
    const supplierMap = await q.getProductSupplierMap(req.session.operatorId);
    const suppliers = await q.listSuppliersForOperator(req.session.operatorId);

    const productToSupplier = {};
    for (const row of supplierMap) {
      productToSupplier[row.product_name] = { id: row.supplier_id, name: row.supplier_name };
    }

    const items = reorderData.map((item) => ({
      ...item,
      supplier: productToSupplier[item.product_name] || null,
    }));

    res.json({ ok: true, items, suppliers });
  } catch (err) {
    next(err);
  }
});

router.post('/reorder/link', apiAuth, async (req, res, next) => {
  try {
    const product_name = String(req.body.product_name || '').trim();
    const supplier_id = parseInt(req.body.supplier_id, 10);
    if (!product_name || !supplier_id) {
      return res.status(400).json({ ok: false, error: 'product_name and supplier_id are required.' });
    }
    await q.linkProductToSupplier({
      operator_id: req.session.operatorId,
      product_name,
      supplier_id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ==================== Prices ====================

router.get('/prices', apiAuth, async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.json({ ok: false, results: [] });
  try {
    const results = await walmart.searchProducts(query);
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[api/prices]', err);
    res.json({ ok: false, results: [] });
  }
});

// ==================== AI Single-Product Price Search ====================

router.get('/prices/ai', apiAuth, async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.json({ ok: false, error: 'Search query is required.' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.json({ ok: false, error: 'AI analysis not configured.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `You are a vending machine bulk purchasing expert. You know current US retail and wholesale prices extremely well. When asked about product prices, provide accurate real-world prices based on your knowledge of what these items actually cost at each store. Always use realistic 2025-2026 US prices. Every result MUST have a numeric price — never null. You respond ONLY with valid JSON. No markdown, no explanation, no code blocks.`,
        messages: [
          {
            role: 'user',
            content: `Find the best bulk price for "${query}" at each of these stores: Walmart, Amazon, Sam's Club, Costco, and Target.

Requirements:
- Focus on vending-machine single-serve sizes (12oz cans, 20oz bottles, single-serve bags/bars)
- Find the largest bulk/case pack available at each store
- Calculate accurate per-unit cost
- Every result must have a real price number
- Pick the store with the lowest per-unit cost as best_pick

JSON format:
{"product":"name","results":[{"store":"Store Name","item":"exact product name and pack size","price":12.99,"per_unit":"$0.54/ea","unit_count":24,"notes":"brief note"}],"best_pick":{"store":"cheapest per-unit store","item":"the item","price":12.99,"per_unit":"$0.54/ea"},"tip":"one buying tip"}`,
          },
          { role: 'assistant', content: '{' },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();
    let text = '{';
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') text += block.text;
      }
    }

    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch {
      analysis = { product: query, results: [], best_pick: null, tip: '' };
    }

    res.json({ ok: true, analysis });
  } catch (err) {
    console.error('[api/prices/ai]', err);
    res.json({ ok: false, error: 'AI price search failed.' });
  }
});

// ==================== AI Price Analysis ====================

router.post('/prices/analyze', apiAuth, async (req, res) => {
  const products = req.body.products;
  if (!Array.isArray(products) || products.length === 0) {
    return res.json({ ok: false, error: 'products array is required.' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.json({ ok: false, error: 'AI analysis not configured.' });
  }

  try {
    const productList = products.slice(0, 10).map((p) => `- ${p}`).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are a vending machine bulk purchasing expert. You know current US retail and wholesale prices extremely well. Provide accurate real-world prices for bulk vending products at major US retailers. Always use realistic 2025-2026 US prices. Every recommendation MUST have a numeric price — never null. You respond ONLY with valid JSON. No markdown, no explanation, no code blocks.`,
        messages: [
          {
            role: 'user',
            content: `Find the cheapest bulk deal for each of these vending machine products. Check Walmart, Amazon, Sam's Club, Costco, and Target. Pick the single best bulk option for each product.

Requirements:
- Focus on vending-machine single-serve sizes (12oz cans, 20oz bottles, single-serve bags/bars)
- Find the best value bulk/case pack
- Every recommendation must have a real price and per-unit cost
- Include which store has the best deal

Products:
${productList}

JSON format:
{"recommendations":[{"product":"original name","best_option":"exact product name and pack size","price":12.99,"store":"Store Name","reason":"why this is best","per_unit":"$0.54/ea"}],"total_estimated":45.99,"tip":"one buying tip"}`,
          },
          { role: 'assistant', content: '{' },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });

    const data = await response.json();
    let text = '{';
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') text += block.text;
      }
    }

    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch {
      analysis = { recommendations: [], total_estimated: 0, tip: '' };
    }

    res.json({ ok: true, analysis });
  } catch (err) {
    console.error('[api/prices/analyze]', err);
    res.json({ ok: false, error: 'AI analysis failed.' });
  }
});

// ==================== Geocode ====================

router.get('/geocode', apiAuth, async (req, res) => {
  const address = String(req.query.q || '').trim();
  if (!address) return res.json({ ok: false });
  const result = await forwardGeocode(address);
  res.json(result ? { ok: true, ...result } : { ok: false });
});

router.get('/geocode-suggest', apiAuth, async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 3) return res.json({ ok: true, results: [] });
  const results = await searchSuggestions(query, 5);
  res.json({ ok: true, results });
});

// ==================== Error handler ====================

router.use((err, req, res, _next) => {
  console.error('[API]', err);
  res.status(500).json({ ok: false, error: 'Internal server error.' });
});

module.exports = router;
