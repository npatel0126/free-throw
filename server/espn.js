// Everything we read from ESPN's public JSON endpoints, trimmed to what the app uses.

import { cached, getJson, NotFoundError, MIN, HOUR, DAY, FOREVER } from './cache.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba';

// Dates are NBA slate dates, which follow US Eastern time.
export const etDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
export const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const compact = (date) => date.replaceAll('-', '');

// The NBA season year is the year it ends: 2026-27 is 2027.
export const seasonYear = (date) => {
  const [y, m] = date.split('-').map(Number);
  return m >= 8 ? y + 1 : y;
};

const american = (v) => {
  if (v == null || v === '') return null;
  if (String(v).toUpperCase() === 'EVEN') return 100;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

function parseCompetitor(c) {
  return {
    id: c.team.id,
    abbr: c.team.abbreviation,
    name: c.team.displayName,
    short: c.team.shortDisplayName,
    logo: c.team.logo,
    color: c.team.color,
    alt: c.team.alternateColor,
    score: c.score != null ? Number(c.score) : null,
    record: c.records?.find((r) => r.type === 'total')?.summary ?? null,
  };
}

// Reads the home team's spread from text like "ATL -8.5", which is unambiguous,
// unlike the bare number ESPN sends next to it.
function homeSpread(details, home, away) {
  if (!details) return null;
  if (details.toUpperCase() === 'EVEN') return 0;
  const match = details.match(/^(\S+)\s+(-?[\d.]+)/);
  if (!match) return null;
  const value = Number(match[2]);
  if (match[1] === home.abbr) return value;
  if (match[1] === away.abbr) return -value;
  return null;
}

function parseEvent(e) {
  const c = e.competitions[0];
  const home = parseCompetitor(c.competitors.find((x) => x.homeAway === 'home'));
  const away = parseCompetitor(c.competitors.find((x) => x.homeAway === 'away'));
  const odds = c.odds?.[0];
  const spread = homeSpread(odds?.details, home, away);
  const total = odds?.overUnder ?? null;
  return {
    id: e.id,
    start: e.date,
    state: e.status.type.state,
    completed: e.status.type.completed,
    statusText: e.status.type.shortDetail,
    seasonType: e.season?.type ?? 2,
    home,
    away,
    spread,
    total,
    impliedHome: spread != null && total != null ? (total - spread) / 2 : null,
    impliedAway: spread != null && total != null ? (total + spread) / 2 : null,
    moneyHome: american(odds?.moneyline?.home?.close?.odds),
    moneyAway: american(odds?.moneyline?.away?.close?.odds),
    book: odds?.provider?.name ?? null,
  };
}

export function scoreboard(date) {
  const today = etDate();
  return cached(
    `scoreboard-${date}`,
    (games) => {
      if (date < addDays(today, -1) && games.every((g) => g.completed)) return FOREVER;
      return date > today ? 10 * MIN : 90_000;
    },
    async () => {
      const data = await getJson(`${SITE}/scoreboard?dates=${compact(date)}`);
      return (data.events || []).map(parseEvent);
    },
  );
}

// --- Player props -----------------------------------------------------------

const MAIN_TYPES = {
  'Total Points': 'pts',
  'Total Rebounds': 'reb',
  'Total Assists': 'ast',
  'Total 3-Point Field Goals': 'fg3m',
  'Total Steals': 'stl',
  'Total Blocks': 'blk',
  'Total Points and Assists': 'pa',
  'Total Points and Rebounds': 'pr',
  'Total Assists and Rebounds': 'ra',
  'Total Points, Rebounds, and Assists': 'pra',
};
const ALT_TYPES = {
  'Points Milestones': 'pts',
  'Rebounds Milestones': 'reb',
  'Assists Milestones': 'ast',
  '3-Point Field Goals Milestones': 'fg3m',
  'Steals Milestones': 'stl',
  'Blocks Milestones': 'blk',
  'Points + Assists Milestones': 'pa',
  'Points + Rebounds Milestones': 'pr',
  'Rebounds + Assists Milestones': 'ra',
  'Points + Assists + Rebounds Milestones': 'pra',
};

// ESPN sends a two-way prop as two unlabelled rows. The first is the over: we
// checked this against the over-only milestone price at the same number, where
// the first row matched in 54 of 55 markets on a full game.
export function parseProps(items) {
  const groups = new Map();
  const alts = [];
  for (const row of items) {
    const athleteId = row.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1];
    if (!athleteId) continue;
    const altMarket = ALT_TYPES[row.type?.name];
    if (altMarket) {
      const threshold = row.current?.target?.value;
      const price = american(row.odds?.american?.value);
      if (threshold != null && price != null) {
        alts.push({ athleteId, market: altMarket, threshold, price });
      }
      continue;
    }
    const market = MAIN_TYPES[row.type?.name];
    if (!market) continue;
    const line = row.current?.target?.value;
    if (line == null) continue;
    const key = `${athleteId}|${market}|${line}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const best = new Map();
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const [overRow, underRow] = rows;
    const over = american(overRow.odds.american.value);
    const under = american(underRow.odds.american.value);
    if (over == null || under == null) continue;
    const id = overRow.athlete.$ref.match(/athletes\/(\d+)/)[1];
    const market = MAIN_TYPES[overRow.type.name];
    const entry = {
      athleteId: id,
      market,
      line: overRow.current.target.value,
      over,
      under,
      openLine: overRow.open?.target?.value ?? null,
      openOver: american(overRow.odds.american.open),
      openUnder: american(underRow.odds.american.open),
      updated: overRow.lastUpdated ?? null,
    };
    // If a book lists more than one main line, keep the most balanced one.
    const key = `${id}|${market}`;
    const balance = (e) => Math.abs(Math.abs(e.over) - Math.abs(e.under));
    if (!best.has(key) || balance(entry) < balance(best.get(key))) best.set(key, entry);
  }
  return { main: [...best.values()], alts };
}

export function eventProps(eventId, completed = false) {
  return cached(
    `props-${eventId}${completed ? '-final' : ''}`,
    completed ? FOREVER : 4 * MIN,
    async () => {
      const base = `${CORE}/events/${eventId}/competitions/${eventId}/odds/100/propBets?limit=1000`;
      try {
        const first = await getJson(base);
        const items = [...first.items];
        for (let page = 2; page <= (first.pageCount || 1); page++) {
          const next = await getJson(`${base}&page=${page}`);
          items.push(...next.items);
        }
        return parseProps(items);
      } catch (err) {
        if (err instanceof NotFoundError) return { main: [], alts: [] };
        throw err;
      }
    },
  );
}

// --- Teams, rosters, injuries ----------------------------------------------

export function teams() {
  return cached('teams-v2', 7 * DAY, async () => {
    const data = await getJson(`${SITE}/teams?limit=40`);
    return data.sports[0].leagues[0].teams.map(({ team: t }) => ({
      id: t.id,
      abbr: t.abbreviation,
      name: t.displayName,
      short: t.shortDisplayName,
      logo: t.logos?.[0]?.href ?? null,
      color: t.color,
      alt: t.alternateColor,
    }));
  });
}

export function roster(teamId) {
  return cached(`roster-${teamId}`, 3 * HOUR, async () => {
    const data = await getJson(`${SITE}/teams/${teamId}/roster`);
    return (data.athletes || []).map((a) => ({
      id: a.id,
      name: a.displayName,
      short: a.shortName,
      pos: a.position?.abbreviation ?? 'F',
      jersey: a.jersey ?? null,
      headshot: a.headshot?.href ?? null,
      teamId,
    }));
  });
}

export function injuries() {
  return cached('injuries', 10 * MIN, async () => {
    const data = await getJson(`${SITE}/injuries`);
    const byAthlete = {};
    for (const team of data.injuries || []) {
      for (const item of team.injuries || []) {
        const href = item.athlete?.links?.find((l) => l.rel?.includes('playercard'))?.href;
        const id = href?.match(/\/id\/(\d+)/)?.[1];
        if (!id) continue;
        byAthlete[id] = {
          status: item.status,
          note: item.shortComment ?? '',
          date: item.date ?? null,
          teamId: team.id,
          name: item.athlete?.displayName ?? '',
        };
      }
    }
    return byAthlete;
  });
}

// --- Player game logs ------------------------------------------------------

const makes = (v) => Number(String(v).split('-')[0]) || 0;
const attempts = (v) => Number(String(v).split('-')[1]) || 0;

export function parseGameLog(data, season) {
  const index = Object.fromEntries((data.names || []).map((name, i) => [name, i]));
  const games = [];
  const seen = new Set();
  for (const type of data.seasonTypes || []) {
    if (/preseason/i.test(type.displayName)) continue;
    for (const cat of type.categories || []) {
      if (cat.type !== 'event') continue;
      for (const row of cat.events || []) {
        const meta = data.events?.[row.eventId];
        if (!meta || seen.has(row.eventId)) continue;
        seen.add(row.eventId);
        const s = row.stats;
        const stat = (name) => Number(s[index[name]]) || 0;
        const fg = s[index['fieldGoalsMade-fieldGoalsAttempted']];
        const fg3 = s[index['threePointFieldGoalsMade-threePointFieldGoalsAttempted']];
        const ft = s[index['freeThrowsMade-freeThrowsAttempted']];
        games.push({
          eventId: row.eventId,
          date: meta.gameDate,
          season,
          oppId: meta.opponent?.id,
          oppAbbr: meta.opponent?.abbreviation,
          teamId: meta.team?.id,
          home: meta.atVs !== '@',
          result: meta.gameResult,
          score: meta.score,
          min: stat('minutes'),
          pts: stat('points'),
          reb: stat('totalRebounds'),
          ast: stat('assists'),
          stl: stat('steals'),
          blk: stat('blocks'),
          to: stat('turnovers'),
          pf: stat('fouls'),
          fgm: makes(fg),
          fga: attempts(fg),
          fg3m: makes(fg3),
          fg3a: attempts(fg3),
          ftm: makes(ft),
          fta: attempts(ft),
        });
      }
    }
  }
  return games.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function athleteLog(athleteId, season, isCurrent) {
  return cached(
    `log-${athleteId}-${season}`,
    isCurrent ? 45 * MIN : 30 * DAY,
    async () => {
      try {
        const data = await getJson(`${WEB}/athletes/${athleteId}/gamelog?season=${season}`);
        return parseGameLog(data, season);
      } catch (err) {
        if (err instanceof NotFoundError) return [];
        throw err;
      }
    },
  );
}

// Newest first, across this season and last.
export async function playerLogs(athleteId, date) {
  const season = seasonYear(date);
  const [current, prior] = await Promise.all([
    athleteLog(athleteId, season, true),
    athleteLog(athleteId, season - 1, false),
  ]);
  return [...current, ...prior];
}

// --- Box scores: the source for defense-vs-position and pace --------------

function parseBox(summary, eventId, game) {
  const players = [];
  const pace = {};
  for (const side of summary.boxscore?.players || []) {
    const table = side.statistics?.[0];
    if (!table) continue;
    const keys = table.keys || [];
    const at = Object.fromEntries(keys.map((k, i) => [k, i]));
    for (const a of table.athletes || []) {
      if (a.didNotPlay || !a.stats?.length) continue;
      const min = Number(a.stats[at.minutes]) || 0;
      if (min <= 0) continue;
      const get = (k) => Number(a.stats[at[k]]) || 0;
      players.push({
        id: a.athlete.id,
        teamId: side.team.id,
        pos: a.athlete.position?.abbreviation ?? 'F',
        starter: !!a.starter,
        min,
        pts: get('points'),
        reb: get('rebounds'),
        ast: get('assists'),
        stl: get('steals'),
        blk: get('blocks'),
        fg3m: makes(a.stats[at['threePointFieldGoalsMade-threePointFieldGoalsAttempted']]),
      });
    }
  }
  for (const t of summary.boxscore?.teams || []) {
    const stat = (name) => t.statistics?.find((s) => s.name === name)?.displayValue;
    const fga = attempts(stat('fieldGoalsMade-fieldGoalsAttempted'));
    const fta = attempts(stat('freeThrowsMade-freeThrowsAttempted'));
    const oreb = Number(stat('offensiveRebounds')) || 0;
    const tov = Number(stat('totalTurnovers') ?? stat('turnovers')) || 0;
    pace[t.team.id] = fga - oreb + tov + 0.44 * fta;
  }
  const pick = summary.pickcenter?.[0];
  return {
    id: eventId,
    date: game.start,
    homeId: game.home.id,
    awayId: game.away.id,
    homeScore: game.home.score,
    awayScore: game.away.score,
    spread: game.spread ?? homeSpread(pick?.details, game.home, game.away),
    total: game.total ?? pick?.overUnder ?? null,
    pace,
    players,
  };
}

export function box(game) {
  return cached(`box-${game.id}`, FOREVER, async () => {
    const summary = await getJson(`${SITE}/summary?event=${game.id}`);
    return parseBox(summary, game.id, game);
  });
}

// Completed games of a season (regular season and playoffs), oldest first.
export async function seasonGames(season, throughDate = etDate()) {
  const out = [];
  const days = [];
  let day = `${season - 1}-10-01`;
  const last = season === seasonYear(throughDate) ? throughDate : `${season}-06-30`;
  while (day <= last) {
    days.push(day);
    day = addDays(day, 1);
  }
  const results = await Promise.all(days.map((d) => scoreboard(d).catch(() => [])));
  for (const games of results) {
    for (const g of games) if (g.completed && g.seasonType >= 2) out.push(g);
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function athleteInfo(athleteId) {
  return cached(`athlete-${athleteId}`, 6 * HOUR, async () => {
    const data = await getJson(`${WEB}/athletes/${athleteId}`);
    const a = data.athlete;
    return {
      id: a.id,
      name: a.displayName,
      short: a.shortName,
      pos: a.position?.abbreviation ?? 'F',
      jersey: a.jersey ?? null,
      headshot: a.headshot?.href ?? null,
      teamId: a.team?.id ?? null,
    };
  });
}
