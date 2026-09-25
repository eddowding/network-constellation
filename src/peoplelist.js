// A list of people against the pooled network.
//
// Paste names or LinkedIn profile links (or drop a CSV from an event, a CRM,
// an investor list) and get back, for each: are they in the network, who on
// the team knows them, and — when they are not, but their company is known —
// the best route in through someone else who works there.
//
// Matching, strongest first: the profile link; then the name together with
// the company; then the name alone when only one person has it.

import { parseCSV } from './csv.js';
import { companyKey } from './company.js';
import { routesFor } from './routes.js';
import { matchTargets } from './targets.js';

const NAME_H = /^(name|full name|contact|contact name|person)$/i;
const FIRST_H = /^(first name|firstname|first|given name)$/i;
const LAST_H = /^(last name|lastname|last|surname|family name)$/i;
const URL_H = /^(url|linkedin|linkedin url|profile|profile url|linkedin profile)$/i;
const COMPANY_H = /^(company|company name|organisation|organization|employer|account|account name)$/i;
const LINK = /linkedin\.com\/in\/([^/?#\s,"]+)/i;

/** A profile link or bare slug -> the lowercased slug LinkedIn keys on. */
export function slugKey(u) {
  const m = (u || '').match(LINK);
  let s = m ? m[1] : '';
  try { s = decodeURIComponent(s); } catch { /* keep it */ }
  return s.toLowerCase();
}

/** "Dr. José  O'Neil (PhD)" -> "jose oneil": accents, titles and asides folded away. */
export function nameKey(n) {
  return (n || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,.*$/, '')                                  // "Smith, MBA" style suffixes
    .replace(/\b(dr|mr|mrs|ms|prof|sir|dame)\.?\s+/g, ' ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does this text look like a list of people rather than companies? */
export function looksLikePeople(text) {
  const t = (text || '').trim();
  if (!t) return false;
  if (LINK.test(t)) return true;
  const first = t.split(/\r?\n/)[0];
  if (first.includes(',')) {
    const hs = first.split(',').map(h => h.trim().replace(/"/g, ''));
    if (hs.some(h => FIRST_H.test(h) || URL_H.test(h)) || (hs.some(h => NAME_H.test(h)) && hs.some(h => COMPANY_H.test(h)))) return true;
  }
  return false;
}

/**
 * Text -> [{ label, name, company, slug }]. A CSV is read by its headers;
 * otherwise one per line: a profile link, "Name, Company", "Name - Company",
 * "Name at Company", or just a name.
 */
export function parsePeople(text) {
  const t = (text || '').replace(/^﻿/, '').trim();
  if (!t) return [];
  const first = t.split(/\r?\n/)[0];
  const hs = first.includes(',') ? first.split(',').map(h => h.trim().replace(/"/g, '')) : [];
  const isCsv = hs.some(h => NAME_H.test(h) || FIRST_H.test(h) || URL_H.test(h));

  let out;
  if (isCsv) {
    const rows = parseCSV(t);
    const keys = Object.keys(rows[0] || {});
    const col = re => keys.find(h => re.test(h.trim()));
    const cName = col(NAME_H), cFirst = col(FIRST_H), cLast = col(LAST_H), cUrl = col(URL_H), cCo = col(COMPANY_H);
    out = rows.map(r => {
      const name = (cName ? r[cName] : [r[cFirst], r[cLast]].filter(Boolean).join(' ')) || '';
      const company = (cCo && r[cCo]) || '';
      const slug = cUrl ? slugKey(r[cUrl]) : '';
      return { label: name || r[cUrl] || '', name: name.trim(), company: company.trim(), slug };
    });
  } else {
    out = t.split(/\r?\n/).map(line => {
      const l = line.trim();
      if (!l) return null;
      const slug = slugKey(l);
      if (slug) return { label: l, name: '', company: '', slug };
      const m = l.match(/^(.+?)\s*(?:,|\t|\s[-–—|]\s|\sat\s|\s@\s)\s*(.+)$/i);
      return m
        ? { label: l, name: m[1].trim(), company: m[2].trim(), slug: '' }
        : { label: l, name: l, company: '', slug: '' };
    }).filter(Boolean);
  }
  const seen = new Set();
  return out.filter(p => {
    if (!p.name && !p.slug) return false;
    const k = p.slug || nameKey(p.name) + '|' + companyKey(p.company);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const sameCompany = (a, b) => {
  const x = companyKey(a), y = companyKey(b);
  if (!x || !y) return false;
  return x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
};

/**
 * For each listed person: { input, status, person, candidates, routes, via }
 *   status      'link' | 'name+company' | 'name' | 'ambiguous' | 'company' | 'none'
 *   person      the matched contact, if one
 *   candidates  every contact with that name, when it is ambiguous
 *   routes      routesFor(person)
 *   via         when they are not in the network but their company is:
 *               matchTargets' row for it (people there, best route)
 */
export function matchPeople(list, people, team, now = Date.now()) {
  const bySlug = new Map();
  const byName = new Map();
  for (const p of people) {
    const s = (p.slug || '').toLowerCase();
    if (s) bySlug.set(s, p);
    const k = nameKey(p.name);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }

  return list.map(input => {
    const done = (status, person = null, candidates = []) => ({
      input, status, person, candidates,
      routes: person ? routesFor(person, team, now) : [],
      via: null
    });

    if (input.slug && bySlug.has(input.slug)) return done('link', bySlug.get(input.slug));

    const same = input.name ? (byName.get(nameKey(input.name)) || []) : [];
    if (same.length) {
      if (input.company) {
        const at = same.filter(p => sameCompany(p.company, input.company));
        if (at.length === 1) return done('name+company', at[0]);
      }
      if (same.length === 1) return done('name', same[0]);
      return done('ambiguous', null, same);
    }

    const miss = done('none');
    if (input.company) {
      const [row] = matchTargets([input.company], people, team, now);
      if (row.people.length) { miss.status = 'company'; miss.via = row; }
    }
    return miss;
  });
}
