// Walk-forward test of the model against real sportsbook lines from this season.
// ESPN's lastUpdated stamps can sit in the future, so they can't date a price. We
// checked that market accuracy is the same across stamps, which rules out live odds.
// For each prop in a finished game, the model sees only earlier games, then we
// compare its forecast with the market's and with what actually happened.

import { box, eventProps, etDate, playerLogs, seasonGames, seasonYear } from './espn.js';
import { buildContext, project, estimate, normalizePos, priorLogs, CONFIG } from './model.js';
import { cached, HOUR } from './cache.js';
import { expectedValue, statOf } from '../public/shared/math.js';

const logLoss = (p, won) => -Math.log(Math.min(Math.max(won ? p : 1 - p, 1e-6), 1 - 1e-6));

// Collect one record per settled prop, keeping the raw parts so that different
// model weights can be replayed without refetching anything.
export async function collectSamples(date = etDate(), onProgress = () => {}) {
  const season = seasonYear(date);
  const games = (await seasonGames(season, date)).filter((g) => g.seasonType === 2);
  const boxes = new Map();
  await Promise.all(
    games.map(async (g) => {
      try {
        boxes.set(g.id, await box(g));
      } catch {
        /* a missing box only shrinks the sample */
      }
    }),
  );
  onProgress(`boxes: ${boxes.size}/${games.length}`);
  const props = new Map();
  await Promise.all(
    games.map(async (g) => {
      try {
        props.set(g.id, await eventProps(g.id, true));
      } catch {
        /* same */
      }
    }),
  );
  const withProps = games.filter((g) => props.get(g.id)?.main.length);
  onProgress(`games with lines: ${withProps.length}/${games.length}`);

  const athleteIds = new Set();
  for (const g of withProps) for (const p of props.get(g.id).main) athleteIds.add(p.athleteId);
  const logs = new Map();
  await Promise.all(
    [...athleteIds].map(async (id) => {
      try {
        logs.set(id, await playerLogs(id, date));
      } catch {
        /* same */
      }
    }),
  );
  onProgress(`player logs: ${logs.size}`);

  const samples = [];
  const ordered = [...withProps].sort((a, b) => (a.start < b.start ? -1 : 1));
  for (const g of ordered) {
    const prior = games
      .filter((x) => x.start < g.start && boxes.has(x.id))
      .map((x) => boxes.get(x.id));
    const ctx = buildContext(prior);
    const b = boxes.get(g.id);
    const posById = new Map((b?.players || []).map((p) => [p.id, normalizePos(p.pos)]));
    for (const p of props.get(g.id).main) {
      const all = logs.get(p.athleteId);
      if (!all) continue;
      const actualGame = all.find((x) => x.eventId === g.id);
      if (!actualGame || actualGame.min <= 0) continue; // DNP voids the bet
      const history = priorLogs(all, g.start, g.id);
      const pos = posById.get(p.athleteId) ?? 'F';
      const home = actualGame.teamId === g.home.id;
      const proj = project({
        logs: history,
        market: p.market,
        oppId: home ? g.away.id : g.home.id,
        pos,
        home,
        spread: g.spread,
        teamImplied: home ? g.impliedHome : g.impliedAway,
        teamId: actualGame.teamId,
        ctx,
        season,
        gameDate: g.start,
      });
      if (!proj) continue;
      samples.push({
        gameId: g.id,
        date: g.start,
        athleteId: p.athleteId,
        market: p.market,
        line: p.line,
        over: p.over,
        under: p.under,
        openLine: p.openLine,
        openOver: p.openOver,
        openUnder: p.openUnder,
        proj: { mean: proj.mean, vmr: proj.vmr },
        actual: statOf(actualGame, p.market),
      });
    }
  }
  return { samples, gamesTested: withProps.length, gamesTotal: games.length };
}

// Scores one model weight against the outcomes. Whole-number lines that push
// are excluded, since neither side wins.
export function score(samples, weight, evThreshold = 0.03) {
  let n = 0;
  let marketLoss = 0;
  let modelLoss = 0;
  const buckets = Array.from({ length: 10 }, () => ({ n: 0, predicted: 0, hits: 0 }));
  const bets = { n: 0, won: 0, staked: 0, profit: 0 };
  const mae = { market: 0, model: 0, blend: 0 };
  for (const s of samples) {
    if (s.actual === s.line) continue;
    const est = estimate(s.proj, s.line, s.over, s.under, weight);
    const won = s.actual > s.line;
    n++;
    marketLoss += logLoss(est.fairOver, won);
    modelLoss += logLoss(est.probOver, won);
    mae.market += Math.abs(est.marketMean - s.actual);
    mae.model += Math.abs(s.proj.mean - s.actual);
    mae.blend += Math.abs(est.mean - s.actual);

    const bucket = buckets[Math.min(9, Math.floor(est.probOver * 10))];
    bucket.n++;
    bucket.predicted += est.probOver;
    bucket.hits += won ? 1 : 0;

    const evOver = expectedValue(est.probOver, s.over);
    const evUnder = expectedValue(est.probUnder, s.under);
    const side = evOver >= evUnder ? 'over' : 'under';
    if (Math.max(evOver, evUnder) >= evThreshold) {
      const price = side === 'over' ? s.over : s.under;
      const betWon = side === 'over' ? won : !won;
      bets.n++;
      bets.staked += 1;
      if (betWon) {
        bets.won++;
        bets.profit += price < 0 ? 100 / -price : price / 100;
      } else {
        bets.profit -= 1;
      }
    }
  }
  return {
    n,
    weight,
    marketLogLoss: marketLoss / n,
    modelLogLoss: modelLoss / n,
    mae: { market: mae.market / n, model: mae.model / n, blend: mae.blend / n },
    calibration: buckets
      .filter((b) => b.n > 0)
      .map((b, i) => ({ predicted: b.predicted / b.n, actual: b.hits / b.n, n: b.n })),
    bets: { ...bets, roi: bets.staked ? bets.profit / bets.staked : 0, winPct: bets.n ? bets.won / bets.n : 0 },
  };
}

export const WEIGHTS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1];

export function chronologicalSplit(samples) {
  const sorted = [...samples].sort((a, b) => (a.date < b.date ? -1 : 1));
  const cut = Math.floor(sorted.length / 2);
  return [sorted.slice(0, cut), sorted.slice(cut)];
}

// Re-prices every sample at the opening number instead of the closing one.
export const atOpen = (samples) =>
  samples
    .filter((s) => s.openLine != null && s.openOver != null && s.openUnder != null)
    .map((s) => ({ ...s, line: s.openLine, over: s.openOver, under: s.openUnder }));

// What you'd make betting every over, or every under, with no analysis at all.
export function blind(samples) {
  const out = { over: { n: 0, won: 0, profit: 0 }, under: { n: 0, won: 0, profit: 0 } };
  for (const s of samples) {
    if (s.actual === s.line) continue;
    for (const side of ['over', 'under']) {
      const price = s[side];
      const won = side === 'over' ? s.actual > s.line : s.actual < s.line;
      out[side].n++;
      if (won) {
        out[side].won++;
        out[side].profit += price < 0 ? 100 / -price : price / 100;
      } else {
        out[side].profit -= 1;
      }
    }
  }
  for (const side of ['over', 'under']) {
    out[side].winPct = out[side].won / out[side].n;
    out[side].roi = out[side].profit / out[side].n;
  }
  return out;
}

// One flat $1 bet per prop whose best side clears the EV threshold.
export function placedBets(samples, weight, evThreshold) {
  const out = [];
  for (const s of samples) {
    if (s.actual === s.line) continue;
    const est = estimate(s.proj, s.line, s.over, s.under, weight);
    const evOver = expectedValue(est.probOver, s.over);
    const evUnder = expectedValue(est.probUnder, s.under);
    const side = evOver >= evUnder ? 'over' : 'under';
    if (Math.max(evOver, evUnder) < evThreshold) continue;
    const price = side === 'over' ? s.over : s.under;
    const won = side === 'over' ? s.actual > s.line : s.actual < s.line;
    out.push({ gameId: s.gameId, side, won, profit: won ? (price < 0 ? 100 / -price : price / 100) : -1 });
  }
  return out;
}

const summarize = (bets) => {
  const profit = bets.reduce((a, b) => a + b.profit, 0);
  const won = bets.filter((b) => b.won).length;
  return { n: bets.length, winPct: bets.length ? won / bets.length : null, roi: bets.length ? profit / bets.length : null };
};

// 90% interval on ROI, resampling whole games because props in one game move together.
export function bootstrapRoi(bets, rounds = 2000) {
  const byGame = new Map();
  for (const b of bets) {
    if (!byGame.has(b.gameId)) byGame.set(b.gameId, []);
    byGame.get(b.gameId).push(b.profit);
  }
  const groups = [...byGame.values()];
  if (!groups.length) return null;
  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const rois = [];
  for (let r = 0; r < rounds; r++) {
    let profit = 0;
    let n = 0;
    for (let i = 0; i < groups.length; i++) {
      const group = groups[Math.floor(random() * groups.length)];
      for (const p of group) profit += p;
      n += group.length;
    }
    rois.push(profit / n);
  }
  rois.sort((a, b) => a - b);
  return { low: rois[Math.floor(rounds * 0.05)], high: rois[Math.floor(rounds * 0.95)] };
}

export function report(collected) {
  const { samples, gamesTested, gamesTotal } = collected;
  const weight = CONFIG.modelWeight;
  const [early, late] = chronologicalSplit(samples);
  const thresholdRows = (set) =>
    [0.01, 0.02, 0.03, 0.05, 0.08].map((t) => {
      const bets = placedBets(set, weight, t);
      return { threshold: t, ...summarize(bets), ci: bootstrapRoi(bets) };
    });
  const headline = placedBets(samples, weight, 0.02);
  const closing = score(samples, weight);
  const opens = atOpen(samples);
  const firstDate = samples.reduce((m, s) => (s.date < m ? s.date : m), samples[0]?.date ?? '');
  const lastDate = samples.reduce((m, s) => (s.date > m ? s.date : m), '');
  return {
    generated: new Date().toISOString(),
    weight,
    samples: samples.length,
    gamesTested,
    gamesTotal,
    firstDate,
    lastDate,
    logLoss: { market: closing.marketLogLoss, blend: closing.modelLogLoss, modelOnly: score(samples, 1).modelLogLoss },
    mae: closing.mae,
    calibration: closing.calibration,
    closing: thresholdRows(samples),
    opening: thresholdRows(opens),
    halves: {
      first: summarize(placedBets(early, weight, 0.02)),
      second: summarize(placedBets(late, weight, 0.02)),
    },
    sides: {
      over: summarize(headline.filter((b) => b.side === 'over')),
      under: summarize(headline.filter((b) => b.side === 'under')),
    },
    blind: blind(samples),
    sweep: WEIGHTS.map((w) => {
      const r = score(samples, w);
      return { weight: w, logLoss: r.modelLogLoss };
    }),
  };
}

export const trackRecord = (date) =>
  cached(`record-${date}`, 12 * HOUR, async () => report(await collectSamples(date)));
