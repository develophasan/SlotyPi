const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const piPlatform = require('../services/piPlatform');
const balanceService = require('../services/balanceService');
const db = require('../database/init').getDb();

/**
 * POST /api/payments/approve
 * Server-Side Approval: Approve a payment from user
 */
router.post('/approve', [
  body('paymentId').notEmpty().withMessage('Payment ID is required'),
  body('piUid').notEmpty().withMessage('Pi UID is required')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { paymentId, piUid } = req.body;

    // Get user
    db.get('SELECT id FROM users WHERE pi_uid = ?', [piUid], async (err, user) => {
      if (err) return next(err);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Check if payment already exists
      db.get(
        'SELECT * FROM payments WHERE payment_id = ?',
        [paymentId],
        async (err, existingPayment) => {
          if (err) return next(err);

          if (existingPayment && existingPayment.status === 'approved') {
            return res.json({
              success: true,
              message: 'Payment already approved',
              payment: existingPayment
            });
          }

          // Approve payment with Pi Platform
          const approval = await piPlatform.approvePayment(paymentId);
          if (!approval.success) {
            return res.status(400).json({
              error: 'Failed to approve payment',
              details: approval.error
            });
          }

          const payment = approval.payment;

          // Save payment record
          if (existingPayment) {
            db.run(
              `UPDATE payments SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE payment_id = ?`,
              [paymentId],
              (err) => {
                if (err) return next(err);
                res.json({ success: true, payment });
              }
            );
          } else {
            db.run(
              `INSERT INTO payments (id, user_id, payment_id, amount_pi, amount_coins, direction, status, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                paymentId,
                user.id,
                paymentId,
                payment.amount,
                Math.floor(payment.amount * balanceService.PI_TO_COIN_RATIO),
                payment.direction,
                'approved',
                JSON.stringify(payment)
              ],
              (err) => {
                if (err) return next(err);
                res.json({ success: true, payment });
              }
            );
          }
        }
      );
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/payments/complete
 * Server-Side Completion: Complete a payment after blockchain transaction
 */
router.post('/complete', [
  body('paymentId').notEmpty().withMessage('Payment ID is required'),
  body('txid').notEmpty().withMessage('Transaction ID is required'),
  body('piUid').notEmpty().withMessage('Pi UID is required')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { paymentId, txid, piUid } = req.body;

    // Get user
    db.get('SELECT id FROM users WHERE pi_uid = ?', [piUid], async (err, user) => {
      if (err) return next(err);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Complete payment with Pi Platform
      const completion = await piPlatform.completePayment(paymentId, txid);
      if (!completion.success) {
        return res.status(400).json({
          error: 'Failed to complete payment',
          details: completion.error
        });
      }

      const payment = completion.payment;

      // Verify payment status
      if (!payment.status.developer_completed || !payment.status.transaction_verified) {
        return res.status(400).json({
          error: 'Payment verification failed',
          payment
        });
      }

      // Check if already processed
      db.get(
        'SELECT * FROM payments WHERE payment_id = ?',
        [paymentId],
        async (err, existingPayment) => {
          if (err) return next(err);

          if (existingPayment && existingPayment.status === 'completed') {
            return res.json({
              success: true,
              message: 'Payment already completed',
              payment: existingPayment
            });
          }

          // Update payment status
          db.run(
            `UPDATE payments SET status = 'completed', txid = ?, updated_at = CURRENT_TIMESTAMP WHERE payment_id = ?`,
            [txid, paymentId],
            async (err) => {
              if (err) return next(err);

              // Only deposit if this is a user-to-app payment
              if (payment.direction === 'user_to_app') {
                try {
                  const coinsAdded = await balanceService.depositCoins(
                    user.id,
                    payment.amount,
                    paymentId,
                    txid
                  );

                  res.json({
                    success: true,
                    message: 'Payment completed and coins deposited',
                    coinsAdded,
                    payment
                  });
                } catch (depositError) {
                  console.error('Error depositing coins:', depositError);
                  // Payment is completed on Pi side, but we failed to deposit
                  // This should be handled by a reconciliation process
                  res.status(500).json({
                    error: 'Payment completed but deposit failed',
                    payment
                  });
                }
              } else {
                res.json({
                  success: true,
                  message: 'Payment completed',
                  payment
                });
              }
            }
          );
        }
      );
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/payments/:paymentId
 * Get payment details
 */
router.get('/:paymentId', async (req, res, next) => {
  try {
    const { paymentId } = req.params;

    db.get(
      'SELECT * FROM payments WHERE payment_id = ?',
      [paymentId],
      (err, payment) => {
        if (err) return next(err);
        if (!payment) {
          return res.status(404).json({ error: 'Payment not found' });
        }
        res.json({ success: true, payment });
      }
    );
  } catch (error) {
    next(error);
  }
});

module.exports = router;

