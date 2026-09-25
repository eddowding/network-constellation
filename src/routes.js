// How good an introduction route is.
//
// A route is one teammate who is connected to one contact. LinkedIn tells us
// nothing about how well they know each other, so this leans on the only
// honest signals in the export: how long ago they connected (a 2013 accept is
// a weaker ask than a 2025 one), whether more than one teammate knows the
// same person, and the contact's seniority (senior people are the harder
// door and the one worth prioritising). All of it is shown, never hidden:
// the teammate knows better, and the label is a prompt to ask them.

import { SEN_ORDER } from './taxonomy.js';

const YEAR = 3.156e10;

/** 0..1 for one teammate -> contact link. Unknown date sits in the middle. */
export function routeScore(t, now = Date.now()) {
  if (!t) return 0.45;
  const years = Math.max(0, (now - t) / YEAR);
  // full marks inside two years, fading to a floor by about twelve
  return Math.max(0.15, Math.min(1, 1 - (years - 2) / 12));
}

export const routeLabel = s => s >= 0.75 ? 'strong' : s >= 0.45 ? 'fair' : 'weak';

/**
 * A contact's routes, best first: [{ o, owner, t, score, label }].
 * `person.knownBy` is [{ o, t }]; `team` names the owners.
 */
export function routesFor(person, team, now = Date.now()) {
  return (person.knownBy || [])
    .map(k => {
      const score = routeScore(k.t, now);
      return { o: k.o, owner: team[k.o] || `Teammate ${k.o + 1}`, t: k.t, score, label: routeLabel(score) };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * How reachable a contact is through the team as a whole: the best route,
 * nudged up for every extra teammate who also knows them. 0..~1.3
 */
export function reach(person, now = Date.now()) {
  const ks = person.knownBy || [];
  if (!ks.length) return 0;
  const best = Math.max(...ks.map(k => routeScore(k.t, now)));
  return best + 0.15 * (ks.length - 1);
}

/** Seniority as a 0..1 weight: C-suite 1, unstated 0.2. */
export function seniorityWeight(p) {
  const r = SEN_ORDER.indexOf(p.seniority);
  if (r < 0 || p.seniority === 'Unstated') return 0.2;
  return 1 - r / Math.max(1, SEN_ORDER.length - 1);
}

/** "2024" for a timestamp, "date unknown" without one. */
export const yearOf = t => t ? String(new Date(t).getUTCFullYear()) : 'date unknown';

/**
 * Tally a list of contacts by teammate: how many each can reach and how many
 * of those by a strong route. [{ o, owner, n, strong }] best-placed first.
 */
export function byTeammate(list, team, now = Date.now()) {
  const out = team.map((owner, o) => ({ o, owner, n: 0, strong: 0 }));
  for (const p of list) {
    for (const k of p.knownBy || []) {
      const row = out[k.o];
      if (!row) continue;
      row.n++;
      if (routeScore(k.t, now) >= 0.75) row.strong++;
    }
  }
  return out.filter(r => r.n).sort((a, b) => b.strong - a.strong || b.n - a.n);
}
