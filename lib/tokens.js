const crypto = require('crypto');

function generatePublicToken() {
  return crypto.randomBytes(16).toString('hex');
}

function generateCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = { generatePublicToken, generateCsrfToken };
