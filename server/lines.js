// Multi-book game lines from Action Network's public scoreboard feed, plus the
// arbitrage, middle and +EV scans those lines allow. This covers spreads, totals
// and moneylines only: no free feed we found offers player props across books.

import { cached, getJson, MIN } from './cache.js';
import { impliedProb, toDecimal, devig } from '../public/shared/math.js';

const BOOKS = {
  68: 'DraftKings',
  69: 'FanDuel',
  75: 'BetMGM',
  123: 'Caesars',
  71: 'BetRivers',
  79: 'bet365',
  247: 'Unibet',
};
const CONSENSUS = 15;
const OPENER = 30;

const median = (values) => {
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const nickname = (name) => (name || '').trim().split(' ').pop().toLowerCase();

// The feed sometimes carries a corrupt row, such as a game total of 16.5 sitting
// beside 229.5 from every other book. Left in, those show up as fake arbitrage.
export function cleanRows(rows) {
  const midTotal = median(rows.map((r) => r.total));
  const midSpread = median(rows.map((r) => r.spreadAway));
  return rows.map((r) => {
    const row = { ...r };
    if (row.total != null && midTotal != null && Math.abs(row.total - midTotal) > 10) {
      row.total = row.over = row.under = null;
    }
    if (row.spreadAway != null && midSpread != null && Math.abs(row.spreadAway - midSpread) > 5) {
      row.spreadAway = row.spreadAwayPrice = row.spreadHomePrice = null;
    }
    if (row.mlAway == null || row.mlHome == null || impliedProb(row.mlAway) + impliedProb(row.mlHome) < 0.9) {
      row.mlAway = row.mlHome = null;
    }
    return row;
  });
}

const parseRow = (o) => ({
  mlAway: o.ml_away ?? null,
  mlHome: o.ml_home ?? null,
  spreadAway: o.spread_away ?? null,
  spreadAwayPrice: o.spread_away_line ?? null,
  spreadHomePrice: o.spread_home_line ?? null,
  total: o.total ?? null,
  over: o.over ?? null,
  under: o.under ?? null,
});

// The v2 feed groups odds by book, then by market, with one entry per side. Flatten
// each book back into the single row parseRow reads, preferring pregame main lines.
export function bookRows(game) {
  return Object.entries(game.markets ?? {}).map(([bookId, { event = {} }]) => {
    const pick = (list, side) => {
      const options = (list ?? []).filter((o) => o.side === side && !o.is_alt_market);
      return options.find((o) => !o.is_live) ?? options[0];
    };
    const spreadAway = pick(event.spread, 'away');
    const over = pick(event.total, 'over');
    const under = pick(event.total, 'under');
    return {
      book_id: Number(bookId),
      ml_away: pick(event.moneyline, 'away')?.odds,
      ml_home: pick(event.moneyline, 'home')?.odds,
      spread_away: spreadAway?.value,
      spread_away_line: spreadAway?.odds,
      spread_home_line: pick(event.spread, 'home')?.odds,
      total: over?.value ?? under?.value,
      over: over?.odds,
      under: under?.odds,
    };
  });
}

const bestOf = (rows, field) =>
  rows.reduce((best, r) => {
    if (r[field] == null) return best;
    return !best || toDecimal(r[field]) > toDecimal(best.price) ? { price: r[field], book: r.book } : best;
  }, null);

function twoWay(game, label, rows, fieldA, fieldB, nameA, nameB, out) {
  const usable = rows.filter((r) => r[fieldA] != null && r[fieldB] != null);
  if (usable.length < 2) return;
  const a = bestOf(usable, fieldA);
  const b = bestOf(usable, fieldB);
  const sum = impliedProb(a.price) + impliedProb(b.price);
  if (sum < 1 && a.book !== b.book) {
    out.arbs.push({
      game,
      market: label,
      a: { name: nameA, ...a },
      b: { name: nameB, ...b },
      profit: 1 / sum - 1,
      stakeA: impliedProb(a.price) / sum,
    });
  }
  // Fair value is the average no-vig price across every book posting this number.
  const fairs = usable.map((r) => devig(r[fieldA], r[fieldB]));
  const fairA = fairs.reduce((s, f) => s + f[0], 0) / fairs.length;
  for (const [fair, best, name] of [
    [fairA, a, nameA],
    [1 - fairA, b, nameB],
  ]) {
    const ev = fair * toDecimal(best.price) - 1;
    if (usable.length >= 3 && ev > 0) {
      out.ev.push({ game, market: label, pick: name, price: best.price, book: best.book, fair, ev, books: usable.length });
    }
  }
}

export function scan(games) {
  const out = { arbs: [], middles: [], ev: [] };
  for (const g of games) {
    const game = `${g.away.abbr} @ ${g.home.abbr}`;
    const rows = g.books;
    twoWay(game, 'Moneyline', rows, 'mlAway', 'mlHome', g.away.abbr, g.home.abbr, out);

    for (const line of new Set(rows.map((r) => r.total).filter((v) => v != null))) {
      const at = rows.filter((r) => r.total === line);
      twoWay(game, `Total ${line}`, at, 'over', 'under', `Over ${line}`, `Under ${line}`, out);
    }
    for (const line of new Set(rows.map((r) => r.spreadAway).filter((v) => v != null))) {
      const at = rows.filter((r) => r.spreadAway === line);
      const sign = line > 0 ? '+' : '';
      const homeLine = -line > 0 ? `+${-line}` : `${-line}`;
      twoWay(game, 'Spread', at, 'spreadAwayPrice', 'spreadHomePrice', `${g.away.abbr} ${sign}${line}`, `${g.home.abbr} ${homeLine}`, out);
    }

    // Middles: both tickets can win if the final lands between the two numbers.
    const totals = rows.filter((r) => r.total != null && r.over != null && r.under != null);
    for (const low of totals) {
      for (const high of totals) {
        if (high.total - low.total < 1) continue;
        out.middles.push({
          game,
          market: 'Total',
          a: { name: `Over ${low.total}`, price: low.over, book: low.book },
          b: { name: `Under ${high.total}`, price: high.under, book: high.book },
          width: high.total - low.total,
          cost: impliedProb(low.over) + impliedProb(high.under) - 1,
        });
      }
    }
    const spreads = rows.filter((r) => r.spreadAway != null && r.spreadAwayPrice != null && r.spreadHomePrice != null);
    for (const dog of spreads) {
      for (const fav of spreads) {
        const width = dog.spreadAway - fav.spreadAway;
        if (width < 1) continue;
        const dogLine = dog.spreadAway > 0 ? `+${dog.spreadAway}` : `${dog.spreadAway}`;
        const favHome = -fav.spreadAway;
        out.middles.push({
          game,
          market: 'Spread',
          a: { name: `${g.away.abbr} ${dogLine}`, price: dog.spreadAwayPrice, book: dog.book },
          b: { name: `${g.home.abbr} ${favHome > 0 ? '+' : ''}${favHome}`, price: fav.spreadHomePrice, book: fav.book },
          width,
          cost: impliedProb(dog.spreadAwayPrice) + impliedProb(fav.spreadHomePrice) - 1,
        });
      }
    }
  }
  out.arbs.sort((a, b) => b.profit - a.profit);
  out.ev.sort((a, b) => b.ev - a.ev);
  out.middles.sort((a, b) => b.width - a.width || a.cost - b.cost);
  out.middles = out.middles.slice(0, 40);
  out.ev = out.ev.slice(0, 40);
  return out;
}

export function gameLines(date) {
  return cached(`lines-${date}`, 2 * MIN, async () => {
    const ids = [CONSENSUS, OPENER, ...Object.keys(BOOKS)].join(',');
    const data = await getJson(
      `https://api.actionnetwork.com/web/v2/scoreboard/nba?period=game&bookIds=${ids}&date=${date.replaceAll('-', '')}`,
    );
    const games = (data.games || []).map((g) => {
      const team = (id) => {
        const t = g.teams.find((x) => x.id === id);
        return { abbr: t?.abbr, name: t?.full_name, nickname: nickname(t?.full_name) };
      };
      const rows = bookRows(g);
      const of = (id) => {
        const row = rows.find((o) => o.book_id === id);
        return row ? parseRow(row) : null;
      };
      const books = cleanRows(
        rows.filter((o) => BOOKS[o.book_id]).map((o) => ({ book: BOOKS[o.book_id], ...parseRow(o) })),
      );
      return {
        id: g.id,
        start: g.start_time,
        status: g.status,
        away: team(g.away_team_id),
        home: team(g.home_team_id),
        consensus: of(CONSENSUS),
        open: of(OPENER),
        books,
      };
    });
    // Once a game tips, these lines are stale or live and can't be compared.
    const open = games.filter((g) => g.status === 'scheduled');
    return { books: Object.values(BOOKS), games, ...scan(open) };
  });
}
