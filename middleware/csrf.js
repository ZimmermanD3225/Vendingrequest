const { generateCsrfToken } = require('../lib/tokens');

// Ensures req.session.csrfToken exists and exposes it to templates as res.locals.csrfToken.
function csrfIssue(req, res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  res.locals.csrfToken = (req.session && req.session.csrfToken) || '';
  next();
}

// Verifies the _csrf field on POST requests against the session token.
// Skips routes whose path starts with any of the `exemptPrefixes`.
function csrfVerify(exemptPrefixes = []) {
  return function (req, res, next) {
    if (req.method !== 'POST') return next();
    if (exemptPrefixes.some((p) => req.path.startsWith(p))) return next();
    const sent = req.body && req.body._csrf;
    const expected = req.session && req.session.csrfToken;
    if (!sent || !expected || sent !== expected) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: 'Invalid session token. Please reload the page and try again.',
        stack: null,
      });
    }
    next();
  };
}

module.exports = { csrfIssue, csrfVerify };
