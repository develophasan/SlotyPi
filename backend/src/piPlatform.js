import { env } from "./env.js";

async function piFetch(path, { method = "GET", headers = {}, body } = {}) {
  const url = `${env.PI_API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!res.ok) {
    const err = new Error(`Pi API error ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = json ?? text;
    throw err;
  }

  return json;
}

export async function piGetMe(accessToken) {
  return await piFetch("/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function piGetPayment(paymentId) {
  return await piFetch(`/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Key ${env.PI_SERVER_API_KEY}` },
  });
}

export async function piApprovePayment(paymentId) {
  return await piFetch(`/payments/${encodeURIComponent(paymentId)}/approve`, {
    method: "POST",
    headers: { Authorization: `Key ${env.PI_SERVER_API_KEY}` },
  });
}

export async function piCompletePayment(paymentId, txid) {
  return await piFetch(`/payments/${encodeURIComponent(paymentId)}/complete`, {
    method: "POST",
    headers: { Authorization: `Key ${env.PI_SERVER_API_KEY}` },
    body: { txid },
  });
}


