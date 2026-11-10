// Turns raw data into what the app shows: the props board and player pages.

import {
  scoreboard, eventProps, teams, roster, injuries, playerLogs, seasonGames, box,
  etDate, addDays, seasonYear, athleteInfo,
} from './espn.js';
import { buildContext, dvpTable, project, estimate, normalizePos, priorLogs } from './model.js';
import { MARKETS, hitRate, statOf, streak, expectedValue, lineProbs } from '../public/shared/math.js';

const MIN = 60_000;
const memo = new Map();
function memoize(key, ttl, load) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = load().catch((err) => {
    memo.delete(key);
    throw err;
  });
  memo.set(key, { at: Date.now(), promise });
  return promise;
}

export function league(date) {
  return memoize(`league-${date}`, 20 * MIN, async () => {
    const season = seasonYear(date);
    const games = (await seasonGames(season, date)).filter((g) => g.seasonType === 2);
    const boxes = (await Promise.all(games.map((g) => box(g).catch(() => null)))).filter(Boolean);
    return { ctx: buildContext(boxes), games: boxes.length };
  });
}

export async function directory() {
  return memoize('directory', 60 * MIN, async () => {
    const list = await teams();
    const rosters = await Promise.all(list.map((t) => roster(t.id).catch(() => [])));
    const players = new Map();
    const teamById = new Map(list.map((t) => [t.id, t]));
    rosters.flat().forEach((p) => players.set(p.id, p));
    return { players, teamById, teams: list };
  });
}

// The date the app opens on: today while games remain, otherwise the next slate.
export async function currentSlateDate() {
  const today = etDate();
  for (let i = 0; i < 8; i++) {
    const date = addDays(today, i);
    const games = await scoreboard(date);
    if (games.some((g) => g.state === 'pre')) return date;
  }
  return today;
}

// The Games page stays on today until every game has finished, so live scores stay up.
export async function gamesDate() {
  const today = etDate();
  const games = await scoreboard(today);
  return games.some((g) => g.state !== 'post') ? today : currentSlateDate();
}

const pickSide = (evOver, evUnder) => (evOver >= evUnder ? 'over' : 'under');

function buildRow(prop, game, player, logs, ctx, table, injury, season) {
  const onHome = player.teamId === game.home.id;
  const oppId = onHome ? game.away.id : game.home.id;
  const pos = normalizePos(player.pos);
  const history = priorLogs(logs, game.start, game.id);
  const proj = project({
    logs: history,
    market: prop.market,
    oppId,
    pos,
    home: onHome,
    spread: game.spread,
    teamImplied: onHome ? game.impliedHome : game.impliedAway,
    teamId: player.teamId,
    ctx,
    season,
    gameDate: game.start,
  });
  if (!proj) return null;
  const est = estimate(proj, prop.line, prop.over, prop.under);
  const evOver = expectedValue(est.probOver, prop.over);
  const evUnder = expectedValue(est.probUnder, prop.under);
  const side = pickSide(evOver, evUnder);
  const thisSeason = history.filter((g) => g.season === season);
  const windows = {
    l5: history.slice(0, 5),
    l10: history.slice(0, 10),
    l20: history.slice(0, 20),
    season: thisSeason,
    h2h: history.filter((g) => g.oppId === oppId),
  };
  const rates = {};
  for (const [k, games] of Object.entries(windows)) {
    const r = hitRate(games, prop.market, prop.line);
    rates[k] = { n: r.n, over: r.overPct, under: r.underPct, avg: r.avg };
  }
  const dvp = table.rows[oppId]?.[pos]?.[prop.market];
  const opponent = onHome ? game.away : game.home;
  const team = onHome ? game.home : game.away;
  return {
    key: `${player.id}|${prop.market}`,
    athleteId: player.id,
    name: player.name,
    short: player.short,
    headshot: player.headshot,
    pos,
    teamId: team.id,
    team: team.abbr,
    teamColor: team.color,
    teamAlt: team.alt,
    oppId,
    opp: opponent.abbr,
    home: onHome,
    gameId: game.id,
    start: game.start,
    market: prop.market,
    line: prop.line,
    over: prop.over,
    under: prop.under,
    openLine: prop.openLine,
    openOver: prop.openOver,
    openUnder: prop.openUnder,
    updated: prop.updated,
    proj: round(proj.mean),
    est: round(est.mean),
    marketMean: round(est.marketMean),
    vmr: round(proj.vmr, 3),
    minutes: round(proj.factors.minutes),
    fairOver: est.fairOver,
    fairUnder: est.fairUnder,
    probOver: est.probOver,
    probUnder: est.probUnder,
    evOver,
    evUnder,
    side,
    rates,
    // Oldest first, so the row's mini chart reads forward in time like the player page.
    recent: history.slice(0, 10).map((g) => statOf(g, prop.market)).reverse(),
    streakOver: streak(history, prop.market, prop.line, 'over'),
    streakUnder: streak(history, prop.market, prop.line, 'under'),
    dvpRank: dvp?.rank ?? null,
    dvpVs: dvp?.vsLeague ?? null,
    dvpPer36: dvp?.per36 ?? null,
    injury: injury ? { status: injury.status, note: injury.note } : null,
  };
}

const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

const boards = new Map();

async function computeBoard(date, onProgress) {
  const season = seasonYear(date);
  const games = (await scoreboard(date)).filter((g) => g.state === 'pre');
  onProgress('Reading league box scores');
  const [{ ctx, games: boxCount }, dir, injured] = await Promise.all([league(date), directory(), injuries()]);
  const table = dvpTable(ctx);
  onProgress('Loading player props');
  const props = await Promise.all(games.map((g) => eventProps(g.id).then((p) => ({ game: g, ...p }))));

  const ids = new Set();
  for (const p of props) for (const m of p.main) ids.add(m.athleteId);
  let done = 0;
  onProgress(`Loading game logs 0/${ids.size}`);
  const logs = new Map();
  const info = new Map();
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        logs.set(id, await playerLogs(id, date));
        const known = dir.players.get(id);
        info.set(id, known ?? (await athleteInfo(id)));
      } catch {
        /* one unavailable player shouldn't sink the board */
      }
      done++;
      if (done % 20 === 0) onProgress(`Loading game logs ${done}/${ids.size}`);
    }),
  );

  const rows = [];
  for (const { game, main } of props) {
    for (const prop of main) {
      const player = info.get(prop.athleteId);
      const playerLog = logs.get(prop.athleteId);
      if (!player || !playerLog) continue;
      const injury = injured[prop.athleteId];
      if (/^out$/i.test(injury?.status ?? '')) continue;
      const fromGame = [game.home.id, game.away.id].includes(player.teamId)
        ? player
        : { ...player, teamId: playerLog[0]?.teamId ?? player.teamId };
      if (![game.home.id, game.away.id].includes(fromGame.teamId)) continue;
      const row = buildRow(prop, game, fromGame, playerLog, ctx, table, injury, season);
      if (row) rows.push(row);
    }
  }
  return { date, built: new Date().toISOString(), games, rows, boxGames: boxCount };
}

// Serves the last good board immediately and refreshes it behind the scenes, so a
// slow rebuild never blocks a page load.
export function board(date) {
  let state = boards.get(date);
  if (!state) {
    state = { data: null, builtAt: 0, job: null, progress: 'Starting', error: null };
    boards.set(date, state);
  }
  const stale = Date.now() - state.builtAt > 3 * MIN;
  if (stale && !state.job) {
    state.job = computeBoard(date, (msg) => {
      state.progress = msg;
    })
      .then((data) => {
        state.data = data;
        state.builtAt = Date.now();
        state.error = null;
      })
      .catch((err) => {
        state.error = err.message;
        console.error('board build failed', err);
      })
      .finally(() => {
        state.job = null;
      });
  }
  return { data: state.data, building: !!state.job, progress: state.progress, error: state.error };
}

export async function slate(date) {
  const [games, injured, dir] = await Promise.all([scoreboard(date), injuries(), directory()]);
  return {
    date,
    games: games.map((g) => {
      const list = (teamId) =>
        Object.entries(injured)
          .filter(([, v]) => v.teamId === teamId)
          .map(([id, v]) => ({ id, name: v.name || dir.players.get(id)?.name, status: v.status, note: v.note }));
      return { ...g, homeInjuries: list(g.home.id), awayInjuries: list(g.away.id) };
    }),
  };
}

async function nextGameFor(teamId, fromDate) {
  for (let i = 0; i < 8; i++) {
    const games = await scoreboard(addDays(fromDate, i));
    const game = games.find((g) => g.state === 'pre' && (g.home.id === teamId || g.away.id === teamId));
    if (game) return game;
  }
  return null;
}

export async function player(id) {
  const today = etDate();
  const season = seasonYear(today);
  const [dir, injured, { ctx }, logs] = await Promise.all([directory(), injuries(), league(today), playerLogs(id, today)]);
  const profile = dir.players.get(id) ?? (await athleteInfo(id));
  const teamId = profile.teamId ?? logs[0]?.teamId;
  const team = dir.teamById.get(teamId) ?? null;
  const pos = normalizePos(profile.pos);
  const game = teamId ? await nextGameFor(teamId, today) : null;
  const table = dvpTable(ctx);

  let props = { main: [], alts: [] };
  if (game) props = await eventProps(game.id).catch(() => props);

  const markets = {};
  for (const market of Object.keys(MARKETS)) {
    const line = props.main.find((p) => p.athleteId === id && p.market === market) ?? null;
    let proj = null;
    let est = null;
    let oppId = null;
    let dvp = null;
    if (game) {
      const onHome = game.home.id === teamId;
      oppId = onHome ? game.away.id : game.home.id;
      proj = project({
        logs: priorLogs(logs, game.start, game.id),
        market,
        oppId,
        pos,
        home: onHome,
        spread: game.spread,
        teamImplied: onHome ? game.impliedHome : game.impliedAway,
        teamId,
        ctx,
        season,
        gameDate: game.start,
      });
      if (proj && line) est = estimate(proj, line.line, line.over, line.under);
      dvp = table.rows[oppId]?.[pos]?.[market] ?? null;
    }
    const mean = est?.mean ?? proj?.mean ?? null;
    const alts = props.alts
      .filter((a) => a.athleteId === id && a.market === market && Math.abs(a.price) < 3000)
      .sort((a, b) => a.threshold - b.threshold)
      .map((a) => {
        const prob = mean != null ? lineProbs(mean, proj.vmr, a.threshold - 0.5).over : null;
        return { threshold: a.threshold, price: a.price, prob, ev: prob != null ? expectedValue(prob, a.price) : null };
      });
    markets[market] = {
      line,
      proj: proj && { mean: round(proj.mean), vmr: round(proj.vmr, 3), factors: proj.factors },
      est,
      dvp,
      alts,
    };
  }

  // Teammates on the injury report, with the games they played in, so the page can
  // split this player's numbers by whether each teammate was on the floor.
  const absences = Object.entries(injured).filter(([pid, v]) => v.teamId === teamId && pid !== id);
  const teammates = (
    await Promise.all(
      absences.map(async ([pid, v]) => {
        try {
          const theirs = await playerLogs(pid, today);
          const sameTeam = theirs.filter((g) => g.teamId === teamId);
          if (sameTeam.length < 5) return null;
          return {
            id: pid,
            name: v.name || dir.players.get(pid)?.name || 'Teammate',
            status: v.status,
            played: theirs.map((g) => g.eventId),
            // Before this date they weren't on the team, so their absence means nothing.
            since: sameTeam[sameTeam.length - 1].date,
            avgMin: theirs.slice(0, 10).reduce((a, g) => a + g.min, 0) / Math.min(theirs.length, 10),
          };
        } catch {
          return null;
        }
      }),
    )
  )
    .filter((t) => t && t.avgMin >= 15)
    .sort((a, b) => b.avgMin - a.avgMin);

  return {
    profile: { ...profile, pos, teamId },
    team,
    injury: injured[id] ?? null,
    season,
    game,
    oppId: game ? (game.home.id === teamId ? game.away.id : game.home.id) : null,
    logs,
    markets,
    teammates,
  };
}

export async function dvp(date, window) {
  const [{ ctx, games }, dir, today] = await Promise.all([league(date), directory(), scoreboard(date)]);
  const table = dvpTable(ctx, window);
  const matchups = {};
  for (const g of today) {
    if (g.state === 'post') continue;
    matchups[g.home.id] = g.away;
    matchups[g.away.id] = g.home;
  }
  return { ...table, teams: dir.teams, matchups, games };
}

export async function players() {
  const dir = await directory();
  return [...dir.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    pos: p.pos,
    headshot: p.headshot,
    team: dir.teamById.get(p.teamId)?.abbr ?? '',
  }));
}
