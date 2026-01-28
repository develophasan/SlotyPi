// Cluster-based slot game engine (Şans Ağacı style)

const GRID_COLS = 6;
const GRID_ROWS = 5;

// Symbol types
const SYMBOLS = {
  A: { id: "A", value: 1 },
  B: { id: "B", value: 2 },
  C: { id: "C", value: 3 },
  D: { id: "D", value: 4 },
  E: { id: "E", value: 5 },
  KEY: { id: "KEY", value: 0, special: "bonus_trigger" },
  MULT_2X: { id: "MULT_2X", value: 0, special: "multiplier", mult: 2 },
  MULT_3X: { id: "MULT_3X", value: 0, special: "multiplier", mult: 3 },
  BIG_2X2: { id: "BIG_2X2", value: 0, special: "big_symbol", size: 2 },
  BIG_3X3: { id: "BIG_3X3", value: 0, special: "big_symbol", size: 3 },
};

// Paytable: cluster size => multiplier
const PAYTABLE = {
  3: 1, // 3 matching = 1x bet
  4: 2, // 4 matching = 2x bet
  5: 6, // 5 matching = 5x bet
  6: 10, // 6+ matching = 10x bet
};

// Symbol weights for random generation
const SYMBOL_WEIGHTS = [
  { symbol: "A", weight: 30 },
  { symbol: "B", weight: 25 },
  { symbol: "C", weight: 20 },
  { symbol: "D", weight: 15 },
  { symbol: "E", weight: 8 },
  { symbol: "KEY", weight: 1.5 },
  { symbol: "MULT_2X", weight: 0.4 },
  { symbol: "MULT_3X", weight: 0.1 },
];

function weightedRandom(weights) {
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let r = Math.random() * total;
  for (const w of weights) {
    r -= w.weight;
    if (r <= 0) return w.symbol;
  }
  return weights[0].symbol;
}

function generateGrid() {
  const grid = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    grid[row] = [];
    for (let col = 0; col < GRID_COLS; col++) {
      grid[row][col] = weightedRandom(SYMBOL_WEIGHTS);
    }
  }
  return grid;
}

// Find all clusters (connected groups of 3+ same symbols)
function findClusters(grid) {
  const visited = new Set();
  const clusters = [];

  function dfs(row, col, symbol, cluster) {
    const key = `${row},${col}`;
    if (visited.has(key)) return;
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return;
    if (grid[row][col] !== symbol) return;

    visited.add(key);
    cluster.push({ row, col });

    // Check neighbors (horizontal + vertical only)
    dfs(row - 1, col, symbol, cluster);
    dfs(row + 1, col, symbol, cluster);
    dfs(row, col - 1, symbol, cluster);
    dfs(row, col + 1, symbol, cluster);
  }

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const key = `${row},${col}`;
      if (visited.has(key)) continue;

      const symbol = grid[row][col];
      // Skip special symbols for cluster detection
      if (SYMBOLS[symbol]?.special) continue;

      const cluster = [];
      dfs(row, col, symbol, cluster);

      if (cluster.length >= 3) {
        clusters.push({ symbol, cells: cluster });
      }
    }
  }

  return clusters;
}

// Apply cascade: remove matched cells, drop symbols from above
function applyCascade(grid, matchedCells) {
  const toRemove = new Set(matchedCells.map((c) => `${c.row},${c.col}`));

  // Remove matched cells
  for (const { row, col } of matchedCells) {
    grid[row][col] = null;
  }

  // Drop symbols down
  for (let col = 0; col < GRID_COLS; col++) {
    const column = [];
    for (let row = GRID_ROWS - 1; row >= 0; row--) {
      if (grid[row][col] !== null) {
        column.push(grid[row][col]);
      }
    }
    // Fill from top with new symbols
    while (column.length < GRID_ROWS) {
      column.push(weightedRandom(SYMBOL_WEIGHTS));
    }
    // Write back
    for (let row = GRID_ROWS - 1; row >= 0; row--) {
      grid[row][col] = column[GRID_ROWS - 1 - row];
    }
  }
}

// Calculate win from clusters
function calculateClusterWin(clusters, betCredits) {
  let totalWin = 0;
  for (const cluster of clusters) {
    const size = cluster.cells.length;
    const multiplier = PAYTABLE[size] || PAYTABLE[6];
    totalWin += betCredits * multiplier;
  }
  return totalWin;
}

// Find multipliers on board
function findMultipliers(grid) {
  const multipliers = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const sym = grid[row][col];
      if (sym === "MULT_2X") multipliers.push(2);
      if (sym === "MULT_3X") multipliers.push(3);
    }
  }
  return multipliers;
}

// Check for bonus trigger (3 keys)
function checkBonusTrigger(grid) {
  let keyCount = 0;
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (grid[row][col] === "KEY") keyCount++;
    }
  }
  return keyCount >= 3;
}

// Bonus round: pick 3 matching prizes
function generateBonusRound() {
  const prizes = ["10", "25", "50", "100", "200", "500", "1000", "JOKER"];
  const board = [];
  for (let i = 0; i < 12; i++) {
    board.push(prizes[Math.floor(Math.random() * prizes.length)]);
  }
  return board;
}

// Main game play function
export function playGame(betCredits) {
  const initialGrid = generateGrid();
  // Deep copy for cascade processing
  const workingGrid = JSON.parse(JSON.stringify(initialGrid));
  const gameState = {
    initialGrid: initialGrid, // Keep original for display
    grid: workingGrid,
    totalWin: 0,
    clusters: [],
    multipliers: [],
    bonusTriggered: false,
    bonusBoard: null,
    bonusWin: 0,
    cascadeSteps: [],
  };

  // Step 1: Find initial clusters
  let clusters = findClusters(gameState.grid);
  if (clusters.length === 0) {
    return gameState;
  }

  // Step 2: Process cascades until no more matches
  let cascadeCount = 0;
  while (clusters.length > 0 && cascadeCount < 10) {
    const step = {
      grid: JSON.parse(JSON.stringify(gameState.grid)),
      clusters: JSON.parse(JSON.stringify(clusters)),
      win: calculateClusterWin(clusters, betCredits),
    };

    gameState.totalWin += step.win;
    gameState.clusters.push(...clusters);

    const allMatchedCells = clusters.flatMap((c) => c.cells);
    applyCascade(gameState.grid, allMatchedCells);

    gameState.cascadeSteps.push(step);

    clusters = findClusters(gameState.grid);
    cascadeCount++;
  }

  // Step 3: Apply multipliers (sum them, multiply total win)
  gameState.multipliers = findMultipliers(gameState.initialGrid);
  if (gameState.multipliers.length > 0) {
    const totalMult = gameState.multipliers.reduce((sum, m) => sum + m, 0);
    gameState.totalWin = Math.floor(gameState.totalWin * totalMult);
  }

  // Step 4: Check bonus trigger
  gameState.bonusTriggered = checkBonusTrigger(gameState.initialGrid);
  if (gameState.bonusTriggered) {
    gameState.bonusBoard = generateBonusRound();
    // Bonus win calculated separately (not multiplied)
    // For now, return bonus board; actual win calculated when user picks
  }

  return gameState;
}

// Bonus round pick result
export function processBonusPick(bonusBoard, picks) {
  // picks is array of 3 indices
  const selected = picks.map((i) => bonusBoard[i]);
  const counts = {};
  for (const prize of selected) {
    counts[prize] = (counts[prize] || 0) + 1;
  }

  // Check for JOKER
  const hasJoker = selected.includes("JOKER");
  if (hasJoker) {
    // JOKER matches any other prize
    const nonJoker = selected.filter((p) => p !== "JOKER");
    if (nonJoker.length >= 2) {
      const prize = nonJoker[0];
      return { win: parseInt(prize, 10), matched: [prize, prize, "JOKER"] };
    }
  }

  // Check for 3 matching
  for (const [prize, count] of Object.entries(counts)) {
    if (count >= 3) {
      return { win: parseInt(prize, 10), matched: [prize, prize, prize] };
    }
  }

  return { win: 0, matched: selected };
}

