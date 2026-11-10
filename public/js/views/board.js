// The Props page: hero, spotlight cards and every prop on the slate.

import { ago, api, empty, esc, fmtSlateDate, loading, logo, matchupCard, ordinal, teamFill } from '../ui.js';
import { MARKETS } from '/shared/math.js';
import { loadBoard, propTable, sortValue, withSide } from '../boarddata.js';
import { miniBars } from '../charts.js';
import { legFromRow, toggleLeg } from '../slip.js';

const COLUMNS = ['player', 'prop', 'price', 'last10', 'l5', 'l10', 'l20', 'season', 'h2h', 'streak', 'dvp', 'proj', 'ev', 'add'];
const PAGE = 60;
const POSITION_NAMES = { G: 'guards', F: 'forwards', C: 'centers' };

// Kept outside the view so filters survive a trip to a player page and back.
const state = {
  market: 'all',
  game: 'all',
  side: 'lean',
  query: '',
  positive: false,
  minL10: 0,
  sort: { key: 'sideEv', dir: -1 },
  limit: PAGE,
};

function boardTitle(date) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (date === today) return "Tonight's board";
  return `${new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long' })}'s board`;
}

// Three eye-catching facts about the slate. These are places to start researching,
// not recommendations, which is why none of them is chosen by estimated EV.
function spotlights(rows) {
  const all = rows.filter((r) => r.line >= 4.5 && r.market !== 'stl' && r.market !== 'blk');
  const out = [];
  // Each card gets a different player, so the row doesn't feature one person twice.
  const fresh = () => all.filter((r) => !out.some((c) => c.r.athleteId === r.athleteId));
  const byStreak = [...fresh()].sort((a, b) => Math.max(b.streakOver, b.streakUnder) - Math.max(a.streakOver, a.streakUnder))[0];
  if (byStreak && Math.max(byStreak.streakOver, byStreak.streakUnder) >= 3) {
    const r = withSide(byStreak, byStreak.streakOver >= byStreak.streakUnder ? 'over' : 'under');
    out.push({ r, eyebrow: 'Hottest streak', big: `${r.sideStreak} straight`, prop: `${r.sideName === 'over' ? 'Over' : 'Under'} ${r.line} ${MARKETS[r.market].label.toLowerCase()}` });
  }
  const soft = fresh()
    .filter((r) => r.dvpRank >= 26 && r.rates.l10.n >= 5 && r.rates.l10.over >= 0.6)
    .sort((a, b) => b.rates.l10.over + b.dvpRank / 30 - (a.rates.l10.over + a.dvpRank / 30))[0];
  if (soft) {
    const r = withSide(soft, 'over');
    out.push({ r, eyebrow: 'Softest matchup', big: `${r.opp} ranks ${ordinal(r.dvpRank)}`, prop: `Over ${r.line} ${MARKETS[r.market].label.toLowerCase()} vs ${POSITION_NAMES[r.pos]}. 30th is softest.` });
  }
  const moved = fresh()
    .filter((r) => r.openLine != null && r.openLine !== r.line)
    .sort((a, b) => Math.abs(b.line - b.openLine) / b.line - Math.abs(a.line - a.openLine) / a.line)[0];
  if (moved) {
    const r = withSide(moved, moved.line > moved.openLine ? 'over' : 'under');
    out.push({ r, eyebrow: 'Biggest line move', big: `${r.openLine} to ${r.line}`, prop: `${MARKETS[r.market].label} line moved ${r.line > r.openLine ? 'up' : 'down'} since opening` });
  }
  return out;
}

function spotlightHtml(rows) {
  const cards = spotlights(rows);
  if (!cards.length) return '';
  return `<h2 class="section-title">Spotlight</h2>
    <div class="spotlights">
      ${cards
        .map(({ r, eyebrow, big, prop }) => `<a class="spot" href="#/player/${esc(r.athleteId)}?m=${r.market}" style="--team:${teamFill(r.teamColor, r.teamAlt)}">
          <span class="spot-copy">
            <span class="caps eyebrow">${esc(eyebrow)}</span>
            <span class="spot-big">${esc(big)}</span>
            <span class="spot-name">${esc(r.name)}</span>
            <span class="spot-prop">${esc(prop)}</span>
            <span class="spot-bars">${miniBars(r.recent, r.line, r.sideName, 180, 34)}</span>
          </span>
          <img src="${esc(r.headshot || logo(r.team))}" alt="" loading="lazy">
        </a>`)
        .join('')}
    </div>`;
}

export async function boardView(view, { isCurrent }) {
  const res = await loadBoard((progress) => {
    view.innerHTML = loading(`${progress}. The first load can take up to a minute while box scores and game logs download.`);
  }, isCurrent);
  if (!res || !isCurrent()) return;
  let data = res.data;

  const filtered = () => {
    const q = state.query.trim().toLowerCase();
    const rows = [];
    for (const raw of data.rows) {
      if (state.market !== 'all' && raw.market !== state.market) continue;
      if (state.game !== 'all' && raw.gameId !== state.game) continue;
      if (q && !raw.name.toLowerCase().includes(q) && raw.team.toLowerCase() !== q) continue;
      const r = withSide(raw, state.side === 'lean' ? raw.side : state.side);
      if (state.positive && r.sideEv <= 0) continue;
      if (state.minL10 && !(r.sideRates.l10.n >= 5 && r.sideRates.l10.rate >= state.minL10)) continue;
      rows.push(r);
    }
    const { key, dir } = state.sort;
    return rows.sort((a, b) => {
      const x = sortValue(a, key);
      const y = sortValue(b, key);
      if (typeof x === 'string') return dir * x.localeCompare(y);
      return dir * ((x ?? -Infinity) - (y ?? -Infinity));
    });
  };

  const chip = (value, label, active) =>
    `<button type="button" class="chip ${active ? 'on' : ''}" data-market="${esc(value)}" aria-pressed="${active}">${label}</button>`;

  function heroHtml() {
    return `<section class="hero">
        <div class="hero-copy">
          <span class="caps eyebrow" id="board-meta"></span>
          <h1>${esc(boardTitle(data.date))}</h1>
          <p>Every DraftKings prop, with the history to check it against. Free, with no paywall.</p>
        </div>
        <div class="hero-games" role="group" aria-label="Filter by game" id="hero-games"></div>
      </section>`;
  }

  function renderGames() {
    document.getElementById('hero-games').innerHTML = data.games
      .map((g) => matchupCard(g, {
        tag: 'button',
        on: state.game === g.id,
        attrs: `type="button" data-game="${esc(g.id)}" aria-pressed="${state.game === g.id}" aria-label="Show only ${esc(g.away.abbr)} at ${esc(g.home.abbr)}"`,
      }))
      .join('');
  }

  function renderShell() {
    view.innerHTML = `${heroHtml()}
      <div id="board-spotlights">${spotlightHtml(data.rows)}</div>
      <div class="filters" id="controls"></div>
      <div id="board-table"></div>`;
    renderGames();
    renderControls();
  }

  function renderControls() {
    const markets = Object.entries(MARKETS).map(([k, m]) => chip(k, m.short, state.market === k)).join('');
    const picked = data.games.find((g) => g.id === state.game);
    document.getElementById('controls').innerHTML = `
      <div class="chips" role="group" aria-label="Market">${chip('all', 'All', state.market === 'all')}${markets}</div>
      <div class="filter-row">
        ${picked ? `<button type="button" class="chip on" data-game="all" aria-label="Show all games">${esc(picked.away.abbr)} @ ${esc(picked.home.abbr)} ×</button>` : ''}
        <label>Side <select id="f-side">
          <option value="lean" ${state.side === 'lean' ? 'selected' : ''}>Model lean</option>
          <option value="over" ${state.side === 'over' ? 'selected' : ''}>Over</option>
          <option value="under" ${state.side === 'under' ? 'selected' : ''}>Under</option>
        </select></label>
        <label>L10 hit <select id="f-l10">
          ${[0, 0.5, 0.6, 0.7, 0.8].map((v) => `<option value="${v}" ${state.minL10 === v ? 'selected' : ''}>${v ? `${Math.round(v * 100)}%+` : 'Any'}</option>`).join('')}
        </select></label>
        <label class="check"><input id="f-pos" type="checkbox" ${state.positive ? 'checked' : ''}> +EV only</label>
        <input id="f-query" type="search" placeholder="Filter by name or team" value="${esc(state.query)}" aria-label="Filter by name or team">
      </div>`;
  }

  function renderTable() {
    const rows = filtered();
    const positive = data.rows.filter((r) => Math.max(r.evOver, r.evUnder) > 0).length;
    document.getElementById('board-meta').textContent =
      `${fmtSlateDate(data.date)}  ·  ${data.games.length} ${data.games.length === 1 ? 'game' : 'games'}  ·  ${data.rows.length} props  ·  updated ${ago(data.built)}`;
    const host = document.getElementById('board-table');
    const note = `<p class="honest"><b class="caps">${positive} ${positive === 1 ? 'prop shows' : 'props show'} a positive estimate today</b>
      <span>That isn't proof of an edge. The backtest hasn't beaten closing lines yet: <a href="#/record">see the track record</a>.</span></p>`;
    if (!rows.length) {
      host.innerHTML = data.rows.length
        ? empty('No props match these filters', 'Try removing a filter or showing all games.')
        : empty('No lines posted yet', 'DraftKings usually posts player props the morning of a game.');
      return;
    }
    const shown = rows.slice(0, state.limit);
    host.innerHTML = `${note}
      ${propTable(shown, COLUMNS, state.sort)}
      <div class="table-foot">
        <span>Showing ${shown.length} of ${rows.length}</span>
        ${rows.length > shown.length ? '<button type="button" class="btn" id="more">Show more</button>' : ''}
      </div>`;
  }

  renderShell();
  renderTable();

  const onClick = (e) => {
    const market = e.target.closest('[data-market]');
    if (market) {
      state.market = market.dataset.market;
      state.limit = PAGE;
      renderControls();
      renderTable();
      return;
    }
    const game = e.target.closest('[data-game]');
    if (game) {
      const id = game.dataset.game;
      state.game = state.game === id ? 'all' : id;
      state.limit = PAGE;
      renderGames();
      renderControls();
      renderTable();
      return;
    }
    const sort = e.target.closest('[data-sort]');
    if (sort) {
      const key = sort.dataset.sort;
      state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: key === 'name' ? 1 : -1 };
      renderTable();
      return;
    }
    if (e.target.closest('#more')) {
      state.limit += PAGE;
      renderTable();
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const [athlete, market2, side] = add.dataset.add.split('|');
      const raw = data.rows.find((r) => r.key === `${athlete}|${market2}`);
      if (raw) toggleLeg(legFromRow(withSide(raw, side)));
      return;
    }
    // Clicking anywhere on a row opens the player, unless it landed on a control.
    const row = e.target.closest('tr[data-row]');
    if (row && !e.target.closest('a,button')) {
      const [id, m] = row.dataset.row.split('|');
      location.hash = `#/player/${id}?m=${m}`;
    }
  };
  const onInput = (e) => {
    if (e.target.id === 'f-query') {
      state.query = e.target.value;
      state.limit = PAGE;
      renderTable();
    }
  };
  const onChange = (e) => {
    if (e.target.id === 'f-side') state.side = e.target.value;
    else if (e.target.id === 'f-l10') state.minL10 = Number(e.target.value);
    else if (e.target.id === 'f-pos') state.positive = e.target.checked;
    else return;
    state.limit = PAGE;
    renderTable();
  };
  const onSlip = () => renderTable();
  view.addEventListener('click', onClick);
  view.addEventListener('input', onInput);
  view.addEventListener('change', onChange);
  document.addEventListener('slipchange', onSlip);

  // Keep prices fresh without disturbing the filters or scroll position.
  const timer = setInterval(async () => {
    try {
      const next = await api('/api/board');
      if (next.data && next.data.built !== data.built) {
        data = next.data;
        renderGames();
        document.getElementById('board-spotlights').innerHTML = spotlightHtml(data.rows);
        renderTable();
      }
    } catch {
      /* keep showing the last good board */
    }
  }, 60_000);

  return () => {
    clearInterval(timer);
    view.removeEventListener('click', onClick);
    view.removeEventListener('input', onInput);
    view.removeEventListener('change', onChange);
    document.removeEventListener('slipchange', onSlip);
  };
}
