// Walmart Product Search API integration.
// Requires WALMART_API_KEY env var.
// Docs: https://developer.walmart.com

const apiKey = process.env.WALMART_API_KEY;

function enabled() {
  return Boolean(apiKey);
}

async function searchProducts(query) {
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      query: query,
      sort: 'relevance',
      numItems: 8,
    });

    const res = await fetch(`https://developer.api.walmart.com/api-proxy/service/affil/product/v2/search?${params}`, {
      headers: {
        'WM_SEC.ACCESS_TOKEN': apiKey,
        'WM_CONSUMER.CHANNEL.TYPE': '0',
        'Accept': 'application/json',
      },
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
