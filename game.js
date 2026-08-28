// "1024" — rotate-and-merge puzzle.
//
// The original site this is inspired by fetched its board from a remote API
// (api.power.fuegoio.com) that no longer resolves, with no error handling —
// so the page hung on a loading spinner forever. This version generates and
// verifies solvable puzzles entirely client-side, so there's no server to go
// down.
//
// The rotate/settle animation below is a direct port of the original's Vue
// `HomeView.vue` (its compiled `setup()` — rotate the board container while
// every tile counter-rotates to stay upright, then settle tiles one row per
// pass with an elastic drop and a scale-pulse on each merge). It's the same
// choreography, moved onto a persistent 16-cell DOM and driven by anime.js.

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

// Runs one pass of gravity: for each column, scan bottom-up (skipping the
// floor row) and drop each tile through any empty run beneath it, merging
// it into an equal neighbor it lands on. Note this allows chain merges
// across passes within the same move — a 16+16 that becomes 32 can go on
// to merge with an adjacent 32 in a later pass of the *same* move. That's
// deliberate: it's how the original's board settles (verified against its
// decompiled source), not standard single-merge-per-tile 2048 rules.
//
// This is the solver's ground truth for the physics. The animated renderer
// (rotate(), further down) settles the board with the original's own
// row-at-a-time pass instead; that pass converges to the exact same stable
// board this does — both are just "gravity, then merge equal vertical
// neighbours, repeat until nothing moves" — so what the solver proves
// solvable is exactly what the animated board ends up showing.
//
// Returns { board, events }, where events describe what moved/merged this
// pass in row/column terms:
//   { kind: "fall", r, c, rows }  — tile that WAS at (r, c) fell `rows` rows
//   { kind: "merge", r, c, value } — tile landing at (r, c) merged to `value`
function gravityMergePass(board) {
  const q = cloneBoard(board);
  const events = [];

  for (let ie = 1; ie < SIZE; ie++) {
    const sourceRow = SIZE - ie - 1;
    const lowerRow = SIZE - ie;
    for (let c = 0; c < SIZE; c++) {
      let rowsMoved = 0;
      for (let ue = lowerRow; ue < SIZE && q[ue][c] === 0; ue++) {
        if (q[ue - 1][c] !== 0) {
          q[ue][c] = q[ue - 1][c];
          q[ue - 1][c] = 0;
          rowsMoved += 1;
        }
      }
      if (q[lowerRow][c] !== 0 && q[sourceRow][c] === q[lowerRow][c]) {
        q[lowerRow][c] *= 2;
        q[sourceRow][c] = 0;
        rowsMoved += 1;
        events.push({ kind: "merge", r: lowerRow, c, value: q[lowerRow][c] });
      }
      if (rowsMoved > 0) events.push({ kind: "fall", r: sourceRow, c, rows: rowsMoved });
    }
  }

  return { board: q, events };
}

// Runs passes until the board is stable.
function gravityMergeFull(board) {
  let b = board;
  while (true) {
    const { board: next, events } = gravityMergePass(b);
    if (events.length === 0) return b;
    b = next;
  }
}

function applyMove(board, dir) {
  const rotated = dir === "left" ? rotateCCW(board) : rotateCW(board);
  return gravityMergeFull(rotated);
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

// Splits `target` (a power of two) into `count` power-of-two parts that sum
// back to it (merges preserve the total, so this is exactly what's needed
// for a puzzle that CAN collapse to one tile of value `target`).
//
// Each step halves one existing part, chosen with probability proportional
// to its value — so the biggest parts break down first. That keeps the
// opening board from ever having one lone giant tile, while still leaving
// enough spread that boards aren't a monotonous wall of one value. Stops
// early only if every part is already a 2 (nothing left to split).
function partitionValue(target, count) {
  const parts = [target];
  while (parts.length < count) {
    const splittable = parts
      .map((value, index) => ({ value, index }))
      .filter((p) => p.value > 2);
    if (splittable.length === 0) break;

    const totalWeight = splittable.reduce((sum, p) => sum + p.value, 0);
    let r = Math.random() * totalWeight;
    let pick = splittable[splittable.length - 1];
    for (const p of splittable) {
      r -= p.value;
      if (r <= 0) {
        pick = p;
        break;
      }
    }
    parts.splice(pick.index, 1, pick.value / 2, pick.value / 2);
  }
  return parts;
}

// Puzzle shape. A board must be able to collapse to a single tile, so its
// values are always a power-of-two partition of `target` (the winning tile).
const TARGET_POOL = [64, 128, 128, 256, 256, 512];
const MIN_TILES = 6;
const MAX_TILES = 10;
const MIN_START_TILE = 16; // the board must hold at least one tile this big…
const MAX_START_TILE = 64; // …and none bigger — keeps the opening interesting
const MIN_SOLUTION = 5; // optimal-move count must land in this range: not a
const MAX_SOLUTION = 10; // giveaway, not a marathon
const SEARCH_DEPTH = MAX_SOLUTION + 2; // BFS ceiling when checking solvability

// Builds one random candidate board (no solvability check yet).
function buildCandidate() {
  const target = TARGET_POOL[Math.floor(Math.random() * TARGET_POOL.length)];
  const count = MIN_TILES + Math.floor(Math.random() * (MAX_TILES - MIN_TILES + 1));
  const parts = partitionValue(target, count);
  if (parts.length > SIZE * SIZE) return null;

  const board = emptyBoard();
  const cells = shuffledCells();
  parts.forEach((value, k) => {
    const [r, c] = cells[k];
    board[r][c] = value;
  });
  return { board, target, maxTile: Math.max(...parts) };
}

function generatePuzzle() {
  // Full constraints: a bounded opening tile, a fairly full board, and a
  // solution that's neither trivial nor a slog. Succeeds ~100% of the time
  // well within this budget.
  for (let attempt = 0; attempt < 800; attempt++) {
    const candidate = buildCandidate();
    if (
      !candidate ||
      candidate.maxTile < MIN_START_TILE ||
      candidate.maxTile > MAX_START_TILE
    )
      continue;

    const solution = findSolution(candidate.board, SEARCH_DEPTH);
    if (
      !solution ||
      solution.length < MIN_SOLUTION ||
      solution.length > MAX_SOLUTION
    )
      continue;

    return {
      board: candidate.board,
      target: candidate.target,
      solutionLength: solution.length,
    };
  }

  // Relaxed pass: any solvable board whose opening tile isn't oversized.
  // Not expected to be reached in practice — it's here so a freak RNG streak
  // still yields a real puzzle rather than the trivial fallback below.
  for (let attempt = 0; attempt < 400; attempt++) {
    const candidate = buildCandidate();
    if (!candidate || candidate.maxTile > MAX_START_TILE) continue;
    const solution = findSolution(candidate.board, 14);
    if (solution)
      return {
        board: candidate.board,
        target: candidate.target,
        solutionLength: solution.length,
      };
  }

  // Guaranteed fallback: two equal tiles stacked in a column always solve in
  // a single move. This makes it impossible for generation to ever fail to
  // produce a playable board — the original site's failure mode.
  const board = emptyBoard();
  board[2][0] = 32;
  board[3][0] = 32;
  const solution = findSolution(board, 4);
  return { board, target: 64, solutionLength: solution ? solution.length : 1 };
}

// ---- UI wiring ----
//
// Port of the original `HomeView.vue` setup() logic. The board is a fixed
// grid of 16 cells built once and repainted in place (never torn down),
// exactly like the original's keyed cells. anime.js drives the same two
// visual phases the original used:
//
//   1. rotate  — spin the board container by ±90° while every tile spins
//      the opposite way, so tile squares and their numbers stay upright
//      through the turn. Then the data matrix is actually rotated and the
//      spin is snapped back to flat.
//   2. settle  — repeatedly, in one pass: drop every tile that can move
//      down a row (elastic translateY, anime.js' default easing) and merge
//      every tile resting on an equal one (scale-pulse on the survivor).
//      Repaint between passes, until a pass moves nothing.

const CELL = 56; // px, matches the .tile size in style.css
const GAP = 8; // px, matches the board's grid gap
const STEP = CELL + GAP; // px moved per row of fall (the original used a flat 64)

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
const controlsEl = document.querySelector(".controls");

let initialBoard = null; // the puzzle's starting grid, restored on reset
let board = null; // current 4x4 grid
let moves = 0;
let solutionLength = 0;
let animating = false; // true while a rotate/reset animation is playing
let won = false;

let tileEls = null; // [r][c] -> .tile element (created once, reused)
let labelEls = null; // [r][c] -> .tile-label element
let allTileEls = []; // flat list of every .tile, for the counter-rotation

// Lets the browser paint the repainted board (and flush anime.js' transform
// reset) before the next settle pass starts — the vanilla stand-in for the
// original's `await nextTick()`. Falls back to a timer so it still resolves
// in a backgrounded tab, where requestAnimationFrame is frozen.
const nextTick = () =>
  new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 60);
  });

// anime.js runs on requestAnimationFrame, which the browser freezes entirely
// while the tab is hidden — so an animation's `.finished` can hang for as
// long as the player is looking at another tab, which would leave the board
// stuck mid-move. Race every wait against a timeout (setTimeout keeps firing
// when hidden, unlike rAF) that snaps the animations straight to their end,
// so a backgrounded move still finishes and the board is never left locked.
function raceFinish(instances, timeoutMs) {
  let timer;
  const done = Promise.all(instances.map((a) => a.finished));
  const bail = new Promise((resolve) => {
    timer = setTimeout(() => {
      instances.forEach((a) => {
        a.seek(a.duration);
        a.pause(); // drop it from anime.js' active list; the engine is frozen
      });
      resolve();
    }, timeoutMs);
  });
  return Promise.race([done, bail]).finally(() => clearTimeout(timer));
}

function buildBoardDOM() {
  boardEl.innerHTML = "";
  tileEls = [];
  labelEls = [];
  allTileEls = [];
  for (let r = 0; r < SIZE; r++) {
    tileEls.push([]);
    labelEls.push([]);
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement("div");
      cell.className = "tile-cell";
      const tile = document.createElement("div");
      tile.className = "tile empty";
      tile.id = `cell-${r}-${c}`;
      const label = document.createElement("span");
      label.className = "tile-label";
      tile.appendChild(label);
      cell.appendChild(tile);
      boardEl.appendChild(cell);
      tileEls[r].push(tile);
      labelEls[r].push(label);
      allTileEls.push(tile);
    }
  }
}

function paintCell(r, c, value) {
  const tile = tileEls[r][c];
  const label = labelEls[r][c];
  if (value === 0) {
    tile.classList.add("empty");
    tile.style.background = "";
    label.textContent = "";
  } else {
    tile.classList.remove("empty");
    tile.style.background = COLORS[value] || "#0f172a";
    label.textContent = value;
  }
}

function paintBoard(b) {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) paintCell(r, c, b[r][c]);
}

function updateStatus() {
  statusEl.textContent =
    moves > 0
      ? `${moves} move${moves > 1 ? "s" : ""}`
      : "Try to merge all the tiles into one by only rotating the board.";
  resetBtn.classList.toggle("hidden", moves === 0);
}

// Mirrors the original's `:class="isAnimating ? 'opacity-10' : ''"` on the
// controls row, and blocks clicks while a move is playing.
function setAnimating(value) {
  animating = value;
  controlsEl.classList.toggle("dimmed", value);
}

function newGame() {
  const gen = generatePuzzle();
  initialBoard = cloneBoard(gen.board);
  board = cloneBoard(gen.board);
  solutionLength = gen.solutionLength;
  moves = 0;
  won = false;
  setAnimating(false);
  winOverlay.classList.add("hidden");
  rotateLeftBtn.classList.remove("hidden");
  rotateRightBtn.classList.remove("hidden");
  updateStatus();
  buildBoardDOM();
  paintBoard(board);
  genNote.textContent = `Solvable in ${solutionLength} move${solutionLength === 1 ? "" : "s"}.`;
}

// Rotate the whole board 90° left or right, then let tiles fall & merge
// (like gravity) until the board is stable. Ported from HomeView.vue.
async function rotate(direction) {
  if (!board || animating || won) return;
  setAnimating(true);

  const angle = direction === "left" ? -90 : 90;

  // Purely visual: spin the board container one way and each tile the
  // opposite way (so the tiles and their numbers stay upright while the
  // board turns). Only the board's rotation sets the timeline duration;
  // the counter-spin starts 100ms in (offset "-=400" against 500ms).
  const timeline = anime.timeline({ easing: "easeOutExpo", duration: 500 });
  timeline.add({ targets: boardEl, rotate: angle });
  timeline.add({ targets: allTileEls, rotate: -angle }, "-=400");
  await raceFinish([timeline], 1200);

  // Actually rotate the underlying 4x4 data, then snap the spin back to 0
  // so the (now-rotated) board renders flat.
  board = direction === "left" ? rotateCCW(board) : rotateCW(board);
  timeline.seek(0);
  paintBoard(board);
  await nextTick();

  // Settle pass: each iteration drops every tile that can fall one row and
  // merges every tile resting on an equal one, animating them together,
  // then repaints — repeating until a pass produces no movement. `next` is
  // the board after this pass; `targetRow` is the row a tile falls FROM.
  let unstable = true;
  while (unstable) {
    const animations = [];
    const lifted = []; // tiles whose z-index we raised for this pass
    const next = cloneBoard(board);

    // A tile animating `translateY`/`scale` gets its own stacking context and,
    // at the default z-index, is painted under the later grid cells it moves
    // across — so it vanishes behind the board until it lands. Raising its
    // z-index for the duration of the pass keeps it on top the whole way down.
    const lift = (r, c) => {
      const el = tileEls[r][c];
      el.style.zIndex = "2";
      lifted.push(el);
    };

    for (let rowsFromTop = 1; rowsFromTop < SIZE; rowsFromTop++) {
      const targetRow = SIZE - rowsFromTop - 1;

      for (let col = 0; col < SIZE; col++) {
        let fallDistance = 0;

        // Slide the tile at `targetRow` down one step into the empty run
        // that starts just below it.
        for (
          let row = SIZE - rowsFromTop;
          row < SIZE && next[row][col] === 0;
          row++
        ) {
          if (next[row - 1][col] !== 0) {
            next[row][col] = next[row - 1][col];
            next[row - 1][col] = 0;
            fallDistance += STEP;
          }
        }

        // If the tile at `targetRow` is now resting directly on an equal
        // tile, merge the two — the survivor (below) doubles and pulses.
        const landedRow = SIZE - rowsFromTop;
        if (
          next[landedRow][col] !== 0 &&
          next[targetRow][col] === next[landedRow][col]
        ) {
          next[landedRow][col] *= 2;
          next[targetRow][col] = 0;
          fallDistance += STEP;
          // Show the doubled value now, so the pulse plays on the new number.
          paintCell(landedRow, col, next[landedRow][col]);
          lift(landedRow, col);
          animations.push(
            anime({
              targets: `#cell-${landedRow}-${col}`,
              scale: 1.25,
              duration: 200,
              direction: "alternate",
              easing: "easeInOutSine",
            })
          );
        }

        if (fallDistance > 0) {
          lift(targetRow, col);
          animations.push(
            anime({
              targets: `#cell-${targetRow}-${col}`,
              translateY: fallDistance,
              duration: 500,
            })
          );
        }
      }
    }

    if (animations.length === 0) {
      unstable = false;
      break;
    }

    await raceFinish(animations, 1200);
    board = next;
    animations.forEach((a) => a.seek(0)); // clear the transforms for the repaint
    lifted.forEach((el) => (el.style.zIndex = ""));
    paintBoard(board);
    await nextTick();
  }

  moves += 1;
  updateStatus();

  if (isWon(board)) {
    won = true;
    winMovesEl.textContent = `You solved the puzzle in ${moves} move${moves > 1 ? "s" : ""}!`;
    winHintEl.classList.toggle("hidden", moves <= solutionLength);
    winOverlay.classList.remove("hidden");
  }

  setAnimating(false);
}

// Shake the board and restore the original grid. Ported from HomeView.vue —
// the data resets instantly underneath; the shake is just a flourish.
async function reset() {
  if (!board || animating || moves === 0) return;
  setAnimating(true);
  moves = 0;
  won = false;
  winOverlay.classList.add("hidden");

  const shake = anime({
    targets: boardEl,
    translateX: [
      { value: -25 },
      { value: 25 },
      { value: -12.5 },
      { value: 12.5 },
      { value: 0 },
    ],
    duration: 350,
    easing: "easeOutExpo",
  });
  board = cloneBoard(initialBoard);
  paintBoard(board);
  updateStatus();
  await raceFinish([shake], 900);
  shake.seek(0);
  setAnimating(false);
}

rotateLeftBtn.addEventListener("click", () => rotate("left"));
rotateRightBtn.addEventListener("click", () => rotate("right"));
resetBtn.addEventListener("click", reset);
playAgainBtn.addEventListener("click", reset);

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") rotate("left");
  else if (e.key === "ArrowRight") rotate("right");
  else if (e.key === "Enter") reset();
});

newGame();
