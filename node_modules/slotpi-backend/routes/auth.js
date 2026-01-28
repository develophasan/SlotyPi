const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const piPlatform = require('../services/piPlatform');
const db = require('../database/init').getDb();

/**
 * POST /api/auth/verify
 * Verify user access token and create/update user in database
 */
router.post('/verify', [
  body('accessToken').notEmpty().withMessage('Access token is required'),
  body('piUid').notEmpty().withMessage('Pi UID is required'),
  body('username').optional()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { accessToken, piUid, username } = req.body;

    // Verify token with Pi Platform API
    const verification = await piPlatform.verifyUser(accessToken);
    if (!verification.success) {
      return res.status(401).json({ error: 'Invalid access token' });
    }

    // Get or create user
    db.get(
      'SELECT * FROM users WHERE pi_uid = ?',
      [piUid],
      async (err, user) => {
        if (err) return next(err);

        if (user) {
          // Update existing user
          db.run(
            'UPDATE users SET username = ?, access_token_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE pi_uid = ?',
            [username || user.username, accessToken.substring(0, 20), piUid],
            (err) => {
              if (err) return next(err);
              res.json({
                success: true,
                user: {
                  id: user.id,
                  piUid: user.pi_uid,
                  username: username || user.username,
                  balanceCoins: user.balance_coins
                }
              });
            }
          );
        } else {
          // Create new user
          db.run(
            'INSERT INTO users (pi_uid, username, access_token_hash) VALUES (?, ?, ?)',
            [piUid, username || null, accessToken.substring(0, 20)],
            function(err) {
              if (err) return next(err);
              res.json({
                success: true,
                user: {
                  id: this.lastID,
                  piUid,
                  username: username || null,
                  balanceCoins: 0
                }
              });
            }
          );
        }
      }
    );
  } catch (error) {
    next(error);
  }
});

module.exports = router;

