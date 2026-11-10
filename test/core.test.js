import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  impliedProb, toDecimal, decimalToAmerican, devig, expectedValue, kelly,
  lineProbs, impliedMean, hitRate, streak,
} from '../public/shared/math.js';
import { priorLogs, buildContext, dvpFactor, dvpTable, project, estimate, normalizePos } from '../server/model.js';
import { parseProps, parseGameLog } from '../server/espn.js';
import { cleanRows, scan } from '../server/lines.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('odds conversions', () => {
  near(impliedProb(-110), 110 / 210);
  near(impliedProb(150), 0.4);
  near(toDecimal(-200), 1.5);
  near(toDecimal(150), 2.5);
  assert.equal(decimalToAmerican(2.5), 150);
  assert.equal(decimalToAmerican(1.5), -200);
  near(expectedValue(0.5, 100), 0);
  assert.equal(kelly(0.4, 100), 0);
  near(kelly(0.6, 100), 0.2);
});

test('every devig method returns probabilities summing to 1', () => {
  for (const method of ['multiplicative', 'additive', 'power', 'shin']) {
    const [a, b] = devig(-160, 130, method);
    near(a + b, 1, 1e-4);
    assert.ok(a > b);
  }
});

test('line probabilities partition and handle pushes', () => {
  for (const [mu, vmr] of [[22, 3], [0.8, 1.1], [3, 1], [40, 3.2]]) {
    for (const line of [0.5, 3, 12.5, 22]) {
      const p = lineProbs(mu, vmr, line);
      near(p.over + p.under + p.push, 1, 1e-9);
    }
  }
  assert.equal(lineProbs(10, 2, 9.5).push, 0);
  assert.ok(lineProbs(10, 2, 10).push > 0);
  assert.ok(lineProbs(30, 3, 22.5).over > lineProbs(15, 3, 22.5).over);
});

test('impliedMean inverts lineProbs', () => {
  const mean = impliedMean(22.5, 0.56, 3.1);
  near(lineProbs(mean, 3.1, 22.5).over, 0.56, 1e-3);
});

test('hit rate and streak read newest-first games', () => {
  const games = [{ pts: 30 }, { pts: 25 }, { pts: 10 }, { pts: 40 }];
  const r = hitRate(games, 'pts', 20.5);
  assert.equal(r.over, 3);
  near(r.avg, 26.25);
  assert.equal(streak(games, 'pts', 20.5, 'over'), 2);
  assert.equal(streak(games, 'pts', 20.5, 'under'), 0);
});

// Regression test: text comparison of "…T23:30:00.000+00:00" against "…T23:30Z"
// let a game's own result into its forecast and produced a fake 30% ROI.
test('priorLogs never includes the game being forecast', () => {
  const logs = [
    { eventId: 'b', date: '2026-11-01T23:30:00.000+00:00', pts: 50 },
    { eventId: 'a', date: '2026-10-30T23:30:00.000+00:00', pts: 10 },
  ];
  const kept = priorLogs(logs, '2026-11-01T23:30Z', 'b');
  assert.deepEqual(kept.map((g) => g.eventId), ['a']);
  // Same instant under another id is still not "before".
  assert.deepEqual(priorLogs(logs, '2026-11-01T23:30Z', 'zzz').map((g) => g.eventId), ['a']);
});

const propRow = (id, type, value, price, open) => ({
  athlete: { $ref: `http://x/athletes/${id}?lang=en` },
  type: { name: type },
  odds: { american: { value: price, open } },
  current: { target: { value } },
  open: { target: { value } },
  lastUpdated: '2026-11-06T23:16Z',
});

test('parseProps labels first row over, second under, and reads alt lines', () => {
  const { main, alts } = parseProps([
    propRow(1, 'Total Rebounds', 9.5, '-139', '-116'),
    propRow(1, 'Total Rebounds', 9.5, '+105', '-110'),
    propRow(1, 'Rebounds Milestones', 10, '-139', '-104'),
    propRow(2, 'Total Points', 20.5, 'EVEN', '-110'),
    { type: { name: 'Team Total Points' }, odds: { american: { value: '-110' } } },
  ]);
  assert.equal(main.length, 1, 'unpaired and team rows are dropped');
  assert.equal(main[0].over, -139);
  assert.equal(main[0].under, 105);
  assert.equal(main[0].market, 'reb');
  assert.deepEqual(alts, [{ athleteId: '1', market: 'reb', threshold: 10, price: -139 }]);
});

test('parseGameLog drops preseason and maps stats by name', () => {
  const names = ['minutes', 'fieldGoalsMade-fieldGoalsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted', 'totalRebounds', 'assists', 'blocks', 'steals', 'fouls', 'turnovers', 'points'];
  const meta = (id, day) => ({ gameDate: `2026-10-${day}T23:00:00.000+00:00`, atVs: '@', opponent: { id: '5', abbreviation: 'CLE' }, team: { id: '9' }, gameResult: 'W', score: '1-0' });
  const stats = ['30', '12-19', '2-5', '2-2', '10', '3', '3', '1', '0', '0', '28'];
  const games = parseGameLog({
    names,
    events: { r1: meta('r1', 25), p1: meta('p1', 5) },
    seasonTypes: [
      { displayName: '2026-27 Regular Season', categories: [{ type: 'event', events: [{ eventId: 'r1', stats }] }, { type: 'total', events: [] }] },
      { displayName: '2026-27 Preseason', categories: [{ type: 'event', events: [{ eventId: 'p1', stats }] }] },
    ],
  }, 2027);
  assert.equal(games.length, 1);
  assert.equal(games[0].pts, 28);
  assert.equal(games[0].fg3m, 2);
  assert.equal(games[0].reb, 10);
  assert.equal(games[0].home, false);
});

function fakeBoxes() {
  const player = (teamId, pos, pts) => ({ id: `${teamId}${pos}`, teamId, pos, min: 30, pts, reb: 5, ast: 5, stl: 1, blk: 1, fg3m: 2 });
  return Array.from({ length: 10 }, (_, i) => ({
    id: String(i), homeId: 'soft', awayId: 'tough', homeScore: 110, awayScore: 110, pace: { soft: 100, tough: 100 },
    players: [player('soft', 'G', 12), player('tough', 'G', 30)], // tough's guards score on soft
  }));
}

test('defense vs position identifies soft and tough defenses', () => {
  const ctx = buildContext(fakeBoxes());
  assert.ok(dvpFactor(ctx, 'soft', 'G', 'pts') > 1);
  assert.ok(dvpFactor(ctx, 'tough', 'G', 'pts') < 1);
  const t = dvpTable(ctx);
  assert.equal(t.rows.tough.G.pts.rank, 1);
  assert.equal(t.rows.soft.G.pts.rank, 2);
  assert.ok(t.rows.soft.G.pts.vsLeague > 0);
});

test('project and estimate stay between model and market', () => {
  const ctx = buildContext(fakeBoxes());
  const logs = Array.from({ length: 20 }, (_, i) => ({
    eventId: String(i), season: 2027, date: `2026-10-${String(28 - i).padStart(2, '0')}T23:00:00.000Z`, min: 30, pts: 20 + (i % 5), reb: 5, ast: 5, stl: 1, blk: 0, fg3m: 2,
  }));
  const proj = project({ logs, market: 'pts', oppId: 'soft', pos: 'G', home: true, spread: -2, teamImplied: 115, teamId: 'soft', ctx, season: 2027, gameDate: '2026-11-05T23:00:00Z' });
  assert.ok(proj.mean > 15 && proj.mean < 35, `mean ${proj.mean}`);
  assert.equal(project({ logs: logs.slice(0, 3), market: 'pts', oppId: 'soft', pos: 'G', home: true, ctx, season: 2027 }), null);
  const est = estimate(proj, 24.5, -110, -110, 0.15);
  near(est.fairOver, 0.5);
  const lo = Math.min(proj.mean, est.marketMean);
  const hi = Math.max(proj.mean, est.marketMean);
  assert.ok(est.mean >= lo && est.mean <= hi);
  near(estimate(proj, 24.5, -110, -110, 0).probOver, 0.5, 1e-3);
});

test('normalizePos collapses every label to G, F or C', () => {
  assert.deepEqual(['G', 'PG', 'SG', 'F', 'SF', 'PF', 'C', null].map(normalizePos), ['G', 'G', 'G', 'F', 'F', 'F', 'C', 'F']);
});

test('cleanRows removes corrupt totals seen in the live feed', () => {
  const rows = cleanRows([
    { book: 'A', total: 229.5, over: -110, under: -110, mlAway: 260, mlHome: -324 },
    { book: 'B', total: 229.5, over: -112, under: -108, mlAway: 260, mlHome: -320 },
    { book: 'C', total: 16.5, over: -135, under: 100, mlAway: 260, mlHome: -325 },
  ]);
  assert.equal(rows[2].total, null);
  assert.equal(rows[0].total, 229.5);
});

const scanGame = (books) => [{ away: { abbr: 'AAA' }, home: { abbr: 'HHH' }, books }];
const emptyLine = { spreadAway: null, spreadAwayPrice: null, spreadHomePrice: null, total: null, over: null, under: null };

test('scan finds a real arbitrage with correct stake split', () => {
  const { arbs } = scan(scanGame([
    { book: 'A', mlAway: 120, mlHome: -140, ...emptyLine },
    { book: 'B', mlAway: 100, mlHome: 110, ...emptyLine },
  ]));
  assert.equal(arbs.length, 1);
  const arb = arbs[0];
  assert.equal(arb.a.book, 'A');
  assert.equal(arb.b.book, 'B');
  near(arb.profit, 1 / (impliedProb(120) + impliedProb(110)) - 1);
  // Both outcomes must pay the same.
  const payA = arb.stakeA * toDecimal(120);
  const payB = (1 - arb.stakeA) * toDecimal(110);
  near(payA, payB);
});

test('scan reports no arbitrage on a normal market and finds middles', () => {
  const { arbs, middles } = scan(scanGame([
    { book: 'A', mlAway: 100, mlHome: -120, spreadAway: null, spreadAwayPrice: null, spreadHomePrice: null, total: 220.5, over: -110, under: -110 },
    { book: 'B', mlAway: 102, mlHome: -122, spreadAway: null, spreadAwayPrice: null, spreadHomePrice: null, total: 222.5, over: -110, under: -110 },
  ]));
  assert.equal(arbs.length, 0);
  assert.equal(middles.length, 1);
  assert.equal(middles[0].a.name, 'Over 220.5');
  assert.equal(middles[0].b.name, 'Under 222.5');
  assert.equal(middles[0].width, 2);
});
