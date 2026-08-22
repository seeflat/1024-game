// "1024" — rotate-and-merge puzzle.
//
// The original site this is inspired by fetched its board from a remote API
// (api.power.fuegoio.com) that no longer resolves, with no error handling —
// so the page hung on a loading spinner forever. This version generates and
// verifies solvable puzzles entirely client-side, so there's no server to go
// down.

const SIZE = 4;

const COLORS = {
  2: "#3b82f6",
  4: "#6366f1",
  8: "#8b5cf6",
  16: "#a855f7",
  32: "#d946ef",
  64: "#ec4899",
  128: "#f43f5e",
  256: "#f97316",
  512: "#f59e0b",
  1024: "#eab308",
};

function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function cloneBoard(b) {
  return b.map((row) => row.slice());
}

function rotateCCW(b) {
  const res = emptyBoard();
  for (let i = 0; i < SIZE; i++)
    for (let j = 0; j < SIZE; j++) res[i][j] = b[j][SIZE - 1 - i];
  return res;
}

function rotateCW(b) {
  const res = emptyBoard();
  for (let i = 0; i < SIZE; i++)
    for (let j = 0; j < SIZE; j++) res[i][j] = b[SIZE - 1 - j][i];
  return res;
}

// Merges a line of tiles (no zeros) toward its end, classic 2048 rules:
// each tile merges into at most one new tile per move.
function mergeTowardEnd(arr) {
  const res = [];
  let i = 0;
  while (i < arr.length) {
    if (i + 1 < arr.length && arr[i] === arr[i + 1]) {
      res.push(arr[i] * 2);
      i += 2;
    } else {
      res.push(arr[i]);
      i += 1;
    }
  }
  return res;
}

// Gravity pulls every tile to the bottom of its column, merging equal
// adjacent tiles as they land.
function gravityMerge(board) {
  const res = emptyBoard();
  for (let c = 0; c < SIZE; c++) {
    const col = [];
    for (let r = 0; r < SIZE; r++) if (board[r][c] !== 0) col.push(board[r][c]);
    const merged = mergeTowardEnd(col);
    const pad = SIZE - merged.length;
    for (let r = 0; r < SIZE; r++) res[r][c] = r < pad ? 0 : merged[r - pad];
  }
  return res;
}

function applyMove(board, dir) {
  const rotated = dir === "left" ? rotateCCW(board) : rotateCW(board);
  return gravityMerge(rotated);
}

function isWon(board) {
  let count = 0;
  for (const row of board) for (const v of row) if (v !== 0) count++;
  return count === 1;
}

function boardKey(board) {
  return board.map((row) => row.join(",")).join("|");
}

// Breadth-first search over the two possible moves at each step. Small
// branching factor (2) keeps this fast; returns the shortest winning move
// sequence, or null if none exists within maxDepth.
function findSolution(initialBoard, maxDepth) {
  if (isWon(initialBoard)) return [];
  let frontier = [{ board: initialBoard, path: [] }];
  const visited = new Set([boardKey(initialBoard)]);

  for (let depth = 0; depth < maxDepth; depth++) {
    const next = [];
    for (const state of frontier) {
      for (const dir of ["left", "right"]) {
        const nb = applyMove(state.board, dir);
        const key = boardKey(nb);
        if (visited.has(key)) continue;
        visited.add(key);
        const path = [...state.path, dir];
        if (isWon(nb)) return path;
        next.push({ board: nb, path });
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return null;
}

function shuffledCells() {
  const cells = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) cells.push([r, c]);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells;
}

// Splits `target` (a power of two) into a random multiset of power-of-two
// parts that sum back to it (merges preserve the total, so this is exactly
// what's needed for a puzzle that CAN collapse to one tile of value target).
function randomPartition(target, desiredCount) {
  let parts = [target];
  let guard = 0;
  while (parts.length < desiredCount && guard < 200) {
    guard++;
    const splittable = parts.map((v, i) => (v > 2 ? i : -1)).filter((i) => i !== -1);
    if (splittable.length === 0) break;
    const idx = splittable[Math.floor(Math.random() * splittable.length)];
    const v = parts[idx];
    parts.splice(idx, 1, v / 2, v / 2);
  }
  return parts;
}

const TARGET_POOL = [64, 128, 128, 256, 256, 256, 512, 512, 1024];

function generatePuzzle() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const target = TARGET_POOL[Math.floor(Math.random() * TARGET_POOL.length)];
    const desiredCount = 5 + Math.floor(Math.random() * 4); // 5..8 tiles
    const parts = randomPartition(target, desiredCount);
    if (parts.length > SIZE * SIZE) continue;

    const board = emptyBoard();
    const cells = shuffledCells();
    for (let k = 0; k < parts.length; k++) {
      const [r, c] = cells[k];
      board[r][c] = parts[k];
    }

    const solution = findSolution(board, 14);
    if (solution) return { board, target, solutionLength: solution.length };
  }

  // Guaranteed fallback: two tiles stacked in one column always solve in a
  // single move. This makes it impossible for puzzle generation to ever
  // fail to produce a playable board — the original site's failure mode.
  const board = emptyBoard();
  board[2][0] = 512;
  board[3][0] = 512;
  const solution = findSolution(board, 4);
  return { board, target: 1024, solutionLength: solution ? solution.length : 1 };
}

// ---- UI wiring ----

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const winOverlay = document.getElementById("winOverlay");
const winMovesEl = document.getElementById("winMoves");
const winHintEl = document.getElementById("winHint");
const resetBtn = document.getElementById("resetBtn");
const rotateLeftBtn = document.getElementById("rotateLeftBtn");
const rotateRightBtn = document.getElementById("rotateRightBtn");
const playAgainBtn = document.getElementById("playAgainBtn");
const genNote = document.getElementById("genNote");

let initialBoard = null;
let board = null;
let moves = 0;
let solutionLength = 0;
let animating = false;
let won = false;

function renderCells() {
  boardEl.innerHTML = "";
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement("div");
      cell.className = "tile-cell";
      cell.dataset.r = r;
      cell.dataset.c = c;
      const v = board[r][c];
      if (v !== 0) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.style.background = COLORS[v] || "#0f172a";
        tile.textContent = v;
        cell.appendChild(tile);
      }
      boardEl.appendChild(cell);
    }
  }
}

function updateStatus() {
  if (moves > 0) {
    statusEl.textContent = `${moves} move${moves > 1 ? "s" : ""}`;
  } else {
    statusEl.textContent = "Try to merge all the tiles into one by only rotating the board.";
  }
  resetBtn.classList.toggle("hidden", moves === 0);
}

function newGame() {
  const gen = generatePuzzle();
  initialBoard = cloneBoard(gen.board);
  board = cloneBoard(gen.board);
  solutionLength = gen.solutionLength;
  moves = 0;
  won = false;
  animating = false;
  winOverlay.classList.add("hidden");
  rotateLeftBtn.classList.remove("hidden");
  rotateRightBtn.classList.remove("hidden");
  updateStatus();
  renderCells();
  genNote.textContent = `Solvable in ${solutionLength} move${solutionLength === 1 ? "" : "s"}.`;
}

function resetGame() {
  if (moves === 0) return;
  board = cloneBoard(initialBoard);
  moves = 0;
  won = false;
  animating = false;
  winOverlay.classList.add("hidden");
  updateStatus();
  renderCells();
}

async function doMove(dir) {
  if (animating || won || !board) return;
  animating = true;

  boardEl.classList.add(dir === "left" ? "spin-left" : "spin-right");
  await wait(260);
  boardEl.classList.remove("spin-left", "spin-right");

  board = applyMove(board, dir);
  moves += 1;
  renderCells();
  updateStatus();

  if (isWon(board)) {
    won = true;
    winMovesEl.textContent = `You solved the puzzle in ${moves} move${moves > 1 ? "s" : ""}!`;
    winHintEl.classList.toggle("hidden", moves <= solutionLength);
    winOverlay.classList.remove("hidden");
  }

  animating = false;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

rotateLeftBtn.addEventListener("click", () => doMove("left"));
rotateRightBtn.addEventListener("click", () => doMove("right"));
resetBtn.addEventListener("click", resetGame);
playAgainBtn.addEventListener("click", resetGame);

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") doMove("left");
  else if (e.key === "ArrowRight") doMove("right");
  else if (e.key === "Enter") resetGame();
});

newGame();
