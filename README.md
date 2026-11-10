# Free Throw

Free NBA player prop research: hit rates, matchups, projections and line shopping. No account, no paywall, no API keys, no dependencies.

## Run it

Requires Node 20 or newer.

```bash
npm start
```

Then open http://127.0.0.1:3000. The first load can take up to a minute while box scores and game logs download. After that they're cached in `.cache/`.

```bash
npm test
```

```bash
npm run backtest
```

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

## Deploying

The server reads `PORT` and `HOST`. To accept outside connections, set `HOST=0.0.0.0`. The cache directory can be moved with `CACHE_DIR`.

For research only. Must be 21+ and in a legal location to bet. If betting stops being fun, call 1-800-GAMBLER.
