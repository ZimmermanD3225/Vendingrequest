const QRCode = require('qrcode');

const cache = new Map();

async function qrPngBuffer(url, { size = 1024 } = {}) {
  const key = `${size}:${url}`;
  if (cache.has(key)) return cache.get(key);
  const buf = await QRCode.toBuffer(url, {
    type: 'png',
    width: size,
    margin: 2,
    // 'H' = up to 30% of codewords can be damaged and the code still scans.
    // At screen-downsampling sizes this is what keeps it reliable.
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#ffffff' },
  });
  cache.set(key, buf);
  return buf;
}

module.exports = { qrPngBuffer };
