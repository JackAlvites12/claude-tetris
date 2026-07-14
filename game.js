'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#3f51b5', // J - indigo
  '#fb8c00', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const SPECIAL_LINE_INTERVAL = 5;
const SPECIAL_TYPES = ['bomb', 'lightning', 'dye', 'gravity', 'freeze'];
const SPECIAL_ICONS = { bomb: '💣', lightning: '⚡', dye: '🎨', gravity: '🌀', freeze: '❄️' };
const SPECIAL_LABELS = { bomb: '¡BOMBA!', lightning: '¡RAYO!', dye: '¡TINTE!', gravity: '¡GRAVEDAD!', freeze: '¡CONGELAR!' };
const SPECIAL_CELL_SCORE = 10;
const SPECIAL_FLAT_SCORE = 50;
const FREEZE_DURATION_MS = 5000;
const BANNER_DURATION_MS = 1200;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const specialBannerEl = document.getElementById('special-banner');
const freezeIndicatorEl = document.getElementById('freeze-indicator');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let specialLineCounter, pendingSpecial, freezeUntil, bannerText, bannerUntil;

const THEME_STORAGE_KEY = 'tetris-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  themeToggleBtn.setAttribute('aria-label', theme === 'light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro');
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  applyTheme(isLight ? 'dark' : 'light');
}

themeToggleBtn.addEventListener('click', toggleTheme);
applyTheme(localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark');

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0, special: null };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    specialLineCounter += cleared;
    if (specialLineCounter >= SPECIAL_LINE_INTERVAL) {
      specialLineCounter -= SPECIAL_LINE_INTERVAL;
      pendingSpecial = true;
    }
    updateHUD();
  }
}

function pieceCells(piece) {
  const cells = [];
  for (let r = 0; r < piece.shape.length; r++)
    for (let c = 0; c < piece.shape[r].length; c++)
      if (piece.shape[r][c]) cells.push({ x: piece.x + c, y: piece.y + r });
  return cells;
}

function pieceCenterCell(piece) {
  const cells = pieceCells(piece);
  const cx = Math.round(cells.reduce((s, p) => s + p.x, 0) / cells.length);
  const cy = Math.round(cells.reduce((s, p) => s + p.y, 0) / cells.length);
  return { cx, cy };
}

function showBanner(text) {
  bannerText = text;
  bannerUntil = performance.now() + BANNER_DURATION_MS;
}

function effectBomb(piece) {
  const { cx, cy } = pieceCenterCell(piece);
  let removed = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue;
      if (board[y][x]) { board[y][x] = 0; removed++; }
    }
  }
  score += removed * SPECIAL_CELL_SCORE;
}

function effectLightning(piece) {
  const { cx, cy } = pieceCenterCell(piece);
  let removed = 0;
  if (cy >= 0 && cy < ROWS) {
    for (let x = 0; x < COLS; x++) if (board[cy][x]) { board[cy][x] = 0; removed++; }
  }
  if (cx >= 0 && cx < COLS) {
    for (let y = 0; y < ROWS; y++) if (board[y][cx]) { board[y][cx] = 0; removed++; }
  }
  score += removed * SPECIAL_CELL_SCORE;
}

function effectDye() {
  const freq = {};
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c]) freq[board[r][c]] = (freq[board[r][c]] || 0) + 1;
  let targetColor = null, max = 0;
  for (const color of Object.keys(freq)) {
    if (freq[color] > max) { max = freq[color]; targetColor = Number(color); }
  }
  if (targetColor == null) return;
  let removed = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c] === targetColor) { board[r][c] = 0; removed++; }
  score += removed * SPECIAL_CELL_SCORE;
}

function effectGravityCompact() {
  for (let c = 0; c < COLS; c++) {
    const colVals = [];
    for (let r = 0; r < ROWS; r++) if (board[r][c]) colVals.push(board[r][c]);
    const newCol = new Array(ROWS - colVals.length).fill(0).concat(colVals);
    for (let r = 0; r < ROWS; r++) board[r][c] = newCol[r];
  }
  score += SPECIAL_FLAT_SCORE;
}

function effectFreeze() {
  freezeUntil = performance.now() + FREEZE_DURATION_MS;
  score += SPECIAL_FLAT_SCORE;
}

function applySpecialEffect(piece) {
  switch (piece.special) {
    case 'bomb': effectBomb(piece); break;
    case 'lightning': effectLightning(piece); break;
    case 'dye': effectDye(); break;
    case 'gravity': effectGravityCompact(); break;
    case 'freeze': effectFreeze(); break;
  }
  showBanner(`${SPECIAL_ICONS[piece.special]} ${SPECIAL_LABELS[piece.special]}`);
  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  if (current.special) applySpecialEffect(current);
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  if (pendingSpecial) {
    current.special = SPECIAL_TYPES[Math.floor(Math.random() * SPECIAL_TYPES.length)];
    pendingSpecial = false;
  }
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
    return;
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  if (current.special) drawSpecialBadge(ctx, current, BLOCK);
}

function drawSpecialBadge(context, piece, size) {
  const cells = pieceCells(piece);
  const glowAlpha = 0.5 + 0.5 * Math.sin(performance.now() / 150);
  context.save();
  context.strokeStyle = `rgba(255, 213, 79, ${glowAlpha})`;
  context.lineWidth = 3;
  for (const { x, y } of cells) {
    context.strokeRect(x * size + 2, y * size + 2, size - 4, size - 4);
  }
  const minX = Math.min(...cells.map(p => p.x));
  const maxX = Math.max(...cells.map(p => p.x));
  const minY = Math.min(...cells.map(p => p.y));
  const maxY = Math.max(...cells.map(p => p.y));
  const iconX = ((minX + maxX + 1) / 2) * size;
  const iconY = ((minY + maxY + 1) / 2) * size;
  context.font = `${Math.floor(size * 0.8)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.globalAlpha = 1;
  context.fillStyle = '#fff';
  context.shadowColor = 'rgba(0,0,0,0.8)';
  context.shadowBlur = 4;
  context.fillText(SPECIAL_ICONS[piece.special], iconX, iconY);
  context.restore();
}

function updateSpecialUI(ts) {
  if (bannerUntil && ts < bannerUntil) {
    specialBannerEl.textContent = bannerText;
    specialBannerEl.classList.remove('hidden');
  } else {
    bannerUntil = 0;
    specialBannerEl.classList.add('hidden');
  }

  if (freezeUntil && ts < freezeUntil) {
    freezeIndicatorEl.textContent = `❄️ ${Math.ceil((freezeUntil - ts) / 1000)}s`;
    freezeIndicatorEl.classList.remove('hidden');
  } else {
    freezeIndicatorEl.classList.add('hidden');
  }
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  if (gameOver || paused) return;
  const dt = ts - lastTime;
  lastTime = ts;
  if (freezeUntil && ts >= freezeUntil) {
    freezeUntil = 0;
    dropAccum = 0;
  }
  if (!freezeUntil) {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
      } else {
        lockPiece();
      }
    }
  }
  draw();
  updateSpecialUI(ts);
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  specialLineCounter = 0;
  pendingSpecial = false;
  freezeUntil = 0;
  bannerText = '';
  bannerUntil = 0;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  specialBannerEl.classList.add('hidden');
  freezeIndicatorEl.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

init();
