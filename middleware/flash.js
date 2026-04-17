// Minimal one-shot flash messages. Set via setFlash(req, ...), read once from res.locals.flash.
function flashMiddleware(req, res, next) {
  res.locals.flash = null;
  if (req.session && req.session.flash) {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
  }
  next();
}

function setFlash(req, type, message) {
  if (!req.session) return;
  req.session.flash = { type, message };
}

module.exports = { flashMiddleware, setFlash };
