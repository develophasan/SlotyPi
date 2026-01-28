const db = require('../database/init').getDb();
const { v4: uuidv4 } = require('uuid');

const PI_TO_COIN_RATIO = parseInt(process.env.PI_TO_COIN_RATIO) || 100;

/**
 * Get user balance in coins
 */
const getBalance = (userId) => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT balance_coins FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.balance_coins : 0);
      }
    );
  });
};

/**
 * Add ledger entry and update balance
 */
const addLedgerEntry = (userId, transactionType, amountCoins, metadata = {}) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      // Insert ledger entry
      db.run(
        `INSERT INTO ledger (user_id, transaction_type, amount_coins, payment_id, txid, game_session_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          transactionType,
          amountCoins,
          metadata.paymentId || null,
          metadata.txid || null,
          metadata.gameSessionId || null,
          JSON.stringify(metadata)
        ],
        function(err) {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }

          // Update user balance
          const balanceChange = amountCoins;
          db.run(
            'UPDATE users SET balance_coins = balance_coins + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [balanceChange, userId],
            (err) => {
              if (err) {
                db.run('ROLLBACK');
                return reject(err);
              }

              db.run('COMMIT', (err) => {
                if (err) return reject(err);
                resolve(this.lastID);
              });
            }
          );
        }
      );
    });
  });
};

/**
 * Deposit coins from Pi payment
 */
const depositCoins = async (userId, amountPi, paymentId, txid) => {
  const amountCoins = Math.floor(amountPi * PI_TO_COIN_RATIO);
  await addLedgerEntry(userId, 'DEPOSIT_CONFIRMED', amountCoins, {
    paymentId,
    txid,
    amountPi
  });
  return amountCoins;
};

/**
 * Place a bet (deduct from balance)
 */
const placeBet = async (userId, betAmountCoins, gameSessionId) => {
  const currentBalance = await getBalance(userId);
  if (currentBalance < betAmountCoins) {
    throw new Error('Insufficient balance');
  }

  await addLedgerEntry(userId, 'BET_PLACED', -betAmountCoins, {
    gameSessionId
  });
  return await getBalance(userId);
};

/**
 * Add payout (win)
 */
const addPayout = async (userId, payoutAmountCoins, gameSessionId) => {
  if (payoutAmountCoins > 0) {
    await addLedgerEntry(userId, 'PAYOUT', payoutAmountCoins, {
      gameSessionId
    });
  }
  return await getBalance(userId);
};

/**
 * Get ledger history for user
 */
const getLedgerHistory = (userId, limit = 50) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM ledger 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT ?`,
      [userId, limit],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(row => ({
          ...row,
          metadata: row.metadata ? JSON.parse(row.metadata) : {}
        })));
      }
    );
  });
};

module.exports = {
  getBalance,
  depositCoins,
  placeBet,
  addPayout,
  getLedgerHistory,
  PI_TO_COIN_RATIO
};

