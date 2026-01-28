import { z } from "zod";

// Lokal geliştirmede: http://localhost:8787
// Production'da (Netlify): VITE_API_BASE env değişkeni ile Railway backend URL'i verilecek.
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  `${window.location.protocol}//${window.location.hostname}:8787`;

const state = {
  accessToken: null,
  user: null,
  balanceCredits: 0,
  creditsPerPi: 100,
  lastSpin: null,
  lastError: null,
};

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

function fmt(n) {
  return new Intl.NumberFormat("tr-TR").format(n);
}

async function api(path, { method = "POST", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? "API_ERROR");
  return json;
}

async function login() {
  // Basit tıklama testi ve Pi SDK kontrolü
  if (!window.Pi || typeof window.Pi.authenticate !== "function") {
    state.lastError = "PI_SDK_UNAVAILABLE";
    render();
    return;
  }

  state.lastError = null;
  const scopes = ["payments", "username"];

  try {
    const auth = await window.Pi.authenticate(scopes, async (payment) => {
      // If there is an incomplete payment, we forward it to backend completion path.
      // Our backend will verify and credit (if applicable).
      try {
        if (payment?.identifier && payment?.transaction?.txid) {
          await api(`/api/payments/${payment.identifier}/complete`, {
            body: { accessToken: state.accessToken, txid: payment.transaction.txid },
          });
        }
      } catch (e) {
        console.warn("incomplete payment handling failed", e);
      }
    });

    state.accessToken = auth.accessToken;
    const verified = await api("/api/auth/verify", { body: { accessToken: state.accessToken } });
    state.user = verified.user;
    state.balanceCredits = verified.balanceCredits;
    state.creditsPerPi = verified.creditsPerPi;
  } catch (e) {
    state.lastError = e?.message ?? "AUTH_FAILED";
  }

  render();
}

async function refreshBalance() {
  if (!state.accessToken) return;
  const r = await api("/api/balance", { body: { accessToken: state.accessToken } });
  state.balanceCredits = r.balanceCredits;
  state.creditsPerPi = r.creditsPerPi;
  render();
}

async function deposit(amountPi) {
  state.lastError = null;
  const amount = Number(amountPi);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");

  window.Pi.createPayment(
    {
      amount,
      memo: `SlotPi bakiye yükleme (${amount}π => ${Math.floor(amount * state.creditsPerPi)} kredi)`,
      metadata: { kind: "deposit", creditsPerPi: state.creditsPerPi },
    },
    {
      onReadyForServerApproval: async (paymentId) => {
        await api(`/api/payments/${paymentId}/approve`, {
          body: { accessToken: state.accessToken },
        });
      },
      onReadyForServerCompletion: async (paymentId, txid) => {
        const r = await api(`/api/payments/${paymentId}/complete`, {
          body: { accessToken: state.accessToken, txid },
        });
        state.balanceCredits = r.balanceCredits;
        render();
      },
      onCancel: async () => {
        state.lastError = "PAYMENT_CANCELLED";
        render();
      },
      onError: async (error) => {
        state.lastError = error?.message ?? "PAYMENT_ERROR";
        render();
      },
    },
  );
}

async function doSpin(betCredits) {
  state.lastError = null;
  const bet = Number(betCredits);
  if (!Number.isInteger(bet) || bet <= 0) throw new Error("INVALID_BET");

  const r = await api("/api/spin", { body: { accessToken: state.accessToken, betCredits: bet } });
  state.lastSpin = r;
  state.balanceCredits = r.balanceCredits;
  render();
}

function render() {
  const root = document.querySelector("#app");
  root.innerHTML = "";

  const header = el("div", { class: "card" }, [
    el("div", { class: "title" }, ["SlotPi"]),
    el("div", { class: "subtitle" }, ["Pi ile bakiye + ledger + slot spin demo"]),
  ]);

  const authBlock = el("div", { class: "card" }, [
    el("div", { class: "row" }, [
      el("div", {}, [state.user ? `Giriş: ${state.user.username ?? state.user.piUid}` : "Giriş yok"]),
      el(
        "button",
        {
          class: "btn",
          onClick: async () => {
            try {
              await login();
            } catch (e) {
              state.lastError = e.message;
              render();
            }
          },
        },
        [state.user ? "Yenile" : "Pi ile giriş yap"],
      ),
    ]),
    state.user
      ? el("div", { class: "row" }, [
          el("div", { class: "pill" }, [`Bakiye: ${fmt(state.balanceCredits)} kredi`]),
          el("button", { class: "btn secondary", onClick: refreshBalance }, ["Bakiye yenile"]),
        ])
      : el("div", { class: "muted" }, ["Ödeme / bakiye için önce giriş yap."]),
  ]);

  const depositBlock = el("div", { class: "card" }, [
    el("div", { class: "sectionTitle" }, ["Bakiye yükle (U2A)"]),
    el("div", { class: "muted" }, [`Kur: 1π = ${state.creditsPerPi} kredi`]),
    el("div", { class: "row" }, [
      el("input", { id: "amountPi", class: "input", placeholder: "π miktarı (örn 1)", inputmode: "decimal" }),
      el(
        "button",
        {
          class: "btn",
          onClick: async () => {
            try {
              if (!state.user) throw new Error("LOGIN_REQUIRED");
              const amountPi = document.querySelector("#amountPi").value;
              await deposit(amountPi);
            } catch (e) {
              state.lastError = e.message;
              render();
            }
          },
        },
        ["Yükle"],
      ),
    ]),
  ]);

  const spinBlock = el("div", { class: "card" }, [
    el("div", { class: "sectionTitle" }, ["Spin"]),
    el("div", { class: "row" }, [
      el("input", { id: "betCredits", class: "input", placeholder: "bahis (kredi) (örn 100)", inputmode: "numeric" }),
      el(
        "button",
        {
          class: "btn",
          onClick: async () => {
            try {
              if (!state.user) throw new Error("LOGIN_REQUIRED");
              const bet = document.querySelector("#betCredits").value;
              await doSpin(bet);
            } catch (e) {
              state.lastError = e.message;
              render();
            }
          },
        },
        ["Çevir"],
      ),
    ]),
    state.lastSpin
      ? el("div", { class: "result" }, [
          el("div", {}, [`Spin: ${state.lastSpin.spinId}`]),
          el("div", {}, [`Bahis: ${fmt(state.lastSpin.betCredits)} kredi`]),
          el("div", {}, [`Çarpan: x${state.lastSpin.multiplier}`]),
          el("div", {}, [`Kazanç: ${fmt(state.lastSpin.winCredits)} kredi`]),
        ])
      : el("div", { class: "muted" }, ["Henüz spin yok."]),
  ]);

  const err = state.lastError ? el("div", { class: "error" }, [`Hata: ${state.lastError}`]) : null;

  root.append(
    header,
    authBlock,
    depositBlock,
    spinBlock,
    err ?? el("div", {}, [""]),
    el("style", {}, [
      `
      :root { --bg:#0b1020; --card:#121a32; --muted:#a7b0d6; --text:#e8ecff; --primary:#7c5cff; --border:#253058; --danger:#ff4d6d; }
      body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background: radial-gradient(1200px 600px at 20% 0%, #1a2450 0%, var(--bg) 60%); color:var(--text); }
      #app { max-width: 820px; margin: 24px auto; padding: 0 16px 40px; display:flex; flex-direction:column; gap:12px; }
      .card { background: rgba(18,26,50,0.92); border:1px solid var(--border); border-radius:14px; padding:14px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
      .title { font-size: 20px; font-weight: 800; letter-spacing: 0.2px; }
      .subtitle { color: var(--muted); margin-top: 4px; font-size: 13px; }
      .row { display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap: wrap; margin-top: 10px; }
      .btn { background: linear-gradient(135deg, var(--primary), #4dd7ff); color:#0b1020; border:0; border-radius: 12px; padding: 10px 12px; font-weight: 700; cursor:pointer; }
      .btn.secondary { background: transparent; color: var(--text); border:1px solid var(--border); }
      .input { flex: 1; min-width: 220px; background: rgba(11,16,32,0.6); border: 1px solid var(--border); color: var(--text); padding: 10px 12px; border-radius: 12px; outline: none; }
      .muted { color: var(--muted); font-size: 13px; margin-top: 8px; }
      .sectionTitle { font-weight: 800; }
      .pill { background: rgba(124,92,255,0.18); border:1px solid rgba(124,92,255,0.35); padding: 8px 10px; border-radius: 999px; font-weight: 700; }
      .result { margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(167,176,214,0.25); color: var(--text); display:flex; flex-direction:column; gap: 2px; }
      .error { border: 1px solid rgba(255,77,109,0.45); background: rgba(255,77,109,0.12); padding: 10px 12px; border-radius: 12px; color: var(--text); }
      `
    ]),
  );
}

render();


