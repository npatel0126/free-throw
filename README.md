# Free Throw

Free NBA player prop research: hit rates, matchups, projections and line shopping. No account, no paywall, no API keys, no dependencies.

## Run it locally

### 1. Install Node.js

You need Node.js 20 or newer. Check what you have:

```bash
node --version
```

If that prints `v20` or higher, skip ahead. Otherwise install the LTS version from [nodejs.org](https://nodejs.org), or on a Mac with Homebrew:

```bash
brew install node
```

There's nothing else to install. The app has no npm dependencies, so `npm install` isn't needed.

### 2. Get the code

The repo is private, so you need access to it and a GitHub login on your machine. The easiest way is the [GitHub CLI](https://cli.github.com):

```bash
gh auth login
```

```bash
gh repo clone npatel0126/free-throw
```

Plain `git clone https://github.com/npatel0126/free-throw.git` works too if Git already has your GitHub credentials.

### 3. Start the server

Run these from inside the project folder. Running `npm start` anywhere else gives `Missing script: "start"`.

```bash
cd free-throw
```

```bash
npm start
```

When you see `Free Throw is running at http://127.0.0.1:3000`, open that address in your browser.

The first load takes up to a minute while the server downloads box scores and game logs. The Props page shows what it's loading in the meantime. After that the data is cached in `.cache/`, so later starts are fast.

The board shows the next slate of games that haven't tipped off yet, looking up to a week ahead. In the offseason it can be empty.

### 4. Stop it

Press `Ctrl+C` in the terminal where it's running.

### Options

The server reads three environment variables:

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to listen on. `0.0.0.0` accepts connections from other devices |
| `CACHE_DIR` | `.cache/` | Where downloaded data is stored |

For example, to use a different port:

```bash
PORT=4000 npm start
```

To open it on your phone, start it with `HOST=0.0.0.0 npm start`, then visit `http://<your computer's IP>:3000` from a phone on the same Wi-Fi. On a Mac, `ipconfig getifaddr en0` prints the IP.

### Troubleshooting

| Problem | Fix |
|---|---|
| `npm error Missing script: "start"` | You're not in the project folder. `cd` into it first. |
| `EADDRINUSE: address already in use` | Another copy is already running on that port. Stop it with `Ctrl+C`, or start this one with `PORT=4000 npm start`. |
| Page stuck loading or showing errors | The app needs internet access to reach ESPN and Action Network. Check your connection and refresh. |
| Old or odd-looking data | Stop the server, delete the `.cache/` folder, and start it again. |
| `SyntaxError` or `Unexpected token` when starting | Your Node is too old. Upgrade to 20 or newer. |

### Tests and backtest

```bash
npm test
```

```bash
npm run backtest
```

`npm run backtest` replays this season's finished games against the real DraftKings lines and prints how the model would have done. The first run downloads a lot of box scores and can take several minutes.

## Deploying

The request handling lives in `server/app.js`. `server/index.js` runs it as a normal server, and `api/handler.js` runs it as a Vercel Function.

### Vercel (free)

The repo includes a `vercel.json` that sends every `/api/` request to `api/handler.js`. Vercel serves `public/` as the static site.

1. At [vercel.com/new](https://vercel.com/new), import the `free-throw` repo. Leave the framework as **Other** and the build settings empty.
2. Click **Deploy**.

Every push to `main` deploys again automatically. With the [Vercel CLI](https://vercel.com/docs/cli) you can also deploy from your machine with `vercel --prod`.

On Vercel, the cache lives in the function's temporary `/tmp` storage and resets whenever Vercel starts a fresh instance. When that happens, the first request waits for the board to build (usually a few seconds) instead of showing progress.

Host-only settings like `HOST` don't apply on Vercel. If the site loads but says "This page couldn't load", the `/api/` requests aren't reaching the function: check that `vercel.json` and `api/handler.js` are in the deployed commit.

### Render (free)

The repo includes a `render.yaml` that sets everything up.

1. Sign in at [render.com](https://render.com) with GitHub and give Render access to this repo.
2. Click **New > Blueprint**, pick `free-throw`, and click **Apply**.
3. Wait for the first deploy to finish (a minute or two), then open the `onrender.com` address Render shows.

Every push to `main` deploys again automatically.

On the free plan the service sleeps after 15 minutes without visitors. The next visit takes about 30 seconds to wake it, and the board then takes up to a minute to rebuild because the cache doesn't survive restarts.

### Anywhere else

Any host that runs `npm start` works, such as Railway, Fly.io or your own server. Set `HOST=0.0.0.0` so the server accepts outside connections; most hosts set `PORT` for you. On your own server, put it behind a reverse proxy with HTTPS.

## Design

The look comes from the [Free Throw Redesign](https://www.figma.com/design/IOfXpJKPdi11Dii10Lpm3v) Figma file. Colors and type live as CSS variables at the top of `public/css/app.css`.

## What's in it

- **Props:** every DraftKings player prop on the slate (10 stat types), with line movement, projection, L5/L10/L20/season/H2H hit rates, streaks and defense-vs-position rank.
- **Player pages:** game-by-game hit chart, any line and price you want to test, splits, "without teammate" filters, projection breakdown, alternate lines and full game log.
- **Games:** spreads, totals, implied team scores and injury reports.
- **Lines:** spreads, totals and moneylines across books, with arbitrage, middle and +EV scans.
- **Matchups:** what each defense allows by position, over the season or the last 5 or 10 games.
- **Cheat sheets:** streaks, soft and tough spots, line and price movement, form gaps and model leans.
- **Calculators:** odds, parlay, round robin, hold, devig, EV, Kelly, arbitrage, hedge, middle, free bet and Poisson.
- **Track record:** a walk-forward backtest against real lines, including how uncertain the results are.

## Data sources and their limits

| Source | Used for | Limits |
|---|---|---|
| ESPN public JSON | Schedules, box scores, game logs, injuries, DraftKings props | Unofficial and undocumented, so it can change without notice |
| Action Network public JSON | Spreads, totals and moneylines across books | Unofficial, New Jersey prices, occasional corrupt rows (filtered) |

No free feed we found carries **player props across several books**, so prop "+EV" compares our estimate with one book's price. It isn't the cross-book devig that paid tools sell. The arbitrage, middle and +EV scans cover game lines only.

Both feeds are unofficial and team logos and headshots are hotlinked from ESPN. That's reasonable for personal use, but check each provider's terms before running this as a public or commercial site. A licensed data feed may be required.

## How the numbers work

A projection is the player's recency-weighted production per minute, times expected minutes, adjusted for the opponent's defense at his position, the team's implied score and venue. See `server/model.js`.

The final estimate blends 15% of that projection with 85% of the mean implied by DraftKings' line. Those weights come from the first half of the backtest. The model alone is less accurate than the book, so it is never used alone.

The model doesn't know about teammate absences, and the backtest has **not** shown a proven edge. Check the Track Record page, which recalculates as the season goes on, before trusting any estimate.

For research only. Must be 21+ and in a legal location to bet. If betting stops being fun, call 1-800-GAMBLER.
