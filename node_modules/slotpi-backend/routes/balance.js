const express = require('express');
const router = express.Router();
const balanceService = require('../services/balanceService');
const db = require('../database/init').getDb();

/**
 * GET /api/balance
 * Get user balance
 */
router.get('/', (req, res, next) => {
  const { piUid } = req.query;

  if (!piUid) {
    return res.status(400).json({ error: 'Pi UID is required' });
  }

  db.get('SELECT id, balance_coins FROM users WHERE pi_uid = ?', [piUid], async (err, user) => {
    if (err) return next(err);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const balance = await balanceService.getBalance(user.id);
    res.json({
      success: true,
      balance: balance,
      piUid
    });
  });
});

/**
 * GET /api/balance/history
 * Get ledger history
 */
router.get('/history', (req, res, next) => {
  const { piUid, limit = 50 } = req.query;

  if (!piUid) {
    return res.status(400).json({ error: 'Pi UID is required' });
  }

  db.get('SELECT id FROM users WHERE pi_uid = ?', [piUid], async (err, user) => {
    if (err) return next(err);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    try {
      const history = await balanceService.getLedgerHistory(user.id, parseInt(limit));
      res.json({
        success: true,
        history
      });
    } catch (error) {
      next(error);
    }
  });
});

module.exports = router;

