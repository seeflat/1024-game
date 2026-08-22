# 1024 — rotate & merge puzzle

A small clone of the "Power / 1024" rotate-and-merge puzzle
(https://1024-game.netlify.app), rebuilt as a static, dependency-free page.

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
  drive the puzzle.
- `generatePuzzle()` builds a random board whose tile values are a random
  power-of-two partition of a target value (64 up to 1024), then verifies it
  with a breadth-first search over the two possible moves (rotate
  left/right) up to depth 14, so every puzzle served is provably solvable
  and its optimal move count is known.
- If generation somehow can't find a solvable board in 400 tries (it always
  does in practice), a hand-built, always-solvable fallback board is used
  instead — so the page can never get stuck the way the original did.

## Play

Open `index.html` directly, or serve the folder statically, e.g.:

```sh
python3 -m http.server 8000
```

Controls: click the rotate-left / rotate-right arrows, or use the
`ArrowLeft` / `ArrowRight` keys. `Enter` resets the current puzzle. Merge
every tile into a single tile to win.
