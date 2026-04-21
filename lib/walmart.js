// Walmart Affiliate Marketing API integration.
// Docs: https://walmart.io/docs/affiliates/v1/introduction
//
// Env vars:
//   WALMART_CONSUMER_ID  – from walmart.io dashboard after uploading public key
//   WALMART_KEY_VERSION  – key version shown in walmart.io dashboard
//   WALMART_PRIVATE_KEY  – RSA private key (PEM string, or path to .pem file)

const crypto = require('crypto');
const fs = require('fs');

const consumerId = process.env.WALMART_CONSUMER_ID;
const keyVersion = process.env.WALMART_KEY_VERSION;
const rawKey = process.env.WALMART_PRIVATE_KEY || '';

// Support both inline PEM and file path
let privateKey = null;
if (rawKey) {
  if (rawKey.includes('BEGIN')) {
    privateKey = rawKey;
  } else {
    try {
      privateKey = fs.readFileSync(rawKey, 'utf8');
    } catch (err) {
      console.error('[walmart] Could not read private key file:', rawKey);
    }
  }
}

const BASE_URL = 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2';

function enabled() {
  return Boolean(consumerId && keyVersion && privateKey);
}

/**
 * Generate the WM_SEC.AUTH_SIGNATURE header.
 * Signs: consumerId + "\n" + timestamp + "\n" + keyVersion + "\n"
 * with RSA-SHA256, then base64-encodes the result.
 */
function generateSignature(timestamp) {
  const data = `${consumerId}\n${timestamp}\n${keyVersion}\n`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data);
  return sign.sign(privateKey, 'base64');
}

/** Build the required auth headers for every Walmart API call. */
function authHeaders() {
  const timestamp = Date.now().toString();
  return {
    'WM_CONSUMER.ID': consumerId,
    'WM_CONSUMER.CHANNEL.TYPE': '0',
    'WM_SEC.KEY_VERSION': keyVersion,
    'WM_SEC.AUTH_SIGNATURE': generateSignature(timestamp),
    'WM_SEC.TIMESTAMP': timestamp,
    Accept: 'application/json',
  };
}

async function searchProducts(query) {
  if (!enabled()) return [];

  try {
    const params = new URLSearchParams({
      query: query,
      sort: 'relevance',
      numItems: 8,
    });

    const res = await fetch(`${BASE_URL}/search?${params}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.error(`[walmart] API error ${res.status}: ${res.statusText}`);
      return [];
    }

    const data = await res.json();
    const items = data.items || [];

    return items.map((p) => ({
      name: p.name || query,
      price: p.salePrice || p.msrp || null,
      store: 'Walmart',
      image: p.thumbnailImage || p.mediumImage || null,
      url: p.productUrl || p.addToCartUrl || null,
      size: p.size || null,
    }));
  } catch (err) {
    if (err.name === 'TimeoutError') {
      console.error('[walmart] Request timed out');
    } else {
      console.error('[walmart] Search failed:', err.message);
    }
    return [];
  }
}

module.exports = { enabled, searchProducts };
