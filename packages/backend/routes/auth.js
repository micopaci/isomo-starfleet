const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const pool     = require('../db');

const router = express.Router();

function getSignOptions() {
  if (process.env.JWT_PRIVATE_KEY && process.env.JWT_PRIVATE_KEY.startsWith('-----BEGIN')) {
    return { key: process.env.JWT_PRIVATE_KEY, options: { algorithm: 'RS256', expiresIn: '12h' } };
  }
  // Dev fallback: symmetric HS256
  return { key: process.env.JWT_SECRET || 'dev-secret-change-me', options: { algorithm: 'HS256', expiresIn: '12h' } };
}

/**
 * POST /auth/login
 * Body: { email, password }
 * Returns: { token }
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user   = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { key, options } = getSignOptions();
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      key,
      options
    );

    res.json({ token });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
