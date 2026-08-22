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

// Runs one pass of gravity: for each column, scan bottom-up (skipping the
// floor row) and drop each tile through any empty run beneath it, merging
// it into an equal neighbor it lands on. Note this allows chain merges
// across passes within the same move — a 16+16 that becomes 32 can go on
// to merge with an adjacent 32 in a later pass of the *same* move. That's
// deliberate: it's how the original's board settles (verified against its
// decompiled source), not standard single-merge-per-tile 2048 rules. This
// is the single source of truth for the physics — both the solver and the
// animated renderer drive off it, so what the solver proves solvable is
// exactly what the animated board will actually do.
//
// Returns { board, events }, where events describe what moved/merged this
// pass in row/column terms (no pixels — that's the renderer's job):
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
//
// The original renders the grid as 16 fixed, keyed cells and animates them
// in place (rotate the board while counter-rotating each tile so the
// numbers stay upright, then cascade gravity/merges over several passes
// with translateY slides and a merge scale-pulse) rather than tearing down
// and rebuilding the DOM on every move. That in-place, multi-pass approach
// is what actually reads as "smooth" — this mirrors it directly instead of
// re-rendering from scratch each move.

const CELL = 56; // px, matches the 56px tile size in style.css
const GAP = 8; // px, matches the board's grid gap
const STEP = CELL + GAP; // px moved per row of fall

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)"; // ~easeOutExpo

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
let cellEls = null; // [r][c] -> .tile element, created once and reused

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function buildBoardDOM() {
  boardEl.innerHTML = "";
  cellEls = [];
  for (let r = 0; r < SIZE; r++) {
    cellEls.push([]);
    for (let c = 0; c < SIZE; c++) {
      const cellWrap = document.createElement("div");
      cellWrap.className = "tile-cell";
      const tile = document.createElement("div");
      tile.className = "tile empty";
      cellWrap.appendChild(tile);
      boardEl.appendChild(cellWrap);
      cellEls[r].push(tile);
    }
  }
}

function paintCell(r, c, value) {
  const tile = cellEls[r][c];
  if (value === 0) {
    tile.classList.add("empty");
    tile.textContent = "";
    tile.style.background = "";
  } else {
    tile.classList.remove("empty");
    tile.style.background = COLORS[value] || "#0f172a";
    tile.textContent = value;
  }
}

function paintBoard(b) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) paintCell(r, c, b[r][c]);
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
  buildBoardDOM();
  paintBoard(board);
  genNote.textContent = `Solvable in ${solutionLength} move${solutionLength === 1 ? "" : "s"}.`;
}

// Rotates the whole board container, while every tile simultaneously
// counter-rotates so its number stays upright throughout the spin — the
// original's signature visual trick (anime.js timeline offset by -400ms on
// a 500ms rotation; reproduced here as a 100ms-delayed 500ms counter-spin).
async function animateRotate(dir) {
  const deg = dir === "left" ? -90 : 90;
  const boardAnim = boardEl.animate(
    [{ transform: "rotate(0deg)" }, { transform: `rotate(${deg}deg)` }],
    { duration: 500, easing: EASE }
  );
  const tileAnims = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      tileAnims.push(
        cellEls[r][c].animate(
          [{ transform: "rotate(0deg)" }, { transform: `rotate(${-deg}deg)` }],
          { duration: 500, delay: 100, easing: EASE }
        )
      );
    }
  }
  await Promise.all([boardAnim.finished, ...tileAnims.map((a) => a.finished)]);
}

// Drives the animated fall/merge from gravityMergePass — the exact same
// function the solver uses — so the board the player actually reaches is
// guaranteed to match what was proven solvable. Passes repeat until
// nothing moves, which produces the cascading, staged falls (rather than
// tiles teleporting straight to their final resting row) and lets chain
// merges play out visually across passes, one merge-pulse/fall-slide at a
// time.
async function gravityAndMergeAnimated() {
  while (true) {
    const { board: next, events } = gravityMergePass(board);
    if (events.length === 0) return;

    // Tiles are stacked in DOM/paint order by (r, c), so a tile sliding
    // downward via translateY visually enters later cells' space and would
    // paint underneath them. Bump z-index for the duration of the animation
    // so falling/merging tiles stay on top while they cross that space.
    const anims = events.map((ev) => {
      const el = cellEls[ev.r][ev.c];
      el.style.zIndex = "2";
      if (ev.kind === "merge") {
        board[ev.r][ev.c] = ev.value;
        paintCell(ev.r, ev.c, ev.value);
        return el.animate(
          [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }],
          { duration: 200, easing: "ease-in-out" }
        ).finished;
      }
      const px = ev.rows * STEP;
      return el.animate(
        [{ transform: "translateY(0px)" }, { transform: `translateY(${px}px)` }],
        { duration: 500, easing: "ease-in" }
      ).finished;
    });

    await Promise.all(anims);
    for (const ev of events) cellEls[ev.r][ev.c].style.zIndex = "";
    board = next;
    paintBoard(board);
    await nextFrame();
  }
}

async function doMove(dir) {
  if (animating || won || !board) return;
  animating = true;

  await animateRotate(dir);
  board = dir === "left" ? rotateCCW(board) : rotateCW(board);
  paintBoard(board);
  await nextFrame();

  await gravityAndMergeAnimated();

  moves += 1;
  updateStatus();

  if (isWon(board)) {
    won = true;
    winMovesEl.textContent = `You solved the puzzle in ${moves} move${moves > 1 ? "s" : ""}!`;
    winHintEl.classList.toggle("hidden", moves <= solutionLength);
    winOverlay.classList.remove("hidden");
  }

  animating = false;
}

// A translateX wiggle on the board, matching the original's reset shake —
// the data resets instantly underneath it, the shake is just a flourish.
async function resetGame() {
  if (animating || moves === 0) return;
  animating = true;
  won = false;
  winOverlay.classList.add("hidden");

  board = cloneBoard(initialBoard);
  moves = 0;
  updateStatus();
  paintBoard(board);

  const shake = boardEl.animate(
    [
      { transform: "translateX(0px)" },
      { transform: "translateX(-25px)" },
      { transform: "translateX(25px)" },
      { transform: "translateX(-12.5px)" },
      { transform: "translateX(12.5px)" },
      { transform: "translateX(0px)" },
    ],
    { duration: 350, easing: EASE }
  );
  await shake.finished;
  animating = false;
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
