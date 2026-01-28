import { prisma } from "../db.js";
import { getBalanceCredits } from "./balance.js";
import { playGame, processBonusPick } from "./game.js";

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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

    // Play the game
    const gameResult = playGame(betCredits);
    const winCredits = gameResult.totalWin;

    if (winCredits > 0) {
      await tx.ledgerEntry.create({
        data: {
          userId,
          type: "PAYOUT",
          amountCredits: winCredits,
          refType: "spin",
          refId: spinId,
          meta: JSON.stringify({
            betCredits,
            winCredits,
            clusters: gameResult.clusters.length,
            multipliers: gameResult.multipliers,
            bonusTriggered: gameResult.bonusTriggered,
            bonusBoard: gameResult.bonusBoard,
          }),
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
      winCredits,
      balanceCredits: newBal._sum.amountCredits ?? 0,
      gameResult: {
        initialGrid: gameResult.grid,
        clusters: gameResult.clusters,
        cascadeSteps: gameResult.cascadeSteps,
        multipliers: gameResult.multipliers,
        bonusTriggered: gameResult.bonusTriggered,
        bonusBoard: gameResult.bonusBoard,
      },
    };
  });
}

export async function bonusPick({ userId, spinId, picks }) {
  // Retrieve bonus board from spin metadata (check both BET and PAYOUT entries)
  const spinEntry = await prisma.ledgerEntry.findFirst({
    where: {
      refType: "spin",
      refId: spinId,
      userId,
      OR: [{ type: "BET" }, { type: "PAYOUT" }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (!spinEntry) throw new Error("SPIN_NOT_FOUND");

  const meta = JSON.parse(spinEntry.meta || "{}");
  if (!meta.bonusBoard) throw new Error("NO_BONUS_BOARD");

  const result = processBonusPick(meta.bonusBoard, picks);
  const bonusWin = result.win;

  if (bonusWin > 0) {
    await prisma.ledgerEntry.create({
      data: {
        userId,
        type: "PAYOUT",
        amountCredits: bonusWin,
        refType: "bonus_pick",
        refId: `${spinId}_bonus`,
        meta: JSON.stringify({ spinId, picks, bonusWin }),
      },
    });
  }

  const newBal = await prisma.ledgerEntry.aggregate({
    where: { userId },
    _sum: { amountCredits: true },
  });

  return {
    bonusWin,
    matched: result.matched,
    balanceCredits: newBal._sum.amountCredits ?? 0,
  };
}


