import cors from "cors";
import express from "express";
import { z } from "zod";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { piApprovePayment, piCompletePayment, piGetMe } from "./piPlatform.js";
import { getBalanceCredits } from "./logic/balance.js";
import { creditDepositIfComplete, upsertUserFromMe } from "./logic/payments.js";
import { spin } from "./logic/spin.js";

const app = express();
app.use(
  cors({
    origin: env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(","),
  }),
);
app.use(express.json({ limit: "256kb" }));

app.get("/health", (req, res) => res.json({ ok: true }));

// --- Auth ---
// Client sends accessToken; server verifies /me and returns our internal user + balance.
app.post("/api/auth/verify", async (req, res) => {
  const Body = z.object({ accessToken: z.string().min(10) });
  const { accessToken } = Body.parse(req.body);

  const me = await piGetMe(accessToken);
  const user = await upsertUserFromMe(me);
  const balanceCredits = await getBalanceCredits(user.id);

  res.json({
    user: { id: user.id, piUid: user.piUid, username: user.username },
    balanceCredits,
    creditsPerPi: env.CREDITS_PER_PI,
  });
});

// --- Payments (U2A) ---
app.post("/api/payments/:paymentId/approve", async (req, res) => {
  const paymentId = z.string().min(5).parse(req.params.paymentId);
  const Body = z.object({ accessToken: z.string().min(10) });
  const { accessToken } = Body.parse(req.body);

  // Verify user identity and bind payment to that user in our DB for audit.
  const me = await piGetMe(accessToken);
  const user = await upsertUserFromMe(me);

  const dto = await piApprovePayment(paymentId);
  await prisma.payment.upsert({
    where: { piPaymentId: dto.identifier },
    update: { userId: user.id },
    create: {
      piPaymentId: dto.identifier,
      direction: dto.direction,
      network: dto.network,
      amountPi: dto.amount,
      memo: dto.memo ?? "",
      metadata: dto.metadata ?? {},
      txid: dto.transaction?.txid ?? null,
      statusDeveloperApproved: !!dto.status?.developer_approved,
      statusTransactionVerified: !!dto.status?.transaction_verified,
      statusDeveloperCompleted: !!dto.status?.developer_completed,
      statusCancelled: !!dto.status?.cancelled,
      statusUserCancelled: !!dto.status?.user_cancelled,
      userId: user.id,
    },
  });

  res.json({ ok: true });
});

app.post("/api/payments/:paymentId/complete", async (req, res) => {
  const paymentId = z.string().min(5).parse(req.params.paymentId);
  const Body = z.object({ accessToken: z.string().min(10), txid: z.string().min(5) });
  const { accessToken, txid } = Body.parse(req.body);

  const me = await piGetMe(accessToken);
  const user = await upsertUserFromMe(me);

  // Tell Pi we received txid (required to close payment flow)
  await piCompletePayment(paymentId, txid);

  // Credit only after we can verify completion from Pi (authoritative)
  const result = await creditDepositIfComplete({ userId: user.id, piPaymentId: paymentId });
  const balanceCredits = await getBalanceCredits(user.id);

  res.json({ ok: true, result, balanceCredits, creditsPerPi: env.CREDITS_PER_PI });
});

// --- Balance ---
app.post("/api/balance", async (req, res) => {
  const Body = z.object({ accessToken: z.string().min(10) });
  const { accessToken } = Body.parse(req.body);

  const me = await piGetMe(accessToken);
  const user = await upsertUserFromMe(me);
  const balanceCredits = await getBalanceCredits(user.id);

  res.json({ balanceCredits, creditsPerPi: env.CREDITS_PER_PI });
});

// --- Slot spin ---
app.post("/api/spin", async (req, res) => {
  const Body = z.object({
    accessToken: z.string().min(10),
    betCredits: z.number().int().positive(),
  });
  const { accessToken, betCredits } = Body.parse(req.body);

  const me = await piGetMe(accessToken);
  const user = await upsertUserFromMe(me);

  const result = await spin({ userId: user.id, betCredits });
  res.json(result);
});

// --- Error handler ---
app.use((err, req, res, next) => {
  const status = err?.status && Number.isInteger(err.status) ? err.status : 400;
  res.status(status).json({
    error: err?.code ?? err?.message ?? "UNKNOWN_ERROR",
    details: err?.body ?? undefined,
  });
});

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`slotpi-backend listening on http://localhost:${env.PORT}`);
});


