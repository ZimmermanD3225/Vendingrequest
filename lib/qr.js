const QRCode = require('qrcode');

const cache = new Map();

async function qrPngBuffer(url, { size = 512 } = {}) {
  const key = `${size}:${url}`;
  if (cache.has(key)) return cache.get(key);
  const buf = await QRCode.toBuffer(url, {
    type: 'png',
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
  cache.set(key, buf);
  return buf;
}

module.exports = { qrPngBuffer };
