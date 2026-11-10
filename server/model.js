// The projection model. Deliberately simple and fully inspectable: each factor
// is returned to the UI so a user can see exactly why a number is what it is.

import { MARKETS, statOf, lineProbs, impliedMean, devig } from '../public/shared/math.js';

export const CONFIG = {
  rateDecay: 0.96, // per-game decay on per-minute production
  minuteDecay: 0.82, // minutes react faster to role changes
  priorSeasonWeight: 0.5,
  rateWindow: 50,
  minuteWindow: 10,
  minGames: 5,
  dvpShrinkGames: 12, // regress a defense toward league average by this many games
  dvpPower: 0.6, // how much of a matchup effect reaches the projection
  envPower: { pts: 0.6, reb: 0.15, ast: 0.35, fg3m: 0.5, stl: 0, blk: 0, pa: 0.55, pr: 0.5, ra: 0.25, pra: 0.5 },
  vmrPrior: { pts: 3.2, reb: 1.7, ast: 1.7, fg3m: 1.35, stl: 1.1, blk: 1.35, pa: 3.3, pr: 3.0, ra: 2.0, pra: 3.2 },
  vmrShrinkGames: 25,
  // Share of the final estimate that comes from our model; the rest is the
  // market's implied mean. Chosen on the first half of the backtest, where the
  // best weight was 0.10 against closing lines and 0.20 against opening lines.
  modelWeight: 0.15,
};

const STATS = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk'];
const POSITIONS = ['G', 'F', 'C'];
export const normalizePos = (pos) => {
  const first = (pos || 'F').toUpperCase()[0];
  return first === 'P' || first === 'S' ? (pos[1]?.toUpperCase() === 'F' ? 'F' : 'G') : POSITIONS.includes(first) ? first : 'F';
};

// League context from box scores: what each defense allows by position, pace,
// and scoring. Only games passed in are used, so the backtest can't see the future.
export function buildContext(boxes) {
  const league = {};
  for (const pos of POSITIONS) league[pos] = { min: 0, pts: 0, reb: 0, ast: 0, fg3m: 0, stl: 0, blk: 0 };
  const teams = {};
  const team = (id) => (teams[id] ??= { games: [], scored: 0, allowed: 0, poss: 0, n: 0 });
  let pointsTotal = 0;
  let possTotal = 0;
  let teamGames = 0;

  for (const b of boxes) {
    const allowed = {
      [b.homeId]: { G: blank(), F: blank(), C: blank() },
      [b.awayId]: { G: blank(), F: blank(), C: blank() },
    };
    for (const p of b.players) {
      const pos = normalizePos(p.pos);
      const defender = p.teamId === b.homeId ? b.awayId : b.homeId;
      const bucket = allowed[defender]?.[pos];
      if (!bucket) continue;
      bucket.min += p.min;
      league[pos].min += p.min;
      for (const s of STATS) {
        bucket[s] += p[s];
        league[pos][s] += p[s];
      }
    }
    const possHome = b.pace?.[b.homeId] ?? 0;
    const possAway = b.pace?.[b.awayId] ?? 0;
    const poss = (possHome + possAway) / 2;
    for (const [id, scored, conceded] of [
      [b.homeId, b.homeScore, b.awayScore],
      [b.awayId, b.awayScore, b.homeScore],
    ]) {
      const t = team(id);
      t.games.push(allowed[id]);
      t.scored += scored || 0;
      t.allowed += conceded || 0;
      t.poss += poss;
      t.n++;
      pointsTotal += scored || 0;
      possTotal += poss;
      teamGames++;
    }
  }
  return {
    league,
    teams,
    avgTeamPoints: teamGames ? pointsTotal / teamGames : 114,
    avgPace: teamGames ? possTotal / teamGames : 100,
  };
}

function blank() {
  return { min: 0, pts: 0, reb: 0, ast: 0, fg3m: 0, stl: 0, blk: 0 };
}

const statTotal = (bucket, market) =>
  MARKETS[market].parts.reduce((sum, part) => sum + bucket[part], 0);

// Multiplier on a player's production from the opponent's defense at his position.
export function dvpFactor(ctx, oppId, pos, market) {
  const t = ctx.teams[oppId];
  const lg = ctx.league[pos];
  if (!t || !lg?.min) return 1;
  let min = 0;
  let stat = 0;
  for (const g of t.games) {
    min += g[pos].min;
    stat += statTotal(g[pos], market);
  }
  if (!min) return 1;
  const leagueRate = statTotal(lg, market) / lg.min;
  if (!leagueRate) return 1;
  const k = CONFIG.dvpShrinkGames;
  const n = t.games.length;
  const shrunk = ((n * stat) / min + k * leagueRate) / (n + k);
  return shrunk / leagueRate;
}

// Per-36 allowed to a position with league rank, over the full season or the
// last `window` games. Rank 1 is the toughest defense, 30 the softest.
export function dvpTable(ctx, window = null) {
  const rows = {};
  const leagueRates = {};
  for (const pos of POSITIONS) {
    leagueRates[pos] = {};
    for (const market of Object.keys(MARKETS)) {
      const lg = ctx.league[pos];
      leagueRates[pos][market] = lg.min ? (statTotal(lg, market) / lg.min) * 36 : 0;
    }
  }
  for (const [teamId, t] of Object.entries(ctx.teams)) {
    const games = window ? t.games.slice(-window) : t.games;
    rows[teamId] = { games: games.length };
    for (const pos of POSITIONS) {
      rows[teamId][pos] = {};
      for (const market of Object.keys(MARKETS)) {
        let min = 0;
        let stat = 0;
        for (const g of games) {
          min += g[pos].min;
          stat += statTotal(g[pos], market);
        }
        rows[teamId][pos][market] = { per36: min ? (stat / min) * 36 : null };
      }
    }
  }
  for (const pos of POSITIONS) {
    for (const market of Object.keys(MARKETS)) {
      const ranked = Object.keys(rows)
        .filter((id) => rows[id][pos][market].per36 != null)
        .sort((a, b) => rows[a][pos][market].per36 - rows[b][pos][market].per36);
      ranked.forEach((id, i) => {
        const cell = rows[id][pos][market];
        cell.rank = i + 1;
        cell.vsLeague = leagueRates[pos][market] ? cell.per36 / leagueRates[pos][market] - 1 : 0;
      });
    }
  }
  return { rows, leagueRates };
}

function weighted(games, decay, valueOf, season) {
  let sumW = 0;
  let sum = 0;
  games.forEach((g, i) => {
    const w = decay ** i * (g.season === season ? 1 : CONFIG.priorSeasonWeight);
    sumW += w;
    sum += w * valueOf(g);
  });
  return sumW ? sum / sumW : 0;
}

// Games played before a tip-off. Compares instants, not text: ESPN's two timestamp
// formats sort wrongly as strings, which once leaked a game's result into its own forecast.
export const priorLogs = (logs, tip, eventId) => {
  const cutoff = new Date(tip);
  return logs.filter((g) => g.eventId !== eventId && new Date(g.date) < cutoff);
};

// `logs` must be newest-first and contain only games before the one projected.
export function project({ logs, market, oppId, pos, home, spread, teamImplied, teamId, ctx, season, gameDate }) {
  const played = logs.filter((g) => g.min > 0);
  if (played.length < CONFIG.minGames) return null;

  const recent = played.slice(0, CONFIG.rateWindow);
  const rate =
    weighted(recent, CONFIG.rateDecay, (g) => statOf(g, market), season) /
    Math.max(weighted(recent, CONFIG.rateDecay, (g) => g.min, season), 1);
  const baseMinutes = weighted(played.slice(0, CONFIG.minuteWindow), CONFIG.minuteDecay, (g) => g.min, season);

  const daysOff = gameDate
    ? Math.round((new Date(gameDate) - new Date(played[0].date)) / 86_400_000)
    : 2;
  const restFactor = daysOff <= 1 ? 0.985 : 1;
  const blowout = spread != null ? Math.max(0, Math.abs(spread) - 9) : 0;
  const blowoutFactor = baseMinutes >= 24 ? 1 - 0.004 * blowout : 1;
  const minutes = baseMinutes * restFactor * blowoutFactor;

  const matchup = dvpFactor(ctx, oppId, pos, market) ** CONFIG.dvpPower;

  let environment = 1;
  const teamCtx = ctx.teams[teamId];
  if (teamImplied && teamCtx?.n) {
    // Regress the team's own scoring so a hot start doesn't distort the ratio.
    const baseline = (teamCtx.scored + 12 * ctx.avgTeamPoints) / (teamCtx.n + 12);
    environment = (teamImplied / baseline) ** CONFIG.envPower[market];
  }
  const venue = home ? 1.01 : 0.99;

  const mean = rate * minutes * matchup * environment * venue;

  // Spread comes from the player's own game-to-game variance, regressed toward
  // what's typical for the market.
  const sample = played.slice(0, 40).map((g) => statOf(g, market));
  const sampleMean = sample.reduce((a, b) => a + b, 0) / sample.length;
  const sampleVar =
    sample.reduce((a, b) => a + (b - sampleMean) ** 2, 0) / Math.max(sample.length - 1, 1);
  const ownVmr = sampleMean > 0 ? sampleVar / sampleMean : CONFIG.vmrPrior[market];
  const k = CONFIG.vmrShrinkGames;
  const vmr = Math.max(
    1.02,
    (sample.length * ownVmr + k * CONFIG.vmrPrior[market]) / (sample.length + k),
  );

  return {
    mean,
    vmr,
    factors: { rate, baseMinutes, minutes, matchup, environment, venue, restFactor, blowoutFactor, daysOff },
  };
}

// Combines the model with the market's own view of the player, on the scale of
// the stat itself, so every line on the ladder comes from a single distribution.
export function estimate(proj, line, over, under, weight = CONFIG.modelWeight) {
  const [fairOver, fairUnder] = devig(over, under);
  const marketMean = impliedMean(line, fairOver, proj.vmr);
  const mean = weight * proj.mean + (1 - weight) * marketMean;
  const probs = lineProbs(mean, proj.vmr, line);
  return { mean, marketMean, fairOver, fairUnder, probOver: probs.over, probUnder: probs.under };
}
