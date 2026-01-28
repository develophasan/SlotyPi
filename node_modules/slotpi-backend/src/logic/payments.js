import { prisma } from "../db.js";
import { env } from "../env.js";
import { piGetPayment } from "../piPlatform.js";

function piToCredits(amountPi) {
  // amountPi comes as number from Pi API DTO; we convert using configured exchange rate
  // Rounding rule: floor to avoid giving free credits due to floating precision.
  return Math.floor(Number(amountPi) * env.CREDITS_PER_PI);
}

export async function upsertUserFromMe(me) {
  const { uid, username } = me;
  return await prisma.user.upsert({
    where: { piUid: uid },
    update: { username: username ?? undefined },
    create: { piUid: uid, username: username ?? null },
  });
}

export async function recordPaymentFromPiDTO(userId, dto) {
  // Keep a local copy of the payment status for audit/debugging.
  const direction = dto.direction;
  const network = dto.network;
  const amountPi = dto.amount;
  const memo = dto.memo ?? "";
  const metadata = JSON.stringify(dto.metadata ?? {});
  const txid = dto.transaction?.txid ?? null;

  return await prisma.payment.upsert({
    where: { piPaymentId: dto.identifier },
    update: {
      direction,
      network,
      amountPi,
      memo,
      metadata,
      txid,
      statusDeveloperApproved: !!dto.status?.developer_approved,
      statusTransactionVerified: !!dto.status?.transaction_verified,
      statusDeveloperCompleted: !!dto.status?.developer_completed,
      statusCancelled: !!dto.status?.cancelled,
      statusUserCancelled: !!dto.status?.user_cancelled,
    },
    create: {
      piPaymentId: dto.identifier,
      direction,
      network,
      amountPi,
      memo,
      metadata,
      txid,
      statusDeveloperApproved: !!dto.status?.developer_approved,
      statusTransactionVerified: !!dto.status?.transaction_verified,
      statusDeveloperCompleted: !!dto.status?.developer_completed,
      statusCancelled: !!dto.status?.cancelled,
      statusUserCancelled: !!dto.status?.user_cancelled,
      userId,
    },
  });
}

export async function creditDepositIfComplete({ userId, piPaymentId }) {
  // Fetch the authoritative payment state from Pi
  const dto = await piGetPayment(piPaymentId);
  const payment = await recordPaymentFromPiDTO(userId, dto);

  // Only credit for user_to_app, verified transaction, and developer completed.
  if (payment.direction !== "user_to_app") {
    return { credited: false, reason: "NOT_U2A", payment };
  }
  if (!payment.statusTransactionVerified) {
    return { credited: false, reason: "TX_NOT_VERIFIED", payment };
  }
  if (!payment.statusDeveloperCompleted) {
    return { credited: false, reason: "NOT_COMPLETED", payment };
  }
  if (payment.statusCancelled || payment.statusUserCancelled) {
    return { credited: false, reason: "CANCELLED", payment };
  }

  // Idempotent crediting using unique constraint on (refType, refId, type)
  const credits = piToCredits(payment.amountPi);
  if (credits <= 0) {
    return { credited: false, reason: "NON_POSITIVE_AMOUNT", payment };
  }

  const res = await prisma.$transaction(async (tx) => {
    const existingCredit = await tx.ledgerEntry.findFirst({
      where: {
        userId,
        refType: "pi_payment",
        refId: payment.piPaymentId,
        type: "DEPOSIT_CREDIT",
      },
    });
    if (existingCredit) {
      return { credited: false, reason: "ALREADY_CREDITED", payment };
    }

    const entry = await tx.ledgerEntry.create({
      data: {
        userId,
        type: "DEPOSIT_CREDIT",
        amountCredits: credits,
        refType: "pi_payment",
        refId: payment.piPaymentId,
        meta: JSON.stringify({
          amountPi: Number(payment.amountPi),
          creditsPerPi: env.CREDITS_PER_PI,
        }),
      },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { creditedLedgerEntryId: entry.id },
    });

    return { credited: true, reason: "OK", payment, entry };
  });

  return res;
}


