// The team panel and the target-accounts sheet.
//
// Only present when the graph was pooled from more than one export. Both hand
// their answer to the same answer panel a question uses (ask.showPeople), so
// a teammate's contacts or a target's people light up, list and step exactly
// like any other answer.

import { $, esc, fmt } from './dom.js';
import { parseTargets, matchTargets } from './targets.js';
import { parsePeople, matchPeople, looksLikePeople } from './peoplelist.js';
import { yearOf } from './routes.js';
import { prefs } from './store.js';

const TARGETS_KEY = 'nc.targets';
const PEOPLE_KEY = 'nc.peopleList';
const MODE_KEY = 'nc.listMode';

export function wireTeam({ D, people, ask, say }) {
  const team = D.team || [];
  if (team.length < 2) return null;

  const grp = $('teamGrp');
  grp.hidden = false;

  /* ---------- the team list ---------- */

  const counts = team.map((_, o) => people.filter(p => p.knownBy?.some(k => k.o === o)).length);
  const shared = people.filter(p => (p.knownBy?.length || 0) > 1);

  $('teamList').innerHTML = team.map((name, o) =>
    `<button type="button" class="team-row" data-o="${o}">` +
    `<span class="team-name">${esc(name)}</span><span class="team-n">${fmt(counts[o])}</span></button>`).join('');
  for (const b of $('teamList').querySelectorAll('.team-row')) {
    b.addEventListener('click', () => {
      const o = Number(b.dataset.o);
      const since = p => p.knownBy.find(k => k.o === o)?.t || 0;
      const mine = people.filter(p => p.knownBy?.some(k => k.o === o)).sort((a, b) => since(b) - since(a));
      ask.showPeople(mine, { title: `${team[o]}’s connections`, note: 'Most recent first.' });
    });
  }
  $('teamShared').textContent = `Known by 2+ · ${fmt(shared.length)}`;
  $('teamShared').addEventListener('click', () => {
    ask.showPeople(shared, {
      title: 'Known by more than one of the team',
      note: 'The warmest doors: several people can vouch, or compare notes first.'
    });
  });

  /* ---------- target accounts ---------- */

  const sheet = $('targets');
  const text = $('targetText');
  let rows = [];
  let peopleRows = [];

  // Two lists, one sheet: companies (target accounts) or people. Each keeps
  // its own text, so switching back and forth loses nothing.
  let mode = prefs.get(MODE_KEY) === 'people' ? 'people' : 'companies';
  const keyFor = m => (m === 'people' ? PEOPLE_KEY : TARGETS_KEY);
  const keep = v => prefs.set(keyFor(mode), v);
  const PLACEHOLDER = {
    companies: 'Airbus\nRyanair\nMicrosoft',
    people: 'https://www.linkedin.com/in/someone\nJane Doe, Airbus\nJohn Roe'
  };

  function setMode(m, { keepText = false } = {}) {
    if (!keepText && m !== mode) keep(text.value);
    mode = m;
    prefs.set(MODE_KEY, m);
    for (const b of $('listMode').querySelectorAll('[data-m]')) b.setAttribute('aria-pressed', String(b.dataset.m === m));
    for (const el of sheet.querySelectorAll('.ehelp[data-for]')) el.hidden = el.dataset.for !== m;
    text.placeholder = PLACEHOLDER[m];
    if (!keepText) text.value = prefs.get(keyFor(m)) || '';
    $('targetOut').hidden = true;
    count();
    // results already worked out for this list come back with it
    if (m === 'people' && peopleRows.length) renderPeople();
    if (m === 'companies' && rows.length) render();
  }
  for (const b of $('listMode').querySelectorAll('[data-m]')) b.addEventListener('click', () => setMode(b.dataset.m));

  const count = () => {
    const n = mode === 'people' ? parsePeople(text.value).length : parseTargets(text.value).length;
    const what = mode === 'people' ? (n === 1 ? 'person' : 'people') : (n === 1 ? 'company' : 'companies');
    $('targetCount').textContent = n ? `${fmt(n)} ${what}` : '';
  };
  text.addEventListener('input', () => {
    // a pasted list of people switches the sheet to People by itself
    if (mode === 'companies' && looksLikePeople(text.value)) setMode('people', { keepText: true });
    keep(text.value);
    count();
  });
  setMode(mode);

  function openSheet() {
    sheet.hidden = false;
    document.body.classList.add('sheet-up');
    if (mode === 'people' ? peopleRows.length : rows.length) return;
    if (text.value.trim()) run(); else text.focus();
  }
  function closeSheet() {
    sheet.hidden = true;
    document.body.classList.remove('sheet-up');
  }
  $('openTargets').addEventListener('click', openSheet);
  $('targetsClose').addEventListener('click', closeSheet);
  $('targetsScrim').addEventListener('click', closeSheet);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

  $('targetFileBtn').addEventListener('click', () => $('targetFile').click());
  $('targetFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const raw = await f.text();
    if (looksLikePeople(raw)) {
      setMode('people');
      text.value = raw.trim();
    } else {
      if (mode === 'people') setMode('companies');
      text.value = parseTargets(raw).join('\n');
    }
    keep(text.value);
    count();
    run();
  });

  $('targetRun').addEventListener('click', run);

  function run() {
    if (mode === 'people') { runPeople(); return; }
    const targets = parseTargets(text.value);
    if (!targets.length) { text.focus(); return; }
    // reachable first, then by how good the best route is, then by headcount
    rows = matchTargets(targets, people, team).sort((a, b) =>
      (b.best ? 1 : 0) - (a.best ? 1 : 0) ||
      (b.best?.route.score || 0) - (a.best?.route.score || 0) ||
      b.people.length - a.people.length);
    render();
  }

  function render() {
    const hit = rows.filter(r => r.people.length).length;
    $('targetOut').hidden = false;
    $('targetTable').classList.remove('tg-people');
    $('targetSummary').textContent = `${fmt(hit)} of ${fmt(rows.length)} reachable`;
    $('targetTable').innerHTML =
      `<div class="tg-row tg-head" role="row"><span>Company</span><span>People</span><span>Who can introduce</span><span>Best route</span></div>` +
      rows.map((r, i) => {
        const b = r.best;
        return `<button type="button" class="tg-row${r.people.length ? '' : ' tg-none'}" role="row" data-i="${i}"${r.people.length ? '' : ' disabled'}>` +
          `<span class="tg-co">${esc(r.name)}</span>` +
          `<span class="tg-n">${r.people.length ? fmt(r.people.length) : '—'}</span>` +
          `<span class="tg-via">${r.teammates.map(t => `${esc(t.owner)} ${fmt(t.n)}`).join(' · ') || '<span class="d-dim">no one yet</span>'}</span>` +
          `<span class="tg-best">${b
            ? `<span class="tg-person">${esc(b.person.name)}</span>` +
              `<span class="tg-role">${esc(b.person.role || '')}</span>` +
              `<span class="rt rt-${b.route.label}">${esc(b.route.owner)} · ${esc(yearOf(b.route.t))}</span>`
            : ''}</span>` +
        `</button>`;
      }).join('');
    for (const el of $('targetTable').querySelectorAll('.tg-row[data-i]')) {
      el.addEventListener('click', () => {
        const r = rows[Number(el.dataset.i)];
        closeSheet();
        ask.showPeople(r.people, {
          title: `${r.name} · ${fmt(r.people.length)} in the network`,
          note: r.best ? `Best route: ${r.best.route.owner} → ${r.best.person.name}` : ''
        });
      });
    }
  }

  /* ---------- a list of people ---------- */

  const STATUS = {
    link: 'In the network',
    'name+company': 'In the network',
    name: 'In the network (by name)',
    ambiguous: 'Several with this name',
    company: 'Not connected · colleagues are',
    none: 'Not in the network'
  };
  const found = r => r.person ? [r.person] : r.candidates.length ? r.candidates : r.via ? r.via.people : [];
  const routeTags = routes => routes.map(rt =>
    `<span class="rt rt-${rt.label}">${esc(rt.owner)} · ${esc(yearOf(rt.t))}</span>`).join(' ');

  function runPeople() {
    const list = parsePeople(text.value);
    if (!list.length) { text.focus(); return; }
    const order = { link: 0, 'name+company': 0, name: 1, ambiguous: 2, company: 3, none: 4 };
    peopleRows = matchPeople(list, people, team)
      .map((r, i) => ({ ...r, i }))
      .sort((a, b) => order[a.status] - order[b.status] || (b.routes[0]?.score || 0) - (a.routes[0]?.score || 0) || a.i - b.i);
    renderPeople();
  }

  function renderPeople() {
    const inNet = peopleRows.filter(r => r.person).length;
    const viaCo = peopleRows.filter(r => r.status === 'company').length;
    $('targetOut').hidden = false;
    $('targetTable').classList.add('tg-people');
    $('targetSummary').innerHTML =
      `${fmt(inNet)} of ${fmt(peopleRows.length)} in the network` +
      (viaCo ? ` · ${fmt(viaCo)} more reachable through colleagues` : '') +
      (inNet ? ` · <button type="button" class="linky" id="showFound">Show them in the constellation</button>` : '');
    $('targetTable').innerHTML =
      `<div class="tg-row tg-head" role="row"><span>Person</span><span>Match</span><span>Who knows them</span><span>In the network as</span></div>` +
      peopleRows.map((r, i) => {
        const any = found(r).length;
        let who = '', as = '';
        if (r.person) {
          who = routeTags(r.routes) || '<span class="d-dim">no one yet</span>';
          as = `<span class="tg-person">${esc(r.person.name)}</span><span class="tg-role">${esc([r.person.role, r.person.company].filter(Boolean).join(' · '))}</span>`;
        } else if (r.status === 'ambiguous') {
          who = `<span class="d-dim">${fmt(r.candidates.length)} people — add their company</span>`;
          as = r.candidates.slice(0, 3).map(p => `<span class="tg-role">${esc([p.company, p.role].filter(Boolean).join(' · ') || p.name)}</span>`).join('');
        } else if (r.via?.best) {
          const b = r.via.best;
          who = `<span class="rt rt-${b.route.label}">${esc(b.route.owner)} · ${esc(yearOf(b.route.t))}</span>`;
          as = `<span class="tg-person">via ${esc(b.person.name)}</span><span class="tg-role">${esc(b.person.role || '')} · ${fmt(r.via.people.length)} at ${esc(r.input.company)}</span>`;
        }
        return `<button type="button" class="tg-row${any ? '' : ' tg-none'}" role="row" data-i="${i}"${any ? '' : ' disabled'}>` +
          `<span class="tg-co">${esc(r.input.name || r.input.label)}${r.input.company ? `<span class="tg-role">${esc(r.input.company)}</span>` : ''}</span>` +
          `<span class="tg-n tg-status">${esc(STATUS[r.status])}</span>` +
          `<span class="tg-via">${who}</span>` +
          `<span class="tg-best">${as}</span>` +
        `</button>`;
      }).join('');
    for (const el of $('targetTable').querySelectorAll('.tg-row[data-i]')) {
      el.addEventListener('click', () => {
        const r = peopleRows[Number(el.dataset.i)];
        const list = found(r);
        closeSheet();
        ask.showPeople(list, {
          title: r.person ? r.person.name
            : r.status === 'ambiguous' ? `${r.input.name} · ${fmt(list.length)} with this name`
            : `${r.input.company} · ${fmt(list.length)} in the network`,
          note: r.person
            ? (r.routes.length ? 'Known by ' + r.routes.map(rt => `${rt.owner} (${yearOf(rt.t)})`).join(', ') : '')
            : r.via?.best ? `${r.input.name} is not connected. Best route in: ${r.via.best.route.owner} → ${r.via.best.person.name}` : ''
        });
      });
    }
    $('showFound')?.addEventListener('click', () => {
      const all = peopleRows.filter(r => r.person).map(r => r.person);
      closeSheet();
      ask.showPeople(all, { title: `Your list · ${fmt(all.length)} in the network`, note: 'Everyone on the list the team is connected to.' });
    });
  }

  // A plain CSV of the matrix, for pasting into the CRM or a sales meeting.
  $('targetCsv').addEventListener('click', () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let lines, file;
    if (mode === 'people') {
      file = 'people-lookup.csv';
      lines = [['Person', 'Company given', 'Match', 'In network as', 'Their role', 'Their company', 'Known by', 'Best route (not connected)'].map(q).join(',')];
      for (const r of peopleRows) {
        lines.push([
          r.input.name || r.input.label, r.input.company, STATUS[r.status],
          r.person?.name, r.person?.role, r.person?.company,
          r.routes.map(rt => `${rt.owner} (${yearOf(rt.t)})`).join('; '),
          r.via?.best ? `${r.via.best.route.owner} -> ${r.via.best.person.name} (${r.via.best.person.role || ''})` : ''
        ].map(q).join(','));
      }
    } else {
      file = 'target-accounts.csv';
      lines = [['Target', 'People in network', 'Who can introduce', 'Best contact', 'Their role', 'Via', 'Connected'].map(q).join(',')];
      for (const r of rows) {
        lines.push([
          r.name, r.people.length,
          r.teammates.map(t => `${t.owner} (${t.n})`).join('; '),
          r.best?.person.name, r.best?.person.role, r.best?.route.owner,
          r.best ? yearOf(r.best.route.t) : ''
        ].map(q).join(','));
      }
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: file });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say?.('Downloaded ' + file);
  });

  return { openSheet };
}
