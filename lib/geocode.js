const https = require('https');

const UA = 'VendingRequestApp/2.0 (operator-vending-map)';

function nominatimGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'nominatim.openstreetmap.org',
        path,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

async function forwardGeocode(address) {
  const data = await nominatimGet(
    `/search?format=json&limit=1&q=${encodeURIComponent(address)}`
  );
  if (!data || !data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
}

async function searchSuggestions(query, limit = 5) {
  const data = await nominatimGet(
    `/search?format=json&addressdetails=1&limit=${limit}&q=${encodeURIComponent(query)}`
  );
  if (!data || !Array.isArray(data)) return [];
  return data.map((d) => ({
    display: d.display_name,
    lat: parseFloat(d.lat),
    lng: parseFloat(d.lon),
  }));
}

async function reverseGeocode(lat, lng) {
  const data = await nominatimGet(
    `/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`
  );
  if (!data || data.error) return null;
  return { display: data.display_name, lat: parseFloat(data.lat), lng: parseFloat(data.lon) };
}

module.exports = { forwardGeocode, reverseGeocode, searchSuggestions };
