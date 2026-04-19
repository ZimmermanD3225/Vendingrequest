const crypto = require('crypto');

function generatePublicToken() {
  return crypto.randomBytes(16).toString('hex');
}

function generateCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

// 256-bit token for email verification links.
function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { generatePublicToken, generateCsrfToken, generateVerificationToken, generateResetToken };
