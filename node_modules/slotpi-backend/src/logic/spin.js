import { prisma } from "../db.js";
import { getBalanceCredits } from "./balance.js";

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Very simple placeholder paytable; we'll tune RTP later.
// Returns multiplier (e.g. 0, 1, 2, 5, 10)
function sampleMultiplier() {
  const r = Math.random();
  if (r < 0.60) return 0; // 60% lose
  if (r < 0.85) return 1; // 25% break-even
  if (r < 0.95) return 2; // 10% double
  if (r < 0.99) return 5; // 4% x5
  return 10; // 1% x10
}

export async function spin({ userId, betCredits }) {
  if (!Number.isInteger(betCredits) || betCredits <= 0) {
    throw new Error("INVALID_BET");
  }
  if (betCredits > 10_000) {
    throw new Error("BET_TOO_LARGE");
  }

  const spinId = `spin_${Date.now()}_${randInt(1000, 9999)}`;

  return await prisma.$transaction(async (tx) => {
    const bal = await getBalanceCredits(userId);
    if (bal < betCredits) {
      const err = new Error("INSUFFICIENT_BALANCE");
      err.code = "INSUFFICIENT_BALANCE";
      throw err;
    }

    await tx.ledgerEntry.create({
      data: {
        userId,
        type: "BET",
        amountCredits: -betCredits,
        refType: "spin",
        refId: spinId,
        meta: JSON.stringify({ betCredits }),
      },
    });

    const multiplier = sampleMultiplier();
    const winCredits = betCredits * multiplier;

    if (winCredits > 0) {
      await tx.ledgerEntry.create({
        data: {
          userId,
          type: "PAYOUT",
          amountCredits: winCredits,
          refType: "spin",
          refId: spinId,
          meta: JSON.stringify({ betCredits, multiplier, winCredits }),
        },
      });
    }

    const newBal = await tx.ledgerEntry.aggregate({
      where: { userId },
      _sum: { amountCredits: true },
    });

    return {
      spinId,
      betCredits,
      multiplier,
      winCredits,
      balanceCredits: newBal._sum.amountCredits ?? 0,
    };
  });
}


