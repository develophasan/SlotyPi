import { prisma } from "../db.js";

export async function getBalanceCredits(userId) {
  const agg = await prisma.ledgerEntry.aggregate({
    where: { userId },
    _sum: { amountCredits: true },
  });
  return agg._sum.amountCredits ?? 0;
}


