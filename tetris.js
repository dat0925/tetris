/*
  MIT License
  Copyright (c) 2024 YourName
*/
// テトリス本体ロジック
const COLS = 10, ROWS = 20, BLOCK = 48;
const FIELD_W = COLS * BLOCK, FIELD_H = ROWS * BLOCK;
const COLORS = {
  I: getComputedStyle(document.documentElement).getPropertyValue('--I').trim(),
  O: getComputedStyle(document.documentElement).getPropertyValue('--O').trim(),
  T: getComputedStyle(document.documentElement).getPropertyValue('--T').trim(),
  S: getComputedStyle(document.documentElement).getPropertyValue('--S').trim(),
  Z: getComputedStyle(document.documentElement).getPropertyValue('--Z').trim(),
  J: getComputedStyle(document.documentElement).getPropertyValue('--J').trim(),
  L: getComputedStyle(document.documentElement).getPropertyValue('--L').trim()
};
const SHAPES = {
  I: [[0,1],[1,1],[2,1],[3,1]],
  O: [[1,0],[2,0],[1,1],[2,1]],
  T: [[1,0],[0,1],[1,1],[2,1]],
  S: [[1,0],[2,0],[0,1],[1,1]],
  Z: [[0,0],[1,0],[1,1],[2,1]],
  J: [[0,0],[0,1],[1,1],[2,1]],
  L: [[2,0],[0,1],[1,1],[2,1]]
};
const TETROMINOS = Object.keys(SHAPES);

const field = document.getElementById('field');
const ctx = field.getContext('2d');
const nextCanvas = document.getElementById('next');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const linesEl = document.getElementById('lines');
const restartBtn = document.getElementById('restart');
const touch = {
  left: document.getElementById('left'),
  right: document.getElementById('right'),
  rotate: document.getElementById('rotate'),
  down: document.getElementById('down'),
  drop: document.getElementById('drop')
};

let grid, current, next, bag, score, level, lines, gameOver, softDrop;
let lastFall = 0, fallInterval = 1000;

// === BGM生成・コントロール ===
let audioCtx, bgmNode, gainNode, isBgmPlaying = false;
const bgmBtn = document.getElementById('bgm-toggle');

function createBgm() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  gainNode = audioCtx.createGain();
  gainNode.gain.value = 0.18;
  gainNode.connect(audioCtx.destination);
  // シンプルなチップチューンループ（8小節, 120BPM, 4/4, ループ）
  const tempo = 120;
  const notes = [
    // メロディ（C E G A | F G E C | ...）
    [60, 64, 67, 69, 65, 67, 64, 60, 62, 65, 69, 72, 67, 65, 64, 62],
    // ベース
    [36, 36, 36, 36, 41, 41, 41, 41, 43, 43, 43, 43, 41, 41, 41, 41]
  ];
  const melodyOsc = audioCtx.createOscillator();
  const bassOsc = audioCtx.createOscillator();
  const melodyGain = audioCtx.createGain();
  const bassGain = audioCtx.createGain();
  melodyGain.gain.value = 0.18;
  bassGain.gain.value = 0.12;
  melodyOsc.type = 'square';
  bassOsc.type = 'triangle';
  melodyOsc.connect(melodyGain).connect(gainNode);
  bassOsc.connect(bassGain).connect(gainNode);
  // ノートスケジューリング
  const start = audioCtx.currentTime + 0.05;
  for (let i = 0; i < notes[0].length; i++) {
    const t = start + i * 60 / tempo / 2;
    // メロディ
    melodyOsc.frequency.setValueAtTime(440 * Math.pow(2, (notes[0][i] - 69) / 12), t);
    // ベース
    bassOsc.frequency.setValueAtTime(440 * Math.pow(2, (notes[1][i] - 69) / 12), t);
  }
  // ループ
  const loopLen = notes[0].length * 60 / tempo / 2;
  melodyOsc.start(start);
  bassOsc.start(start);
  melodyOsc.stop(start + loopLen);
  bassOsc.stop(start + loopLen);
  melodyOsc.onended = () => {
    if (isBgmPlaying) {
      bgmNode = null;
      createBgm();
    }
  };
  bgmNode = {melodyOsc, bassOsc};
}
function playBgm() {
  isBgmPlaying = true;
  createBgm();
}
function stopBgm() {
  isBgmPlaying = false;
  if (bgmNode) {
    bgmNode.melodyOsc.onended = null;
    bgmNode.melodyOsc.stop();
    bgmNode.bassOsc.stop();
    bgmNode = null;
  }
}
bgmBtn.addEventListener('click', () => {
  if (!audioCtx) playBgm();
  else if (isBgmPlaying) { stopBgm(); bgmBtn.textContent = '♪ BGM ON'; }
  else { playBgm(); bgmBtn.textContent = '♪ BGM OFF'; }
});
// ゲーム開始・リスタート時にBGM再生
function autoPlayBgm() {
  if (!isBgmPlaying) playBgm();
  bgmBtn.textContent = '♪ BGM OFF';
}

function getNextTetromino() {
  if (!bag || bag.length === 0) {
    bag = TETROMINOS.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop();
}
function createTetromino(type) {
  const shape = SHAPES[type].map(([x, y]) => [x, y]);
  const x = type === 'I' ? 3 : type === 'O' ? 4 : 3;
  return { type, shape, x, y: 0, rotation: 0 };
}
function resetGrid() {
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
}
function initGame() {
  resetGrid();
  score = 0; level = 1; lines = 0;
  fallInterval = 1000;
  gameOver = false;
  next = createTetromino(getNextTetromino());
  spawnTetromino();
  updateScore();
  restartBtn.style.display = 'none';
  field.focus();
  requestAnimationFrame(gameLoop);
  autoPlayBgm();
}
function spawnTetromino() {
  current = next;
  next = createTetromino(getNextTetromino());
  current.x = current.type === 'I' ? 3 : current.type === 'O' ? 4 : 3;
  current.y = 0;
  current.rotation = 0;
  if (collides(current.x, current.y, current.shape)) {
    gameOver = true;
    restartBtn.style.display = '';
    draw();
  }
}
function rotate(piece) {
  if (piece.type === 'O') return piece.shape;
  return piece.shape.map(([x, y]) => [y, -x]);
}
function tryRotate(piece, newShape) {
  const kicks = [[0,0],[1,0],[-1,0],[0,1],[0,-1]];
  for (const [dx, dy] of kicks) {
    if (!collides(piece.x + dx, piece.y + dy, newShape)) {
      piece.shape = newShape;
      piece.x += dx;
      piece.y += dy;
      piece.rotation = (piece.rotation + 1) % 4;
      return true;
    }
  }
  return false;
}
function collides(x, y, shape) {
  for (const [dx, dy] of shape) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return true;
    if (grid[ny][nx]) return true;
  }
  return false;
}
function fixTetromino() {
  for (const [dx, dy] of current.shape) {
    const nx = current.x + dx, ny = current.y + dy;
    if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) {
      grid[ny][nx] = current.type;
      addParticles(nx, ny, COLORS[current.type], 16);
    }
  }
}
function clearLines() {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (grid[y].every(cell => cell)) {
      // ライン消去時のパーティクル効果
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x]) {
          addParticles(x, y, COLORS[grid[y][x]], 8);
        }
      }
      
      grid.splice(y, 1);
      grid.unshift(Array(COLS).fill(''));
      cleared++;
      y++;
    }
  }
  if (cleared > 0) {
    lines += cleared;
    const lineScores = [0, 100, 300, 500, 800];
    score += lineScores[cleared] * level;
    const newLevel = 1 + Math.floor(lines / 10);
    if (newLevel > level) {
      level = newLevel;
      fallInterval = Math.max(100, 1000 - (level - 1) * 80);
    }
    updateScore();
  }
}
function updateScore() {
  scoreEl.textContent = score;
  levelEl.textContent = level;
  linesEl.textContent = lines;
}
function getGhostY() {
  let y = current.y;
  while (!collides(current.x, y + 1, current.shape)) y++;
  return y;
}
function draw() {
  ctx.clearRect(0, 0, FIELD_W, FIELD_H);
  
  // 立体的な背景グリッドを描画
  drawBackgroundGrid();
  
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid[y][x]) drawBlock(x, y, COLORS[grid[y][x]]);
    }
  }
  if (!gameOver) {
    const ghostY = getGhostY();
    for (const [dx, dy] of current.shape) {
      drawGhostBlock(current.x + dx, ghostY + dy);
    }
  }
  if (!gameOver) {
    for (const [dx, dy] of current.shape) {
      drawBlock(current.x + dx, current.y + dy, COLORS[current.type]);
    }
  }
  
  // パーティクルを描画
  updateParticles();
  
  // 立体的な境界線
  drawBorder();
  
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  for (const [dx, dy] of next.shape) {
    drawBlock(dx + 1, dy + 1, COLORS[next.type], nextCtx, 16);
  }
}

// 立体的な背景グリッドを描画
function drawBackgroundGrid() {
  // アンチエイリアスを有効化
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // より精密な背景グラデーション（複数レイヤー）
  const bgGradients = [
    {
      gradient: ctx.createLinearGradient(0, 0, 0, FIELD_H),
      stops: [
        { pos: 0, color: 'rgba(255, 255, 255, 0.03)' },
        { pos: 0.3, color: 'rgba(255, 255, 255, 0.02)' },
        { pos: 0.7, color: 'rgba(255, 255, 255, 0.01)' },
        { pos: 1, color: 'rgba(0, 0, 0, 0.02)' }
      ]
    },
    {
      gradient: ctx.createRadialGradient(FIELD_W/2, 0, 0, FIELD_W/2, FIELD_H, FIELD_H),
      stops: [
        { pos: 0, color: 'rgba(255, 255, 255, 0.01)' },
        { pos: 0.5, color: 'rgba(255, 255, 255, 0.005)' },
        { pos: 1, color: 'rgba(0, 0, 0, 0.01)' }
      ]
    }
  ];
  
  bgGradients.forEach(bg => {
    bg.stops.forEach(stop => {
      bg.gradient.addColorStop(stop.pos, stop.color);
    });
    ctx.fillStyle = bg.gradient;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  });
  
  // より精密なグリッド線（複数の透明度）
  const gridLayers = [
    { alpha: 0.08, width: 1 },
    { alpha: 0.04, width: 0.5 },
    { alpha: 0.02, width: 0.3 }
  ];
  
  gridLayers.forEach(layer => {
    ctx.strokeStyle = `rgba(255, 255, 255, ${layer.alpha})`;
    ctx.lineWidth = layer.width;
    
    // 縦線（より精密）
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * BLOCK, 0);
      ctx.lineTo(x * BLOCK, FIELD_H);
      ctx.stroke();
    }
    
    // 横線（より精密）
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * BLOCK);
      ctx.lineTo(FIELD_W, y * BLOCK);
      ctx.stroke();
    }
  });
  
  // 微細なドットパターン（テクスチャ効果）
  ctx.fillStyle = 'rgba(255, 255, 255, 0.01)';
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if ((x + y) % 2 === 0) {
        ctx.fillRect(x * BLOCK + BLOCK/4, y * BLOCK + BLOCK/4, 1, 1);
      }
    }
  }
}

// 立体的な境界線を描画
function drawBorder() {
  // アンチエイリアスを有効化
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // より精密な外側の影（複数レイヤー）
  const outerShadows = [
    { offset: 4, alpha: 0.4, width: 4 },
    { offset: 3, alpha: 0.3, width: 3 },
    { offset: 2, alpha: 0.2, width: 2 },
    { offset: 1, alpha: 0.1, width: 1 }
  ];
  
  outerShadows.forEach(shadow => {
    ctx.strokeStyle = `rgba(0, 0, 0, ${shadow.alpha})`;
    ctx.lineWidth = shadow.width;
    ctx.strokeRect(shadow.offset, shadow.offset, FIELD_W - shadow.offset * 2, FIELD_H - shadow.offset * 2);
  });
  
  // より精密な内側のハイライト（複数レイヤー）
  const innerHighlights = [
    { offset: 0, alpha: 0.15, width: 1.5 },
    { offset: 1, alpha: 0.1, width: 1 },
    { offset: 2, alpha: 0.05, width: 0.5 }
  ];
  
  innerHighlights.forEach(highlight => {
    ctx.strokeStyle = `rgba(255, 255, 255, ${highlight.alpha})`;
    ctx.lineWidth = highlight.width;
    ctx.strokeRect(highlight.offset, highlight.offset, FIELD_W - highlight.offset * 2, FIELD_H - highlight.offset * 2);
  });
  
  // メインの境界線（グラデーション付き）
  const borderGradient = ctx.createLinearGradient(0, 0, FIELD_W, FIELD_H);
  borderGradient.addColorStop(0, getComputedStyle(document.documentElement).getPropertyValue('--border').trim());
  borderGradient.addColorStop(0.25, adjustBrightness(getComputedStyle(document.documentElement).getPropertyValue('--border').trim(), 0.1));
  borderGradient.addColorStop(0.5, getComputedStyle(document.documentElement).getPropertyValue('--border').trim());
  borderGradient.addColorStop(0.75, adjustBrightness(getComputedStyle(document.documentElement).getPropertyValue('--border').trim(), -0.1));
  borderGradient.addColorStop(1, getComputedStyle(document.documentElement).getPropertyValue('--border').trim());
  
  ctx.strokeStyle = borderGradient;
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, FIELD_W, FIELD_H);
  
  // 微細な内側の装飾線
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 0.3;
  ctx.strokeRect(1, 1, FIELD_W - 2, FIELD_H - 2);
}

function drawBlock(x, y, color, c = ctx, size = BLOCK) {
  const px = x * size;
  const py = y * size;
  
  // シンプルなグラデーションのみ
  const mainGradient = c.createLinearGradient(px, py, px + size, py + size);
  mainGradient.addColorStop(0, adjustBrightness(color, 0.15));
  mainGradient.addColorStop(1, adjustBrightness(color, -0.15));
  c.fillStyle = mainGradient;
  c.fillRect(px, py, size, size);
  
  // シンプルな枠線
  c.strokeStyle = adjustBrightness(color, -0.4);
  c.lineWidth = 1.2;
  c.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
}

// 色の明度を調整するヘルパー関数
function adjustBrightness(color, factor) {
  // 16進数カラーコードをRGBに変換
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // 明度を調整
  const newR = Math.max(0, Math.min(255, Math.round(r + (255 - r) * factor)));
  const newG = Math.max(0, Math.min(255, Math.round(g + (255 - g) * factor)));
  const newB = Math.max(0, Math.min(255, Math.round(b + (255 - b) * factor)));
  
  // RGBを16進数に戻す
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

const pauseBtn = document.getElementById('pause');
let isPaused = false;
function gameLoop(now) {
  if (gameOver) return;
  if (isPaused) {
    draw();
    requestAnimationFrame(gameLoop);
    return;
  }
  if (!lastFall) lastFall = now;
  const interval = softDrop ? 40 : fallInterval;
  if (now - lastFall > interval) {
    if (!move(0, 1)) {
      fixTetromino();
      clearLines();
      spawnTetromino();
    }
    lastFall = now;
  }
  draw();
  requestAnimationFrame(gameLoop);
}
function move(dx, dy) {
  if (!collides(current.x + dx, current.y + dy, current.shape)) {
    current.x += dx;
    current.y += dy;
    return true;
  }
  return false;
}
function hardDrop() {
  while (move(0, 1));
  fixTetromino();
  clearLines();
  spawnTetromino();
  draw();
}
document.addEventListener('keydown', e => {
  if (gameOver) return;
  switch (e.code) {
    case 'ArrowLeft': move(-1, 0); break;
    case 'ArrowRight': move(1, 0); break;
    case 'ArrowDown': softDrop = true; break;
    case 'ArrowUp':
      tryRotate(current, rotate(current));
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  draw();
});
document.addEventListener('keyup', e => {
  if (e.code === 'ArrowDown') softDrop = false;
});
function touchHandler(btn, action) {
  btn.addEventListener('touchstart', e => { e.preventDefault(); action('down'); });
  btn.addEventListener('touchend', e => { e.preventDefault(); action('up'); });
}
touchHandler(touch.left, dir => { if (dir === 'down') move(-1, 0), draw(); });
touchHandler(touch.right, dir => { if (dir === 'down') move(1, 0), draw(); });
touchHandler(touch.rotate, dir => { if (dir === 'down') tryRotate(current, rotate(current)), draw(); });
touchHandler(touch.down, dir => { softDrop = dir === 'down'; });
touchHandler(touch.drop, dir => { if (dir === 'down') hardDrop(); });
restartBtn.addEventListener('click', () => {
  initGame();
});
pauseBtn.addEventListener('click', () => {
  isPaused = !isPaused;
  pauseBtn.textContent = isPaused ? '▶ 再開' : '⏸ 一時停止';
  if (!isPaused) requestAnimationFrame(gameLoop);
});
window.addEventListener('load', () => {
  field.width = FIELD_W;
  field.height = FIELD_H;
  nextCanvas.width = 80;
  nextCanvas.height = 40;
  initGame();
  if (window.innerWidth < 600) {
    document.querySelector('.touch-controls').style.display = 'flex';
  }
});

// パーティクルシステム
let particles = [];

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 8; // 派手に
    this.vy = Math.random() * -6 - 2;    // 派手に
    this.life = 1.0;
    this.decay = Math.random() * 0.01 + 0.012;
    // ランダムな明度でカラフルに
    this.color = adjustBrightness(color, Math.random() * 1.2 - 0.6);
    this.size = Math.random() * 6 + 2; // 大きめ
    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 0.3;
    this.gravity = 0.18 + Math.random() * 0.12;
    this.friction = 0.97;
  }
  
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += this.gravity;
    this.vx *= this.friction;
    this.vy *= this.friction;
    this.life -= this.decay;
    this.rotation += this.rotationSpeed;
    this.size *= 0.985;
  }
  
  draw(c = ctx) {
    if (this.life <= 0) return;
    c.save();
    c.globalAlpha = this.life;
    c.translate(this.x, this.y);
    c.rotate(this.rotation);
    // シンプルな円形パーティクル
    c.fillStyle = this.color;
    c.beginPath();
    c.arc(0, 0, this.size, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
}

// パーティクルを追加
function addParticles(x, y, color, count = 16) { // 派手に
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(
      x * BLOCK + BLOCK / 2,
      y * BLOCK + BLOCK / 2,
      color
    ));
  }
}

// パーティクルを更新・描画
function updateParticles() {
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    p.update();
    p.draw();
  });
}

// ゴーストピース専用の描画関数（より薄く、うっすら見える）
function drawGhostBlock(x, y, c = ctx, size = BLOCK) {
  const px = x * size;
  const py = y * size;
  
  // アンチエイリアスを有効化
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  
  // 非常に薄いグレーでアウトラインのみ描画
  c.strokeStyle = 'rgba(204, 204, 204, 0.15)';
  c.lineWidth = 1;
  c.strokeRect(px + 1, py + 1, size - 2, size - 2);
  
  // 微細な内側の線
  c.strokeStyle = 'rgba(204, 204, 204, 0.08)';
  c.lineWidth = 0.5;
  c.strokeRect(px + 2, py + 2, size - 4, size - 4);
  
  // 角の微細なハイライト
  c.fillStyle = 'rgba(204, 204, 204, 0.05)';
  c.fillRect(px + 1, py + 1, 1, 1);
  c.fillRect(px + size - 2, py + 1, 1, 1);
  c.fillRect(px + 1, py + size - 2, 1, 1);
  c.fillRect(px + size - 2, py + size - 2, 1, 1);
} 