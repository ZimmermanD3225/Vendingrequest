// MealMe API integration for product price comparison.
// If MEALME_API_KEY is not set or the API is unreachable, all methods
// return empty results so the app degrades gracefully.

const apiKey = process.env.MEALME_API_KEY;
const BASE_URL = 'https://api.mealme.ai/v2';

function enabled() {
  return Boolean(apiKey);
}

async function searchProducts(query, { lat = 41.5868, lng = -93.625 } = {}) {
  if (!apiKey) return [];

  const body = {
    query,
    user_latitude: lat,
    user_longitude: lng,
    pickup: true,
    fetch_quotes: true,
    autocomplete: false,
    sort: 'relevance',
    maximum_miles: 30,
  };

  // Try multiple auth header patterns — MealMe docs vary
  const headers = [
    { 'Content-Type': 'application/json', 'Api-Key': apiKey },
    { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  ];

  const endpoints = [
    '/search/grocery/v2',
    '/groceries/search',
  ];

  for (const endpoint of endpoints) {
    for (const h of headers) {
      try {
        const res = await fetch(`${BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8000),
        });

        if (res.status === 403 || res.status === 401) continue;
        if (!res.ok) {
          console.error(`[mealme] ${endpoint} error ${res.status}`);
          continue;
        }

        const data = await res.json();
        const items = data.products || data.items || data.grocery_products || data.results || [];
        if (!items.length) continue;

        return items.slice(0, 10).map((p) => ({
          name: p.name || p.product_name || p.title || query,
          price: p.price || p.unit_price || p.sale_price || null,
          store: p.store_name || (p.store && p.store.name) || p.merchant_name || 'Unknown',
          image: p.image || p.image_url || p.thumbnail || null,
          url: p.link || p.url || p.product_url || null,
        }));
      } catch (err) {
        if (err.name === 'TimeoutError') continue;
        console.error(`[mealme] ${endpoint} failed:`, err.message);
      }
    }
  }

  return [];
}

module.exports = { enabled, searchProducts };
