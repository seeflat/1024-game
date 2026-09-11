# 1024 — rotate & merge puzzle

A small clone of the "Power / 1024" rotate-and-merge puzzle
(https://1024-game.netlify.app), rebuilt as a static page with no backend.
The only runtime dependency is [anime.js](https://animejs.com) (v3, vendored
in `anime.min.js`), used for the rotate/settle animation — the same library
the original used.

**Live:** https://seeflat.github.io/1024-game/ (deployed automatically from
`main` via GitHub Actions — see `.github/workflows/deploy.yml`)

## The bug in the original

The original site never finishes loading. It's a Vue app whose board data
comes from a hardcoded call to `https://api.power.fuegoio.com/grid`, with no
error handling:

```js
const g = async () => {
  const P = await gA.get("https://api.power.fuegoio.com/grid");
  i = P.data.grid;
  a.value = cloneDeep(i);
};
```

That API domain no longer resolves (`getaddrinfo ENOTFOUND
api.power.fuegoio.com`). Since the request never resolves and nothing
catches the failure, the board (`a.value`) stays `undefined` forever, so the
page is stuck on its loading spinner indefinitely.

## How this version fixes it

This clone generates and verifies puzzles entirely in the browser — no
backend, nothing to go down:

- `game.js` implements the board rotation (90° CW/CCW) and gravity-merge
  physics (tiles fall and merge like a single-direction 2048 move) that
  drive the puzzle. The rotate/settle animation is a port of the original
  Vue `HomeView.vue` component's `setup()` logic to a persistent 16-cell
  DOM.
- `generatePuzzle()` builds a random board whose tile values are a
  power-of-two partition of a target (64–512), splitting the largest chunks
  first so the opening never has one lone giant tile. It then keeps only
  boards that are a good puzzle: 6–10 tiles, largest tile 16–64, and a
  breadth-first search over the two moves (rotate left/right) proving an
  optimal solution of 5–10 moves. So every puzzle served is provably
  solvable and its optimal move count is known.
- If generation somehow can't find a board meeting all of that (it always
  does in practice — measured 0 misses over 20k), it relaxes to any solvable
  board, and failing even that, a hand-built always-solvable fallback — so
  the page can never get stuck the way the original did.

## Daily puzzles

The site shows 3 fixed puzzles a day — the same three for every visitor,
rotating at UTC midnight — like a small Wordle-style daily. There's still no
backend: `generatePuzzle()` takes an optional `rand` function (defaulting to
`Math.random`), and a daily puzzle just calls it with a seeded PRNG
(`xmur3` + `mulberry32`, both in `game.js`) keyed by
`` `1024-daily-v1-${date}-${slot}` ``. Same seed in, same board out, computed
independently by every browser — that's the entire mechanism.

Solved state is tracked in `localStorage` (namespaced `1024daily:v1:`, one
record per day, pruned after 14 days), with an in-memory fallback if storage
is unavailable (e.g. private browsing) so the game stays playable — solved
state just won't survive a reload in that case. Once a slot is solved it
locks: no replay, no re-rolling a better move count.

## Play

Open `index.html` directly, or serve the folder statically, e.g.:

```sh
python3 -m http.server 8000
```

Pick a puzzle with the `1`/`2`/`3` tabs, then click the rotate-left /
rotate-right arrows, or use the `ArrowLeft` / `ArrowRight` keys. `Enter`
resets the puzzle currently shown (only while it's unsolved). Merge every
tile into a single tile to win.
