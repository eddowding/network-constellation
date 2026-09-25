// The landing state: drop a Connections.csv in, get a constellation out.
//
// Nothing here uploads anything. The file is read with FileReader, parsed and
// classified in this tab, and the result is kept in this browser. The word
// "upload" is avoided in the copy for that reason.

import { $, esc, fmt } from './dom.js';
import { parseCSV, decodeCsv } from './csv.js';
import { deNote, buildGraph, detectColumns, columnsUsable, BuildError } from './build.js';
import { saveGraph, requestPersistence, storeProblem } from './store.js';
import { mergeExports, ownerFromFilename, TEAM_COLUMNS } from './team.js';

/** Which column plays which role, in the order the mapper shows them. */
const ROLES = [
  ['name', 'Full name', false],
  ['first', 'First name', false],
  ['last', 'Last name', false],
  ['headline', 'Headline', false],
  ['position', 'Position', false],
  ['company', 'Company', false],
  ['url', 'Profile URL', false],
  ['connectedOn', 'Connected on', false]
];

/**
 * The landing page. It knows how to read a file and build a graph from it; it
 * does not know what else is on the page. main.js tells it two things:
 *
 *   setDemo(fn)   — the demo is ready; fn(question?) opens it. Without it the
 *                   demo buttons are hidden.
 *   setBack(text) — a graph is already running behind the page; show a way
 *                   back to it, and let Escape take it.
 *
 * `onBuilt(built)` is the fallback for a browser that will not store the
 * graph: it returns true if it could show the graph without a reload.
 */
export function createLanding({ onBuilt } = {}) {
  const el = $('landing');
  const drop = $('dropzone');
  const input = $('csvFile');
  const state = $('landingState');
  const back = $('landingBack');

  // One entry per dropped export: { name, owner, rows, columns, encodingNote }.
  // Several teammates' files pool into one network; each keeps its owner so
  // every contact can say who on the team knows them.
  let exports = [];
  let rows = null;          // the export being column-mapped, if any
  let columns = null;
  let sourceName = '';
  let encodingNote = '';
  let mapping = null;       // that export's entry
  let openDemo = null;
  let accepting = true;     // false in a single-file build that carries its own graph

  const isUp = () => !el.classList.contains('gone');
  const show = () => {
    el.classList.remove('gone');
    document.body.classList.add('landing-up');
  };
  const hide = () => {
    el.classList.add('gone');
    document.body.classList.remove('landing-up');
  };

  function setDemo(fn) {
    openDemo = fn;
    el.classList.toggle('no-demo', !fn);
  }

  function setBack(text) {
    back.hidden = !text;
    if (text) back.textContent = text;
    // with a user's own graph behind the page there is no demo to open from here
    el.classList.toggle('returning', Boolean(text) && !openDemo);
  }

  const say = (html, kind = '') => {
    state.className = 'landing-state' + (kind ? ' ' + kind : '');
    state.innerHTML = html;
  };

  /* ---- reading a file ---- */

  // What to do instead, for the files that are not a CSV but get dropped anyway.
  const NOT_CSV = {
    'linkedin-zip': ['That is LinkedIn’s whole download.', 'Unzip it and drop the Connections.csv from inside.'],
    xlsx: ['That is an Excel workbook.', 'Open it in Excel or Numbers and save it as CSV (in Excel, File → Save As → CSV UTF-8), then drop that.'],
    xls: ['That is an older Excel workbook.', 'Open it and save it as CSV (in Excel, File → Save As → CSV UTF-8), then drop that.'],
    zip: ['That is a zip archive.', 'Unzip it and drop the CSV from inside.']
  };

  /** Several files at once: read them all, then show the list. */
  async function takeAll(files) {
    const problems = [];
    for (const file of files) {
      const problem = await take(file, { quiet: true });
      if (problem) problems.push(problem);
    }
    if (mapping) return;                          // a file needs its columns set first
    if (exports.length) summarise(problems);
    else say(problems.join('') || '<span class="ls-mono">Nothing to read.</span>', 'bad');
  }

  /** Read one file into `exports`. With `quiet`, returns a problem instead of showing it. */
  async function take(file, { quiet = false } = {}) {
    const fail = html => { if (quiet) return html; say(html, 'bad'); return html; };
    if (!quiet) say(`<span class="ls-mono">Reading ${esc(file.name)}…</span>`);
    let decoded;
    try {
      decoded = decodeCsv(new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      console.error(err);
      return fail(`<span class="ls-mono">Could not read ${esc(file.name)}.</span>`);
    }
    if (decoded.kind) {
      const [what, next] = NOT_CSV[decoded.kind];
      return fail(`<span class="ls-mono">${esc(file.name)}: ${esc(what)}</span><span class="ls-note">${esc(next)}</span>`);
    }
    return takeText(decoded.text, file.name, decoded.encoding, { quiet });
  }

  function takeText(text, name, encoding = 'utf-8', { quiet = false } = {}) {
    const fail = html => { if (!quiet) say(html, 'bad'); return html; };
    const note = encoding === 'windows-1252'
      ? 'Not UTF-8, so read as Windows-1252 (what Excel saves). If accented names look wrong, save it again as “CSV UTF-8”.'
      : '';
    let parsed;
    try {
      parsed = parseCSV(deNote(text));
    } catch (err) {
      console.error(err);
      return fail(`<span class="ls-mono">${esc(name)} does not parse as CSV.</span>`);
    }
    if (!parsed.length) return fail(`<span class="ls-mono">${esc(name)} has no rows in it.</span>`);

    const ex = {
      name,
      owner: ownerFromFilename(name),
      rows: parsed,
      columns: detectColumns(parsed[0]),
      encodingNote: note
    };
    // the same file dropped twice replaces itself
    const same = exports.findIndex(e => e.name === name);
    if (same >= 0) { ex.owner = exports[same].owner || ex.owner; exports[same] = ex; }
    else exports.push(ex);

    if (!columnsUsable(ex.columns)) { remap(ex, 'Could not tell which column is which. Set them here.'); return null; }
    if (!quiet) summarise();
    return null;
  }

  /** Point the mapper at one export. */
  function remap(ex, message) {
    mapping = ex;
    rows = ex.rows;
    columns = ex.columns;
    sourceName = ex.name;
    encodingNote = ex.encodingNote;
    mapper(message);
  }

  /* ---- what we think the columns are ---- */

  /** The first person's name as it will be shown, so a bad decode is visible before building. */
  function firstName() {
    const r = rows[0];
    if (columns.name) return r[columns.name] || '';
    return [r[columns.first], r[columns.last]].filter(Boolean).join(' ');
  }

  /**
   * The exports so far, one row each: who it belongs to (editable — it is
   * what every "via" in the answers will say), the file, its size, and what
   * was understood of its columns. One export builds a personal map as
   * before; two or more pool into a team network.
   */
  function summarise(problems = []) {
    mapping = null;
    const n = exports.reduce((a, e) => a + e.rows.length, 0);
    const team = exports.length > 1;
    const list = exports.map((e, i) => {
      const named = ROLES
        .filter(([k]) => e.columns[k])
        .map(([k, label]) => `<span class="col"><span class="col-k">${label}</span>${esc(e.columns[k])}</span>`)
        .join('');
      return `<div class="ex-row" data-i="${i}">` +
        `<div class="ex-top">` +
          `<input type="text" class="ex-owner" data-i="${i}" value="${esc(e.owner)}" placeholder="Whose connections?" aria-label="Whose connections are in ${esc(e.name)}" autocomplete="off" spellcheck="false">` +
          `<span class="ls-mono ex-meta">${fmt(e.rows.length)} rows · ${esc(e.name)}</span>` +
          `<button type="button" class="linky ex-cols" data-i="${i}">Columns</button>` +
          `<button type="button" class="d-close ex-drop" data-i="${i}" aria-label="Remove ${esc(e.name)}">&times;</button>` +
        `</div>` +
        (exports.length === 1 ? `<div class="cols">${named}</div>` : '') +
        (e.encodingNote ? `<span class="ls-note">${esc(e.encodingNote)}</span>` : '') +
      `</div>`;
    }).join('');

    say(
      problems.join('') +
      `<div class="ls-head"><span class="ls-mono">${exports.length} ${exports.length === 1 ? 'export' : 'exports'} · ${fmt(n)} rows</span>` +
      `<button type="button" class="linky" id="addExport">Add a teammate’s export</button></div>` +
      `<div class="ex-list">${list}</div>` +
      (team
        ? '<span class="ls-note">Contacts in more than one export are merged, and each remembers who on the team knows them. Name every export: that name is what “who can introduce” will say.</span>'
        : '<span class="ls-note">Add teammates’ exports to pool them into one network and see who can introduce whom. Name this one so it can be told apart.</span>') +
      `<span class="ls-note" id="ownerWarn"></span>` +
      `<button type="button" class="primary" id="buildBtn">${team ? 'Build the team network' : 'Build the constellation'}</button>`
    );

    const check = () => {
      const names = exports.map(e => e.owner.trim().toLowerCase());
      const missing = team && names.some(x => !x);
      const dup = names.filter(Boolean).length !== new Set(names.filter(Boolean)).size;
      $('ownerWarn').textContent = missing
        ? 'Give every export an owner.'
        : dup ? 'Two exports share an owner; they will be treated as one person’s.' : '';
      $('buildBtn').disabled = missing;
    };
    for (const inp of state.querySelectorAll('.ex-owner')) {
      inp.addEventListener('input', () => { exports[Number(inp.dataset.i)].owner = inp.value; check(); });
    }
    for (const b of state.querySelectorAll('.ex-cols')) {
      b.addEventListener('click', () => remap(exports[Number(b.dataset.i)]));
    }
    for (const b of state.querySelectorAll('.ex-drop')) {
      b.addEventListener('click', () => {
        exports.splice(Number(b.dataset.i), 1);
        if (exports.length) summarise(); else say('');
      });
    }
    $('addExport').addEventListener('click', () => input.click());
    $('buildBtn').addEventListener('click', build);
    check();
  }

  /* ---- manual column mapping ---- */

  function mapper(message) {
    const headers = Object.keys(rows[0]);
    const options = k =>
      ['<option value="">— none —</option>']
        .concat(headers.map(h =>
          `<option value="${esc(h)}"${columns[k] === h ? ' selected' : ''}>${esc(h)}</option>`))
        .join('');

    say(
      (message ? `<span class="ls-note">${esc(message)}</span>` : '') +
      `<div class="map">` +
      ROLES.map(([k, label]) =>
        `<label class="map-row"><span class="map-k">${label}</span>` +
        `<select data-role="${k}">${options(k)}</select></label>`).join('') +
      `</div>` +
      `<span class="ls-note" id="mapWarn"></span>` +
      `<button type="button" class="primary" id="buildBtn">Use these columns</button>`
    );

    const selects = [...state.querySelectorAll('select[data-role]')];
    const sync = () => {
      for (const s of selects) columns[s.dataset.role] = s.value || null;
      if (mapping) mapping.columns = columns;
      const ok = columnsUsable(columns);
      $('buildBtn').disabled = !ok;
      $('mapWarn').textContent = ok
        ? ''
        : 'Needs a name (or first and last) and either a headline or a position.';
    };
    selects.forEach(s => s.addEventListener('change', sync));
    sync();
    $('buildBtn').addEventListener('click', () => summarise());
  }

  /* ---- build, keep, reload ---- */

  async function build() {
    const btn = $('buildBtn');
    // Classifying is quick (about 0.1 s for 10,000 people); keeping several
    // megabytes in IndexedDB and reloading is what takes a moment. Each phase
    // is named on the button, and the button gets a frame to repaint first.
    const phase = async text => {
      if (btn) btn.textContent = text;
      // a frame to paint in, or 50 ms if the tab is in the background and has none
      await new Promise(r => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 50); });
    };
    if (btn) btn.disabled = true;
    const total = exports.reduce((a, e) => a + e.rows.length, 0);
    await phase(exports.length > 1 ? `Merging ${exports.length} exports…` : `Classifying ${fmt(total)} people…`);

    let built;
    const sourceName = exports.length > 1
      ? `${exports.length} exports: ${exports.map(e => e.owner.trim()).join(', ')}`
      : exports[0].name;
    try {
      // Always pooled, even for one export: the owner is what the answers
      // name, and a second export added later extends the same network.
      const merged = mergeExports(exports.map(e => ({ owner: e.owner, rows: e.rows, columns: e.columns })));
      await phase(`Classifying ${fmt(merged.rows.length)} people…`);
      built = buildGraph(merged.rows, {
        columns: TEAM_COLUMNS, knownBy: merged.knownBy, team: merged.team, tidyCompanies: true
      });
      built.merge = merged.stats;
    } catch (err) {
      const detail = err instanceof BuildError && err.detail?.found
        ? ` Found: ${err.detail.found.join(', ')}` : '';
      say(`<span class="ls-mono">${esc(err.message)}${esc(detail)}</span>`, 'bad');
      console.error(err);
      return;
    }

    try {
      await phase('Keeping it in this browser…');
      await requestPersistence();
      // The raw exports are kept too, so the next teammate's file can be added
      // without asking everyone to drop theirs again.
      await saveGraph({
        D: built.D, people: built.people, sourceName,
        exports: exports.map(({ name, owner, rows, columns }) => ({ name, owner, rows, columns }))
      });
      await phase('Opening…');
    } catch (err) {
      // The graph is built; this browser just will not keep it. Show it now
      // if nothing else is running, and say plainly that a reload loses it.
      console.error('Could not keep the graph in this browser.', err);
      if (await onBuilt?.(built, sourceName)) { hide(); return; }
      say(
        `<span class="ls-mono">Built, but this browser would not store it.</span>` +
        `<span class="ls-note">${esc(storeProblem.message || 'Browser storage is unavailable here.')} ` +
        `Close other tabs of this page and try again.</span>` +
        `<button type="button" class="primary" id="buildBtn">Try again</button>`, 'bad');
      $('buildBtn').addEventListener('click', build);
      return;
    }
    location.reload();
  }

  /* ---- wiring ---- */

  // Reset after every pick, or choosing the same file a second time (after
  // fixing a column, say) fires no change event at all.
  input.addEventListener('change', e => {
    const files = [...e.target.files];
    input.value = '';
    if (files.length) takeAll(files);
  });

  drop.addEventListener('click', e => { if (!e.target.closest('button, a')) input.click(); });
  drop.addEventListener('keydown', e => {
    if (e.target !== drop) return;       // the button inside answers for itself
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  $('pickFile').addEventListener('click', e => { e.preventDefault(); input.click(); });

  // The whole page is a drop target, the landing's own zone just says so most
  // loudly. A file dropped on the running graph opens the landing with it,
  // rather than being swallowed or navigating the tab away to the raw CSV.
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    depth++;
    drop.classList.add('over');
  });
  addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) { depth = 0; drop.classList.remove('over'); }
  });
  addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.classList.remove('over');
    const files = [...e.dataTransfer.files];
    if (!files.length || !accepting) return;
    if (!isUp()) show();
    $('lp-drop')?.scrollIntoView({ block: 'center' });
    takeAll(files);
  });

  el.addEventListener('scroll', () => el.classList.toggle('scrolled', el.scrollTop > 8), { passive: true });

  // In-page links scroll the landing rather than touching the URL.
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    const target = $(a.dataset.goto);
    target?.scrollIntoView({ block: a.dataset.goto === 'lp-drop' ? 'center' : 'start' });
    if (a.dataset.goto === 'lp-drop') drop.focus({ preventScroll: true });
  });

  $('tryDemo').addEventListener('click', () => openDemo?.());
  for (const chip of el.querySelectorAll('[data-ask]')) {
    chip.addEventListener('click', () => openDemo?.(chip.dataset.ask));
  }

  back.addEventListener('click', hide);
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && isUp() && !back.hidden) hide();
  });

  /** The exports behind the running graph, so another can be added to them. */
  function setExports(list) {
    exports = (list || []).map(e => ({ ...e, encodingNote: '' }));
    if (exports.length) summarise();
  }

  setDemo(null);
  return { show, hide, isUp, setDemo, setBack, takeText, setExports, setAccept: v => { accepting = v; } };
}
