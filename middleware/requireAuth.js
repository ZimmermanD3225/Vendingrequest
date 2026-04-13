function requireAuth(req, res, next) {
  if (!req.session || !req.session.operatorId) {
    return res.redirect('/login');
  }
  next();
}

module.exports = requireAuth;
