// The team panel and the target-accounts sheet.
//
// Only present when the graph was pooled from more than one export. Both hand
// their answer to the same answer panel a question uses (ask.showPeople), so
// a teammate's contacts or a target's people light up, list and step exactly
// like any other answer.

import { $, esc, fmt } from './dom.js';
import { parseTargets, matchTargets } from './targets.js';
import { yearOf } from './routes.js';
import { prefs } from './store.js';

const TARGETS_KEY = 'nc.targets';

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

  const keep = v => prefs.set(TARGETS_KEY, v);
  text.value = prefs.get(TARGETS_KEY) || '';

  const count = () => {
    const n = parseTargets(text.value).length;
    $('targetCount').textContent = n ? `${fmt(n)} ${n === 1 ? 'company' : 'companies'}` : '';
  };
  text.addEventListener('input', () => { keep(text.value); count(); });
  count();

  function openSheet() {
    sheet.hidden = false;
    document.body.classList.add('sheet-up');
    if (rows.length) return;
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
    const names = parseTargets(await f.text());
    text.value = names.join('\n');
    keep(text.value);
    count();
    run();
  });

  $('targetRun').addEventListener('click', run);

  function run() {
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

  // A plain CSV of the matrix, for pasting into the CRM or a sales meeting.
  $('targetCsv').addEventListener('click', () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Target', 'People in network', 'Who can introduce', 'Best contact', 'Their role', 'Via', 'Connected'].map(q).join(',')];
    for (const r of rows) {
      lines.push([
        r.name, r.people.length,
        r.teammates.map(t => `${t.owner} (${t.n})`).join('; '),
        r.best?.person.name, r.best?.person.role, r.best?.route.owner,
        r.best ? yearOf(r.best.route.t) : ''
      ].map(q).join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'target-accounts.csv' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say?.('Downloaded target-accounts.csv');
  });

  return { openSheet };
}
