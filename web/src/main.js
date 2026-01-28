import { z } from "zod";

// Lokal geliştirmede: http://localhost:8787
// Production'da (Railway): VITE_BACKEND_URL env değişkeni ile Railway backend URL'i verilecek.
const API_BASE =
  import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.MODE === "production"
    ? "https://slotypi-backend-production.up.railway.app"
    : "http://localhost:8787");

const state = {
  accessToken: null,
  user: null,
  balanceCredits: 0,
  creditsPerPi: 100,
  currentPage: "home", // home, game, account, deposit
  lastSpin: null,
  lastError: null,
  gameState: null,
  bonusBoard: null,
  bonusPicks: [],
  isSpinning: false,
};

const BET_OPTIONS = [10, 20, 50, 100, 200, 500];
let currentBet = BET_OPTIONS[0];

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
  state.lastError = null;
  if (!window.Pi) {
    state.lastError = "PI_SDK_UNAVAILABLE";
    render();
    return;
  }

  const scopes = ["payments", "username"];

  const auth = await window.Pi.authenticate(scopes, async (payment) => {
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
  localStorage.setItem("pi_accessToken", state.accessToken);
  
  const verified = await api("/api/auth/verify", { body: { accessToken: state.accessToken } });
  state.user = verified.user;
  state.balanceCredits = verified.balanceCredits;
  state.creditsPerPi = verified.creditsPerPi;
  render();
}

async function restoreSession() {
  const savedToken = localStorage.getItem("pi_accessToken");
  if (!savedToken) return;
  
  try {
    state.accessToken = savedToken;
    const verified = await api("/api/auth/verify", { body: { accessToken: state.accessToken } });
    state.user = verified.user;
    state.balanceCredits = verified.balanceCredits;
    state.creditsPerPi = verified.creditsPerPi;
    render();
  } catch (e) {
    // Token geçersiz, temizle
    localStorage.removeItem("pi_accessToken");
    state.accessToken = null;
    state.user = null;
  }
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
        // Balance'ı tekrar çek (backend'den güncel hali)
        await refreshBalance();
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

async function doSpin() {
  if (state.isSpinning) return;
  state.lastError = null;
  
  if (!state.accessToken) {
    state.lastError = "Giriş yapmanız gerekiyor";
    render();
    return;
  }
  
  if (state.balanceCredits < currentBet) {
    state.lastError = `Yetersiz bakiye! Gerekli: ${currentBet} kredi`;
    render();
    return;
  }
  
  state.isSpinning = true;
  render();

  try {
    const r = await api("/api/spin", {
      body: { accessToken: state.accessToken, betCredits: currentBet },
    });
    
    state.lastSpin = r;
    state.balanceCredits = r.balanceCredits;
    state.gameState = r.gameResult;

    if (r.gameResult?.bonusTriggered) {
      state.bonusBoard = r.gameResult.bonusBoard;
      state.currentPage = "bonus";
    }

    render();

    // Win celebration animation
    if (r.winCredits > 0) {
      showWinCelebration(r.winCredits);
    }

    // Update grid immediately
    if (r.gameResult?.initialGrid) {
      updateGameGrid(r.gameResult.initialGrid);
    }

    // Cascade animation
    if (r.gameResult?.cascadeSteps?.length > 0) {
      setTimeout(() => animateCascade(r.gameResult), 500);
    }
  } catch (e) {
    console.error("Spin error:", e);
    state.lastError = e.message || "Spin hatası oluştu";
    render();
  } finally {
    state.isSpinning = false;
    render();
  }
}

function showWinCelebration(winCredits) {
  const celebration = el("div", { class: "win-celebration" }, [
    el("div", { class: "win-text" }, [`🎉 ${fmt(winCredits)} KAZANDIN! 🎉`]),
  ]);
  document.body.appendChild(celebration);
  setTimeout(() => celebration.remove(), 3000);
}

async function animateCascade(gameResult) {
  if (!gameResult?.cascadeSteps) return;

  for (let stepIdx = 0; stepIdx < gameResult.cascadeSteps.length; stepIdx++) {
    const step = gameResult.cascadeSteps[stepIdx];
    
    // Highlight matched clusters
    const cells = document.querySelectorAll(".game-cell");
    cells.forEach((cell) => {
      cell.classList.remove("matched");
    });
    
    for (const cluster of step.clusters) {
      for (const { row, col } of cluster.cells) {
        const idx = row * 6 + col;
        if (cells[idx]) {
          cells[idx].classList.add("matched");
        }
      }
    }

    // Wait for animation
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Update grid for next cascade
    if (stepIdx < gameResult.cascadeSteps.length - 1) {
      const nextStep = gameResult.cascadeSteps[stepIdx + 1];
      updateGameGrid(nextStep.grid);
    }
  }

  // Clear highlights
  const cells = document.querySelectorAll(".game-cell");
  cells.forEach((cell) => {
    cell.classList.remove("matched");
  });
}

function updateGameGrid(grid) {
  const cells = document.querySelectorAll(".game-cell");
  grid.forEach((row, rowIdx) => {
    row.forEach((symbol, colIdx) => {
      const idx = rowIdx * 6 + colIdx;
      if (cells[idx]) {
        const cell = cells[idx];
        cell.classList.add("cascade");
        setTimeout(() => {
          cell.textContent = symbol;
          cell.className = `game-cell symbol-${symbol} cascade`;
          cell.setAttribute("data-symbol", symbol);
          setTimeout(() => cell.classList.remove("cascade"), 500);
        }, 50);
      }
    });
  });
}

function renderHome() {
  return el("div", { class: "page home-page" }, [
    el("div", { class: "home-header" }, [
      el("div", { class: "logo" }, ["🎰 SlotPi"]),
      el("div", { class: "subtitle" }, ["Şans Ağacı"]),
    ]),
    el("div", { class: "home-content" }, [
      el("div", { class: "balance-card" }, [
        el("div", { class: "balance-label" }, ["Bakiye"]),
        el("div", { class: "balance-value" }, [fmt(state.balanceCredits)]),
        el("div", { class: "balance-unit" }, ["kredi"]),
      ]),
      el("button", { class: "btn-primary large", onClick: () => { state.currentPage = "game"; render(); } }, [
        "🎮 OYNA",
      ]),
      el("button", { class: "btn-secondary", onClick: () => { state.currentPage = "deposit"; render(); } }, [
        "💰 Bakiye Yükle",
      ]),
    ]),
  ]);
}

function renderGame() {
  // Default empty grid if no game state
  const defaultGrid = Array(5).fill(null).map(() => Array(6).fill("?"));
  const grid = state.gameState?.initialGrid || defaultGrid;

  return el("div", { class: "page game-page" }, [
    el("div", { class: "game-header" }, [
      el("div", { class: "game-balance" }, [`${fmt(state.balanceCredits)} kredi`]),
      el("div", { class: "bet-selector" }, [
        ...BET_OPTIONS.map((bet) =>
          el(
            "button",
            {
              class: `bet-btn ${currentBet === bet ? "active" : ""}`,
              onClick: () => {
                currentBet = bet;
                render();
              },
            },
            [bet],
          ),
        ),
      ]),
    ]),
    el("div", { class: "game-board" }, [
      ...grid.map((row, rowIdx) =>
        el("div", { class: "game-row" }, [
          ...row.map((symbol, colIdx) =>
            el("div", { class: `game-cell symbol-${symbol}`, "data-symbol": symbol }, [symbol]),
          ),
        ]),
      ),
    ]),
    el("div", { class: "game-controls" }, [
      el("button", {
        class: `spin-btn ${state.isSpinning ? "spinning" : ""}`,
        onClick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log("Spin button clicked", { 
            isSpinning: state.isSpinning, 
            hasToken: !!state.accessToken, 
            balance: state.balanceCredits, 
            bet: currentBet 
          });
          doSpin();
        },
        disabled: state.isSpinning || !state.accessToken || state.balanceCredits < currentBet,
      }, [state.isSpinning ? "⏳" : "🎰 ÇEVİR"]),
    ]),
    ...(state.lastSpin && state.lastSpin.winCredits > 0
      ? [el("div", { class: "last-win" }, [`Son Kazanç: ${fmt(state.lastSpin.winCredits)} kredi`])]
      : []),
  ]);
}

function renderBonus() {
  if (!state.bonusBoard) {
    state.currentPage = "game";
    render();
    return null;
  }

  return el("div", { class: "page bonus-page" }, [
    el("div", { class: "bonus-header" }, ["🎁 BONUS TURU"]),
    el("div", { class: "bonus-board" }, [
      ...state.bonusBoard.map((prize, idx) =>
        el("div", {
          class: `bonus-box ${state.bonusPicks.includes(idx) ? "picked" : ""}`,
          onClick: () => {
            if (state.bonusPicks.length < 3 && !state.bonusPicks.includes(idx)) {
              state.bonusPicks.push(idx);
              render();
              if (state.bonusPicks.length === 3) {
                processBonusPicks();
              }
            }
          },
        }, [state.bonusPicks.includes(idx) ? prize : "?"]),
      ),
    ]),
    el("div", { class: "bonus-hint" }, ["3 kutu seç (JOKER her ödülle eşleşir)"]),
  ]);
}

async function processBonusPicks() {
  if (!state.lastSpin || state.bonusPicks.length !== 3) return;
  try {
    const r = await api("/api/bonus-pick", {
      body: {
        accessToken: state.accessToken,
        spinId: state.lastSpin.spinId,
        picks: state.bonusPicks,
      },
    });
    state.balanceCredits = r.balanceCredits;
    if (r.bonusWin > 0) {
      showWinCelebration(r.bonusWin);
      setTimeout(() => {
        state.currentPage = "game";
        state.bonusBoard = null;
        state.bonusPicks = [];
        render();
      }, 3000);
    } else {
      state.currentPage = "game";
      state.bonusBoard = null;
      state.bonusPicks = [];
      render();
    }
  } catch (e) {
    state.lastError = e.message;
    render();
  }
}

function renderDeposit() {
  return el("div", { class: "page deposit-page" }, [
    el("div", { class: "deposit-header" }, ["💰 Bakiye Yükle"]),
    el("div", { class: "deposit-content" }, [
      el("div", { class: "rate-info" }, [`Kur: 1π = ${state.creditsPerPi} kredi`]),
      el("input", {
        id: "amountPi",
        class: "input",
        placeholder: "π miktarı (örn: 1)",
        inputmode: "decimal",
      }),
      el("button", {
        class: "btn-primary",
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
      }, ["Yükle"]),
    ]),
  ]);
}

function renderAccount() {
  return el("div", { class: "page account-page" }, [
    el("div", { class: "account-header" }, ["👤 Hesap"]),
    el("div", { class: "account-content" }, [
      state.user
        ? el("div", { class: "user-info" }, [
            el("div", {}, [`Kullanıcı: ${state.user.username || state.user.piUid}`]),
            el("div", { class: "balance-info" }, [`Bakiye: ${fmt(state.balanceCredits)} kredi`]),
            el("button", { class: "btn-secondary", onClick: refreshBalance }, ["Bakiye Yenile"]),
          ])
        : el("button", { class: "btn-primary", onClick: login }, ["Pi ile Giriş Yap"]),
    ]),
  ]);
}

function renderBottomMenu() {
  return el("div", { class: "bottom-menu" }, [
    el("button", {
      class: `menu-item ${state.currentPage === "home" ? "active" : ""}`,
      onClick: () => {
        state.currentPage = "home";
        render();
      },
    }, ["🏠", el("span", {}, ["Ana Sayfa"])]),
    el("button", {
      class: `menu-item ${state.currentPage === "game" ? "active" : ""}`,
      onClick: () => {
        state.currentPage = "game";
        render();
      },
    }, ["🎮", el("span", {}, ["Oyun"])]),
    el("button", {
      class: `menu-item ${state.currentPage === "deposit" ? "active" : ""}`,
      onClick: () => {
        state.currentPage = "deposit";
        render();
      },
    }, ["💰", el("span", {}, ["Yükle"])]),
    el("button", {
      class: `menu-item ${state.currentPage === "account" ? "active" : ""}`,
      onClick: () => {
        state.currentPage = "account";
        render();
      },
    }, ["👤", el("span", {}, ["Hesap"])]),
  ]);
}

function render() {
  const root = document.querySelector("#app");
  root.innerHTML = "";

  let pageContent = null;
  if (state.currentPage === "home") pageContent = renderHome();
  else if (state.currentPage === "game") pageContent = renderGame();
  else if (state.currentPage === "bonus") pageContent = renderBonus();
  else if (state.currentPage === "deposit") pageContent = renderDeposit();
  else if (state.currentPage === "account") pageContent = renderAccount();

  const err = state.lastError ? el("div", { class: "error-toast" }, [`⚠️ ${state.lastError}`]) : null;

  const elementsToAppend = [pageContent, renderBottomMenu()];
  if (err) elementsToAppend.push(err);
  elementsToAppend.push(el("style", {}, [
      `
      :root {
        --bg: #0a0e27;
        --card: #121a32;
        --muted: #7c8db5;
        --text: #e8ecff;
        --primary: #00d4ff;
        --primary-dark: #0099cc;
        --accent: #ffd700;
        --accent-dark: #ffaa00;
        --danger: #ff4d6d;
        --success: #00ff88;
        --border: #253058;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        background: radial-gradient(ellipse at top, #1a2450 0%, var(--bg) 60%);
        color: var(--text);
        overflow-x: hidden;
        padding-bottom: 80px;
      }
      #app { min-height: 100vh; }
      
      .page { padding: 20px 16px; max-width: 600px; margin: 0 auto; }
      
      /* Home Page */
      .home-header { text-align: center; margin: 40px 0; }
      .logo {
        font-size: 48px;
        font-weight: 900;
        background: linear-gradient(135deg, var(--primary), var(--accent));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-shadow: 0 0 30px rgba(0, 212, 255, 0.5);
        margin-bottom: 8px;
      }
      .subtitle {
        color: var(--muted);
        font-size: 18px;
        font-weight: 600;
      }
      .balance-card {
        background: linear-gradient(135deg, rgba(0, 212, 255, 0.15), rgba(255, 215, 0, 0.15));
        border: 2px solid var(--primary);
        border-radius: 20px;
        padding: 24px;
        text-align: center;
        margin: 20px 0;
        box-shadow: 0 0 40px rgba(0, 212, 255, 0.3);
      }
      .balance-label { color: var(--muted); font-size: 14px; margin-bottom: 8px; }
      .balance-value {
        font-size: 36px;
        font-weight: 900;
        color: var(--accent);
        text-shadow: 0 0 20px rgba(255, 215, 0, 0.6);
      }
      .balance-unit { color: var(--muted); font-size: 14px; margin-top: 4px; }
      
      .btn-primary, .btn-secondary {
        width: 100%;
        padding: 16px;
        border: none;
        border-radius: 16px;
        font-size: 18px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.3s;
        margin: 8px 0;
      }
      .btn-primary {
        background: linear-gradient(135deg, var(--primary), var(--primary-dark));
        color: var(--bg);
        box-shadow: 0 4px 20px rgba(0, 212, 255, 0.4);
      }
      .btn-primary:active { transform: scale(0.98); }
      .btn-primary.large { font-size: 24px; padding: 20px; }
      .btn-secondary {
        background: transparent;
        border: 2px solid var(--primary);
        color: var(--primary);
      }
      
      /* Game Page */
      .game-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        flex-wrap: wrap;
        gap: 12px;
      }
      .game-balance {
        font-size: 20px;
        font-weight: 700;
        color: var(--accent);
        text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
      }
      .bet-selector {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .bet-btn {
        padding: 8px 16px;
        border: 2px solid var(--border);
        background: var(--card);
        color: var(--text);
        border-radius: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
      }
      .bet-btn.active {
        border-color: var(--primary);
        background: var(--primary);
        color: var(--bg);
        box-shadow: 0 0 15px rgba(0, 212, 255, 0.5);
      }
      
      .game-board {
        background: rgba(18, 26, 50, 0.8);
        border: 3px solid var(--primary);
        border-radius: 20px;
        padding: 16px;
        margin: 20px 0;
        box-shadow: 0 0 40px rgba(0, 212, 255, 0.3);
        display: grid;
        grid-template-rows: repeat(5, 1fr);
        gap: 8px;
        aspect-ratio: 6/5;
      }
      .game-row {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 8px;
      }
      .game-cell {
        aspect-ratio: 1;
        background: linear-gradient(135deg, rgba(0, 212, 255, 0.1), rgba(255, 215, 0, 0.1));
        border: 2px solid var(--border);
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        font-weight: 700;
        color: var(--text);
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }
      .game-cell::before {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(45deg, transparent 30%, rgba(255, 255, 255, 0.2) 50%, transparent 70%);
        transform: translateX(-100%);
        transition: transform 0.8s;
      }
      .game-cell.matched {
        border-color: var(--success);
        background: linear-gradient(135deg, rgba(0, 255, 136, 0.3), rgba(255, 215, 0, 0.3));
        box-shadow: 0 0 20px rgba(0, 255, 136, 0.6);
        animation: match-pulse 0.6s ease-out;
        transform: scale(1.1);
      }
      .game-cell.matched::before {
        transform: translateX(100%);
      }
      @keyframes match-pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.2); }
        100% { transform: scale(1.1); }
      }
      .game-cell.cascade {
        animation: cascade-fall 0.5s ease-out;
      }
      @keyframes cascade-fall {
        0% { transform: translateY(-100%); opacity: 0; }
        100% { transform: translateY(0); opacity: 1; }
      }
      .game-cell.symbol-A { color: #ff6b6b; }
      .game-cell.symbol-B { color: #4ecdc4; }
      .game-cell.symbol-C { color: #ffe66d; }
      .game-cell.symbol-D { color: #a8e6cf; }
      .game-cell.symbol-E { color: #ff8b94; }
      .game-cell.symbol-KEY { color: var(--accent); }
      .game-cell.symbol-MULT_2X { color: var(--primary); }
      .game-cell.symbol-MULT_3X { color: var(--accent); }
      
      .game-controls {
        text-align: center;
        margin: 24px 0;
      }
      .spin-btn {
        padding: 20px 60px;
        font-size: 24px;
        font-weight: 900;
        border: none;
        border-radius: 50px;
        background: linear-gradient(135deg, var(--primary), var(--accent));
        color: var(--bg);
        cursor: pointer;
        box-shadow: 0 6px 30px rgba(0, 212, 255, 0.5);
        transition: all 0.3s;
        min-width: 200px;
      }
      .spin-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .spin-btn.spinning {
        animation: spin-pulse 1s infinite;
      }
      @keyframes spin-pulse {
        0%, 100% { transform: scale(1); box-shadow: 0 6px 30px rgba(0, 212, 255, 0.5); }
        50% { transform: scale(1.05); box-shadow: 0 8px 40px rgba(0, 212, 255, 0.8); }
      }
      .last-win {
        text-align: center;
        color: var(--success);
        font-size: 18px;
        font-weight: 700;
        margin-top: 16px;
        text-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
      }
      
      /* Bonus Page */
      .bonus-header {
        text-align: center;
        font-size: 32px;
        font-weight: 900;
        color: var(--accent);
        margin: 20px 0;
        text-shadow: 0 0 20px rgba(255, 215, 0, 0.6);
      }
      .bonus-board {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin: 24px 0;
      }
      .bonus-box {
        aspect-ratio: 1;
        background: linear-gradient(135deg, rgba(0, 212, 255, 0.2), rgba(255, 215, 0, 0.2));
        border: 3px solid var(--primary);
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        font-weight: 700;
        color: var(--text);
        cursor: pointer;
        transition: all 0.3s;
      }
      .bonus-box:active { transform: scale(0.95); }
      .bonus-box.picked {
        background: linear-gradient(135deg, var(--primary), var(--accent));
        color: var(--bg);
        box-shadow: 0 0 20px rgba(0, 212, 255, 0.6);
      }
      .bonus-hint {
        text-align: center;
        color: var(--muted);
        font-size: 14px;
        margin-top: 16px;
      }
      
      /* Deposit Page */
      .deposit-header, .account-header {
        text-align: center;
        font-size: 28px;
        font-weight: 900;
        margin: 20px 0;
        color: var(--primary);
      }
      .deposit-content, .account-content {
        background: rgba(18, 26, 50, 0.8);
        border: 2px solid var(--border);
        border-radius: 20px;
        padding: 24px;
        margin: 20px 0;
      }
      .rate-info {
        color: var(--muted);
        text-align: center;
        margin-bottom: 16px;
      }
      .input {
        width: 100%;
        padding: 16px;
        background: rgba(11, 16, 32, 0.6);
        border: 2px solid var(--border);
        border-radius: 12px;
        color: var(--text);
        font-size: 18px;
        margin: 12px 0;
      }
      .input:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 15px rgba(0, 212, 255, 0.3);
      }
      
      /* Bottom Menu */
      .bottom-menu {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(10, 14, 39, 0.95);
        backdrop-filter: blur(10px);
        border-top: 2px solid var(--primary);
        display: flex;
        justify-content: space-around;
        padding: 12px 0;
        z-index: 1000;
        box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.5);
      }
      .menu-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        background: transparent;
        border: none;
        color: var(--muted);
        font-size: 12px;
        cursor: pointer;
        padding: 8px 16px;
        transition: all 0.3s;
      }
      .menu-item span { font-size: 12px; }
      .menu-item.active {
        color: var(--primary);
        text-shadow: 0 0 10px rgba(0, 212, 255, 0.6);
      }
      .menu-item:active { transform: scale(0.9); }
      
      /* Win Celebration */
      .win-celebration {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2000;
        animation: win-pop 0.5s ease-out;
      }
      .win-text {
        font-size: 48px;
        font-weight: 900;
        background: linear-gradient(135deg, var(--primary), var(--accent));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-shadow: 0 0 30px rgba(0, 212, 255, 0.8);
        animation: win-pulse 0.5s infinite;
      }
      @keyframes win-pop {
        0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
        50% { transform: translate(-50%, -50%) scale(1.2); }
        100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      }
      @keyframes win-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }
      
      /* Error Toast */
      .error-toast {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255, 77, 109, 0.9);
        border: 2px solid var(--danger);
        border-radius: 12px;
        padding: 12px 24px;
        color: var(--text);
        font-weight: 700;
        z-index: 1500;
        animation: slide-down 0.3s ease-out;
      }
      @keyframes slide-down {
        0% { transform: translateX(-50%) translateY(-100%); opacity: 0; }
        100% { transform: translateX(-50%) translateY(0); opacity: 1; }
      }
      
      @media (max-width: 480px) {
        .game-board { padding: 12px; gap: 6px; }
        .game-cell { font-size: 18px; }
        .bet-selector { justify-content: center; }
        .logo { font-size: 36px; }
      }
      `,
    ]));

  root.append(...elementsToAppend);
}

// Sayfa yüklendiğinde session'ı restore et
restoreSession().then(() => {
  render();
});
