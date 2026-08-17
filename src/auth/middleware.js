const bcrypt = require('bcryptjs');

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.redirect('/login');
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compareSync(password, passwordHash);
}

module.exports = { requireAuth, verifyPassword };
