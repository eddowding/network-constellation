// Control panel, tooltip and status line. Everything here talks to the world
// object returned by createConstellation and knows nothing about three.js.

import { fmt, esc, $, sceneRight } from './dom.js';
import { knownByText } from './routes.js';

export function wireUI(world, D, hit, people = null) {
  /* ---- tooltip ---- */
  const tip = $('tip');
  const scene = $('scene');

  world.graph.onNodeHover(n => {
    scene.style.cursor = n && n.t === 'p' && n.slug ? 'pointer' : 'default';
    if (!n) { tip.classList.remove('on'); return; }
    tip.innerHTML = tipHtml(n, D, people && n.t === 'p' ? people[n.id - world.PPL0] : null);
    tip.classList.add('on');
  });

  document.addEventListener('mousemove', e => {
    if (!tip.classList.contains('on')) return;
    let x = e.clientX + 16, y = e.clientY + 16;
    if (x + tip.offsetWidth > sceneRight() - 8) x = e.clientX - tip.offsetWidth - 16;
    if (y + tip.offsetHeight > innerHeight - 8) y = e.clientY - tip.offsetHeight - 16;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });

  // Whoever wants to know when a person or employer is clicked or landed on.
  // The detail panel registers here.
  const hooks = { node: null, landed: null };

  world.graph.onNodeClick(n => {
    if ((n.t === 'p' || n.t === 'comp') && hooks.node) {
      if (n.t === 'p') world.flyTo(n, 90);
      hooks.node(n);
      return;
    }
    if (n.t === 'dom') {
      const next = world.state.isolate === n.di ? -1 : n.di;
      $('domSel').value = String(next);
      world.setIsolate(next);
      markLegend(next);
      return;
    }
    world.flyTo(n, n.t === 'comp' ? 130 : 90);
  });

  /* ---- density ---- */
  const segButtons = [...document.querySelectorAll('#densitySeg button')];
  segButtons.forEach(b => b.addEventListener('click', () => {
    segButtons.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
    world.setDensity(b.dataset.d);
    say('Settling…');
  }));

  /* ---- colour by ---- */
  const colorButtons = [...document.querySelectorAll('#colorSeg button')];
  colorButtons.forEach(b => b.addEventListener('click', () => {
    colorButtons.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
    world.setColorBy(b.dataset.c);
    drawLegend(b.dataset.c);
  }));

  /* ---- isolate ---- */
  const sel = $('domSel');
  D.doms.forEach((name, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${name}  (${fmt(D.domCounts[i])})`;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    const di = parseInt(sel.value, 10);
    world.setIsolate(di);
    markLegend(di);
  });

  /* ---- employer links ---- */
  $('compToggle').addEventListener('change', e => {
    world.setShowComp(e.target.checked);
    say('Settling…');
  });

  /* ---- search ----
     A hit is one dot in ten thousand, so finding it has to announce itself:
     the node burns hot, its two spokes light up, and the marker overlay locks
     on. Enter steps through the rest of the matches. */
  const search = $('search');
  let timer = null;
  let matches = [];
  let at = 0;

  /**
   * Fly to a person and lock the marker on them. The name search and the Ask
   * panel both come through here — one camera path, one marker, one status
   * line, so the two features can never drift apart.
   */
  /** Put every person back in the scene, and keep the density control honest. */
  function showEveryone() {
    if (world.state.density === 'all') return false;
    segButtons.forEach(o => o.setAttribute('aria-pressed', String(o.dataset.d === 'all')));
    world.setDensity('all');
    return true;
  }

  function land(n, ctx) {
    const index = ctx?.index ?? at;
    const total = ctx?.total ?? matches.length;
    world.setHit(n);
    if (!world.isVisible(n)) {
      // the person is filtered out of the scene — put them back before flying
      showEveryone();
      setTimeout(() => { if (world.hit === n) { world.swoopTo(n); hit.show(n); } }, 420);
    } else {
      world.swoopTo(n);
      hit.show(n);
    }
    say(n.name + (total > 1
      ? `  ·  ${index + 1} of ${total}, Enter for next`
      : '  ·  found'));
    // ctx.auto marks a landing nobody chose — a question's first result, a
    // keystroke in the name search. Those keep the marker but do not open the
    // side panel; an explicit click does.
    hooks.landed?.(n, ctx);
  }

  // the name search's own matches, so clearing it does not wipe a question's
  let ownHits = null;

  function clearHit() {
    matches = [];
    at = 0;
    if (ownHits && world.hits === ownHits) world.setHits(null);
    ownHits = null;
    list.hidden = true;
    list.innerHTML = '';
    world.setHit(null);
    hit.clear();
  }

  // Several matches: everyone else leaves the scene, the camera takes in all
  // of them, and a list under the box says who they are. One match (a full
  // name, a profile link) flies straight to that person.
  const list = document.createElement('div');
  list.className = 'find-list';
  list.hidden = true;
  search.insertAdjacentElement('afterend', list);
  const LIST_MAX = 60;

  function showList(q) {
    const shown = matches.slice(0, LIST_MAX);
    list.innerHTML =
      shown.map((n, i) => {
        const company = n.ci >= 0 ? D.comps[n.ci] : (n.freeComp || '');
        const known = D.team?.length && n.kb?.length ? 'via ' + n.kb.map(o => D.team[o]).join(', ') : '';
        const sub = [n.role, company].filter(Boolean).join(' · ');
        return `<button type="button" class="find-row" data-i="${i}">` +
          `<span class="fr-name">${esc(n.name)}</span>` +
          (sub ? `<span class="fr-sub">${esc(sub)}</span>` : '') +
          (known ? `<span class="fr-via">${esc(known)}</span>` : '') +
          `</button>`;
      }).join('') +
      (matches.length > LIST_MAX ? `<span class="fr-more">and ${fmt(matches.length - LIST_MAX)} more — type more of the name</span>` : '');
    list.hidden = false;
  }

  list.addEventListener('click', e => {
    const b = e.target.closest('.find-row');
    if (!b) return;
    at = Number(b.dataset.i);
    markRow();
    land(matches[at], { index: at, total: matches.length });
  });
  const markRow = () => {
    for (const b of list.querySelectorAll('.find-row')) b.classList.toggle('on', Number(b.dataset.i) === at);
    list.querySelector('.find-row.on')?.scrollIntoView({ block: 'nearest' });
  };

  search.addEventListener('input', () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (q.length < 2) { clearHit(); return; }
    timer = setTimeout(() => {
      matches = world.findPeople(q).filter(n => n.x !== undefined);
      at = -1;
      if (!matches.length) { clearHit(); say('No one here matches "' + q + '"'); return; }
      // everyone else leaves the scene while the search is up
      ownHits = new Set(matches);
      const label = /linkedin\.com\/in\//i.test(q) ? 'Profile link' : `“${q}”`;
      world.setHits(ownHits, label);
      if (matches.length === 1) {
        list.hidden = true;
        at = 0;
        land(matches[0], { auto: true });
        return;
      }
      world.setHit(null);
      hit.clear();
      showEveryone();
      world.frameNodes(matches);
      showList(q);
      say(`${fmt(matches.length)} match “${q}”  ·  Enter steps through them`);
    }, 240);
  });

  search.addEventListener('keydown', e => {
    if (e.key === 'Enter' && matches.length > 1) {
      e.preventDefault();
      at = at < 0 ? 0 : (at + (e.shiftKey ? matches.length - 1 : 1)) % matches.length;
      markRow();
      land(matches[at], { auto: true, index: at, total: matches.length });
    }
    if (e.key === 'Escape') { search.value = ''; clearHit(); search.blur(); }
  });

  addEventListener('keydown', e => {
    if (e.key === 'Escape' && world.hit) { search.value = ''; clearHit(); }
  });

  /* ---- legend ---- */
  const legend = $('legend');

  function drawLegend(mode) {
    $('legendLab').textContent = mode === 'seniority' ? 'Seniority' : 'Domains';
    legend.innerHTML = '';

    if (mode === 'seniority') {
      D.sen.forEach((name, i) => {
        legend.insertAdjacentHTML('beforeend', row(world.senColor[i], name, D.senCounts[i]));
      });
      legend.insertAdjacentHTML('beforeend',
        row(world.PALETTE.compHub, 'Employer hub', D.comps.length));
      return;
    }

    // domains, largest first, each a button that isolates it
    D.doms.forEach((name, i) => {
      legend.insertAdjacentHTML('beforeend',
        row(world.domColor[i], name, D.domCounts[i], i));
    });
    legend.insertAdjacentHTML('beforeend',
      row(world.PALETTE.compHub, 'Employer hub', D.comps.length));

    legend.querySelectorAll('[data-di]').forEach(el => {
      el.addEventListener('click', () => {
        const di = parseInt(el.dataset.di, 10);
        const next = world.state.isolate === di ? -1 : di;
        sel.value = String(next);
        world.setIsolate(next);
        markLegend(next);
      });
    });
    markLegend(world.state.isolate);
  }

  function markLegend(di) {
    legend.querySelectorAll('[data-di]').forEach(el => {
      el.classList.toggle('sel', parseInt(el.dataset.di, 10) === di);
    });
  }

  drawLegend('domain');

  /* ---- stats + status ---- */
  world.onStats(s => {
    $('nNodes').textContent = fmt(s.nodes);
    $('nLinks').textContent = fmt(s.links);
    $('nPeople').textContent = fmt(s.people);
    $('nDom').textContent = fmt(D.doms.length);
    $('nComp').textContent = fmt(s.comps);
  });
  // a settle message must not stomp on 'found X' while a hit is on screen
  world.onSettle(n => { if (!world.hit && !world.hits) say('Settled · ' + fmt(n) + ' nodes'); });

  addEventListener('resize', () => world.graph.width(innerWidth).height(innerHeight));

  /* ---- the "i" behind which the edges caveat lives ---- */
  const noteBtn = $('noteBtn');
  const note = $('note');
  if (noteBtn && note) {
    const setNote = open => { note.hidden = !open; noteBtn.setAttribute('aria-expanded', String(open)); };
    noteBtn.addEventListener('click', e => { e.stopPropagation(); setNote(note.hidden); });
    document.addEventListener('click', e => { if (!note.hidden && !e.target.closest('#noteWrap')) setNote(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && !note.hidden) setNote(false); });
  }

  return { say, land, clearHit, showEveryone, setHooks: h => Object.assign(hooks, h) };
}

function row(color, label, count, di) {
  const tag = di == null ? 'div' : 'button';
  const attr = di == null ? '' : ` type="button" data-di="${di}" title="Isolate ${esc(label)}"`;
  return `<${tag} class="lgi"${attr}><span class="dot" style="background:${color}"></span>` +
    `<span class="lgi-label">${esc(label)}</span><span class="lgn">${fmt(count)}</span></${tag}>`;
}

function tipHtml(n, D, person = null) {
  if (n.t === 'root') {
    return '<span class="tn">' + esc(n.name) + '</span>' +
      '<span class="tr">The centre. Everyone else here is one of your connections</span>';
  }
  if (n.t === 'dom') {
    return `<span class="tn">${esc(n.name)}</span>` +
      `<span class="tr">${fmt(n.count)} people</span><span class="tm">Domain</span>`;
  }
  if (n.t === 'comp') {
    return `<span class="tn">${esc(n.name)}</span>` +
      `<span class="tr">${fmt(n.count)} people name it</span><span class="tm">Employer</span>`;
  }
  const company = n.ci >= 0 ? D.comps[n.ci] : (n.freeComp || '');
  return `<span class="tn">${esc(n.name)}</span>` +
    (n.role ? `<span class="tr">${esc(n.role)}</span>` : '') +
    (company ? `<span class="tr">${esc(company)}</span>` : '') +
    `<span class="tm">${esc(D.sen[n.si])} · ${esc(D.doms[n.di])}</span>` +
    (knownByText(n, D, person) ? `<span class="tk">${esc(knownByText(n, D, person))}</span>` : '');
}

let statusTimer = null;
/** One line at the bottom of the scene. `hold` is for messages that need reading, not glancing. */
function say(text, hold = 2600) {
  const el = $('status');
  el.textContent = text;
  el.classList.remove('gone');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.classList.add('gone'), hold);
}
