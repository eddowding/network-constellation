// Several people's exports, pooled into one network.
//
// Each teammate drops their own Connections.csv. The same contact often turns
// up in more than one, so rows are merged on the LinkedIn profile slug (or,
// without one, on name + employer) and every contact remembers WHO on the
// team knows them and since when. That "known by" list is the whole point of
// pooling: it turns "is there anyone at Airbus?" into "Patrick knows two
// people at Airbus, one since last year".
//
// Pure logic, no DOM: runs in Node for the tests and in the browser on a drop.

import { detectColumns, composeName, composeHeadline } from './build.js';

/** "Connections_patrick.csv" -> "Patrick". A bare "Connections.csv" -> "". */
export function ownerFromFilename(name) {
  const base = (name || '').replace(/\.[a-z0-9]+$/i, '')
    .replace(/^[a-f0-9]{6,}-/i, '')                   // upload prefixes like "be9a4884-"
    .replace(/connections?/ig, ' ')
    .replace(/linkedin/ig, ' ')
    .replace(/[_\-.()\d]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base.split(' ').filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

const profileKey = u =>
  (u || '').replace(/^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\//i, '')
    .replace(/[/?#].*$/, '').toLowerCase();

const parseWhen = v => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/** The columns every merged row carries, whatever its export called them. */
export const TEAM_COLUMNS = {
  name: 'Name', first: null, last: null,
  headline: 'Headline', position: 'Position', company: 'Company',
  url: 'URL', connectedOn: 'Connected On'
};

/**
 * [{ owner, rows, columns? }] -> { rows, knownBy, team, stats }
 *
 *   rows     one row per distinct contact, in TEAM_COLUMNS shape, ready for
 *            buildGraph(rows, { columns: TEAM_COLUMNS, knownBy })
 *   knownBy  aligned with rows: [{ o: teamIndex, t: connectedOn|null }]
 *   team     the owners' names, index = o
 *
 * When two exports disagree about a contact's job, the more recently
 * connected teammate's copy wins — the newer export is likelier to be current.
 * Two exports under the same owner name are one person's, not two.
 */
export function mergeExports(exports) {
  const team = [];
  const teamIx = new Map();
  const byKey = new Map();          // dedupe key -> merged record
  const order = [];
  let rowsIn = 0;

  for (const ex of exports) {
    const owner = (ex.owner || '').trim() || `Teammate ${team.length + 1}`;
    const ownerKey = owner.toLowerCase();
    if (!teamIx.has(ownerKey)) { teamIx.set(ownerKey, team.length); team.push(owner); }
    const o = teamIx.get(ownerKey);
    if (!ex.rows?.length) continue;
    const c = ex.columns || detectColumns(ex.rows[0]);

    for (const r of ex.rows) {
      const name = composeName(r, c).trim();
      if (!name) continue;
      rowsIn++;
      const url = c.url ? (r[c.url] || '').trim() : '';
      const company = c.company ? (r[c.company] || '').trim() : '';
      const t = c.connectedOn ? parseWhen(r[c.connectedOn]) : null;
      const key = profileKey(url) || `${name.toLowerCase()}|${company.toLowerCase()}`;
      const row = {
        Name: name,
        Headline: c.headline ? (r[c.headline] || '') : '',
        Position: c.position ? (r[c.position] || '') : '',
        Company: company,
        URL: url,
        'Connected On': c.connectedOn ? (r[c.connectedOn] || '') : ''
      };
      // with no headline column, compose one exactly as a single export would
      if (!row.Headline) row.Headline = composeHeadline(r, c);

      let m = byKey.get(key);
      if (!m) {
        m = { row, t, knownBy: [] };
        byKey.set(key, m);
        order.push(m);
      } else if ((t || 0) > (m.t || 0)) {
        // fresher copy of their job; keep any field the fresher one lacks
        for (const k of Object.keys(row)) if (!row[k] && m.row[k]) row[k] = m.row[k];
        m.row = row;
        m.t = t;
      }
      const had = m.knownBy.find(k => k.o === o);
      if (had) { if ((t || 0) > (had.t || 0)) had.t = t; }
      else m.knownBy.push({ o, t });
    }
  }

  for (const m of order) m.knownBy.sort((a, b) => (b.t || 0) - (a.t || 0));
  // Connected On on the merged row = the team's most recent link to them
  const rows = order.map(m => ({
    ...m.row,
    'Connected On': m.knownBy[0]?.t ? new Date(m.knownBy[0].t).toISOString().slice(0, 10) : m.row['Connected On']
  }));

  const perOwner = team.map((_, o) => order.filter(m => m.knownBy.some(k => k.o === o)).length);
  const shared = order.filter(m => m.knownBy.length > 1).length;
  return {
    rows,
    knownBy: order.map(m => m.knownBy),
    team,
    stats: { rowsIn, contacts: order.length, shared, perOwner }
  };
}
