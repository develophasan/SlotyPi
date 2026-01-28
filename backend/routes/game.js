const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const slotEngine = require('../services/slotEngine');
const balanceService = require('../services/balanceService');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/init').getDb();

/**
 * POST /api/game/spin
 * Execute a slot spin
 */
router.post('/spin', [
  body('betAmount').isInt({ min: parseInt(process.env.MIN_BET) || 10 }).withMessage('Valid bet amount is required'),
  body('piUid').notEmpty().withMessage('Pi UID is required')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { betAmount, piUid } = req.body;

    // Get user
    db.get('SELECT id, balance_coins FROM users WHERE pi_uid = ?', [piUid], async (err, user) => {
      if (err) return next(err);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Check balance
      if (user.balance_coins < betAmount) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }

      // Check max bet
      const maxBet = parseInt(process.env.MAX_BET) || 1000;
      if (betAmount > maxBet) {
        return res.status(400).json({ error: `Maximum bet is ${maxBet} coins` });
      }

      try {
        // Create game session
        const sessionId = uuidv4();

        // Place bet (deduct from balance)
        await balanceService.placeBet(user.id, betAmount, sessionId);

        // Execute spin
        const spinResult = slotEngine.spin(betAmount);

        // Add payout if won
        if (spinResult.payout > 0) {
          await balanceService.addPayout(user.id, spinResult.payout, sessionId);
        }

        // Save game session
        db.run(
          `INSERT INTO game_sessions (id, user_id, bet_amount, payout_amount, reels_result, win_lines, multiplier, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionId,
            user.id,
            betAmount,
            spinResult.payout,
            JSON.stringify(spinResult.reels),
            JSON.stringify(spinResult.winLines),
            spinResult.multiplier,
            'completed'
          ],
          (err) => {
            if (err) return next(err);

            // Get updated balance
            balanceService.getBalance(user.id).then(newBalance => {
              res.json({
                success: true,
                sessionId,
                spin: {
                  reels: spinResult.reels,
                  winLines: spinResult.winLines,
                  payout: spinResult.payout,
                  multiplier: spinResult.multiplier,
                  won: spinResult.won
                },
                balance: newBalance,
                betAmount
              });
            }).catch(next);
          }
        );
      } catch (gameError) {
        next(gameError);
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/game/history
 * Get game history for user
 */
router.get('/history', [
  body('piUid').notEmpty().withMessage('Pi UID is required')
], async (req, res, next) => {
  try {
    const { piUid } = req.query;

    db.get('SELECT id FROM users WHERE pi_uid = ?', [piUid], (err, user) => {
      if (err) return next(err);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      db.all(
        `SELECT * FROM game_sessions 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT 50`,
        [user.id],
        (err, sessions) => {
          if (err) return next(err);
          res.json({
            success: true,
            sessions: sessions.map(session => ({
              ...session,
              reels_result: JSON.parse(session.reels_result),
              win_lines: JSON.parse(session.win_lines)
            }))
          });
        }
      );
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

