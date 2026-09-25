// Target accounts against the pooled network.
//
// Paste a list of companies (or drop a CRM export with a company column) and
// get back, for each: who in the network works there, which teammates can
// reach them, and the single best route in. Matching is on the folded
// employer key by whole words, so a target of "Airbus" finds "Airbus
// Helicopters" and "Airbus S.A.S." but not "Airbusy Ltd".

import { parseCSV } from './csv.js';
import { companyKey } from './company.js';
import { routesFor, byTeammate, seniorityWeight } from './routes.js';

const COMPANY_HEADERS = /^(company|company name|account|account name|organisation|organization|name|target)$/i;

/**
 * Text -> distinct target names. One per line, or a CSV whose company column
 * is found by its header. Blank lines and repeats (by key) are dropped.
 */
export function parseTargets(text) {
  const t = (text || '').replace(/^﻿/, '').trim();
  if (!t) return [];
  const first = t.split(/\r?\n/)[0];
  let names;
  if (first.includes(',') && first.split(',').some(h => COMPANY_HEADERS.test(h.trim().replace(/"/g, '')))) {
    const rows = parseCSV(t);
    const col = Object.keys(rows[0] || {}).find(h => COMPANY_HEADERS.test(h.trim()));
    names = rows.map(r => r[col] || '');
  } else {
    names = t.split(/\r?\n/);
  }
  const seen = new Set();
  const out = [];
  for (const n of names.map(x => x.trim()).filter(Boolean)) {
    const k = companyKey(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * For each target: { name, people, teammates, best } where
 *   people     contacts at it, best-reachable first
 *   teammates  byTeammate() over those people
 *   best       { person, route } — the strongest route to the most senior
 *              reachable person, or null
 */
export function matchTargets(targets, people, team, now = Date.now()) {
  // Index people by folded employer once; each target then scans keys, not people.
  const byKey = new Map();
  for (const p of people) {
    const k = companyKey(p.company);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  const keys = [...byKey.keys()];

  return targets.map(name => {
    const k = companyKey(name);
    const re = k ? new RegExp(`(^|\\s)${escapeRe(k)}(\\s|$)`) : null;
    const hits = re ? keys.filter(x => re.test(x)).flatMap(x => byKey.get(x)) : [];
    const scored = hits.map(p => {
      const routes = routesFor(p, team, now);
      const route = routes[0] || null;
      // a good route to a senior person is the one to ask for first
      const value = (route ? route.score : 0) * 0.6 + seniorityWeight(p) * 0.4;
      return { p, route, value };
    }).sort((a, b) => b.value - a.value);
    const top = scored.find(s => s.route);
    return {
      name,
      people: scored.map(s => s.p),
      teammates: byTeammate(hits, team, now),
      best: top ? { person: top.p, route: top.route } : null
    };
  });
}
