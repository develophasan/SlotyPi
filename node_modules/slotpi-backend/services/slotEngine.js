const { v4: uuidv4 } = require('uuid');

// Slot machine configuration
const REELS = 3;
const SYMBOLS_PER_REEL = 3;
const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '🔔', '⭐', '💎', '7️⃣'];

// Payout table: [symbol, count, multiplier]
const PAYOUT_TABLE = [
  ['7️⃣', 3, 100],  // Triple 7 = 100x
  ['💎', 3, 50],   // Triple diamond = 50x
  ['⭐', 3, 25],   // Triple star = 25x
  ['🔔', 3, 15],  // Triple bell = 15x
  ['🍇', 3, 10],  // Triple grape = 10x
  ['🍊', 3, 5],   // Triple orange = 5x
  ['🍋', 3, 3],   // Triple lemon = 3x
  ['🍒', 3, 2],   // Triple cherry = 2x
  ['7️⃣', 2, 10],  // Double 7 = 10x
  ['💎', 2, 5],   // Double diamond = 5x
  ['⭐', 2, 3],   // Double star = 3x
  ['🔔', 2, 2],   // Double bell = 2x
];

/**
 * Generate random symbol
 */
const getRandomSymbol = () => {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
};

/**
 * Generate spin result (3x3 grid)
 */
const generateSpin = () => {
  const reels = [];
  for (let i = 0; i < REELS; i++) {
    const reel = [];
    for (let j = 0; j < SYMBOLS_PER_REEL; j++) {
      reel.push(getRandomSymbol());
    }
    reels.push(reel);
  }
  return reels;
};

/**
 * Check for winning lines
 */
const checkWinLines = (reels) => {
  const winLines = [];
  
  // Check horizontal lines (middle row is primary)
  for (let row = 0; row < SYMBOLS_PER_REEL; row++) {
    const line = reels.map(reel => reel[row]);
    const win = checkLine(line);
    if (win) {
      winLines.push({
        type: 'horizontal',
        row,
        symbols: line,
        multiplier: win.multiplier,
        matchCount: win.count
      });
    }
  }

  // Check diagonal lines
  // Top-left to bottom-right
  const diag1 = [reels[0][0], reels[1][1], reels[2][2]];
  const win1 = checkLine(diag1);
  if (win1) {
    winLines.push({
      type: 'diagonal',
      direction: 'top-left-bottom-right',
      symbols: diag1,
      multiplier: win1.multiplier,
      matchCount: win1.count
    });
  }

  // Bottom-left to top-right
  const diag2 = [reels[0][2], reels[1][1], reels[2][0]];
  const win2 = checkLine(diag2);
  if (win2) {
    winLines.push({
      type: 'diagonal',
      direction: 'bottom-left-top-right',
      symbols: diag2,
      multiplier: win2.multiplier,
      matchCount: win2.count
    });
  }

  return winLines;
};

/**
 * Check if a line has a winning combination
 */
const checkLine = (line) => {
  // Count consecutive matching symbols from left
  const firstSymbol = line[0];
  let count = 1;
  
  for (let i = 1; i < line.length; i++) {
    if (line[i] === firstSymbol) {
      count++;
    } else {
      break;
    }
  }

  // Check payout table
  for (const [symbol, requiredCount, multiplier] of PAYOUT_TABLE) {
    if (firstSymbol === symbol && count >= requiredCount) {
      return { count, multiplier };
    }
  }

  return null;
};

/**
 * Calculate total payout from win lines
 */
const calculatePayout = (winLines, betAmount) => {
  if (winLines.length === 0) return 0;
  
  // Sum multipliers from all win lines
  const totalMultiplier = winLines.reduce((sum, line) => sum + line.multiplier, 0);
  return Math.floor(betAmount * totalMultiplier);
};

/**
 * Execute a spin
 */
const spin = (betAmount) => {
  const reels = generateSpin();
  const winLines = checkWinLines(reels);
  const payout = calculatePayout(winLines, betAmount);
  const multiplier = winLines.length > 0 
    ? winLines.reduce((sum, line) => sum + line.multiplier, 0) 
    : 0;

  return {
    reels,
    winLines,
    payout,
    multiplier,
    won: payout > 0
  };
};

module.exports = {
  spin,
  REELS,
  SYMBOLS_PER_REEL,
  SYMBOLS,
  PAYOUT_TABLE
};

