#!/usr/bin/env node
// data/*.csv (one LinkedIn export per teammate)  ->  data/network.db
//
//   node scripts/build-db.mjs [dir] [out.db]
//
// The same merge and classification the browser runs (src/team.js,
// src/build.js), written to SQLite so the pooled network can be queried
// outside the app. The schema is plain SQL with no SQLite-only types, so it
// moves to a hosted Postgres (or libSQL) unchanged when the team shares it.
//
// Owners come from file names, as in the app: Connections_Patrick_Smith.csv
// is "Patrick Smith". data/ is gitignored, so the database never ships.

import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseCSV, decodeCsv } from '../src/csv.js';
import { deNote, buildGraph, detectColumns } from '../src/build.js';
import { mergeExports, ownerFromFilename, TEAM_COLUMNS } from '../src/team.js';

const DIR = process.argv[2] || 'data';
const OUT = process.argv[3] || join(DIR, 'network.db');

const files = existsSync(DIR) ? readdirSync(DIR).filter(n => /\.csv$/i.test(n)).sort() : [];
if (!files.length) {
  console.error(`No exports in ${DIR}/. Put each teammate's Connections.csv there, named Connections_<Name>.csv.`);
  process.exit(1);
}

const slugKey = u =>
  (u || '').replace(/^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\//i, '')
    .replace(/[/?#].*$/, '').toLowerCase();

const exports = [];
const emails = new Map();   // slug -> email; exports rarely carry one, keep any found
for (const name of files) {
  const decoded = decodeCsv(readFileSync(join(DIR, name)));
  if (decoded.kind) { console.warn(`Skipping ${name}: not a CSV (${decoded.kind}).`); continue; }
  const rows = parseCSV(deNote(decoded.text));
  if (!rows.length) { console.warn(`Skipping ${name}: no rows.`); continue; }
  const columns = detectColumns(rows[0]);
  const emailCol = Object.keys(rows[0]).find(h => /e-?mail/i.test(h));
  if (emailCol && columns.url) {
    for (const r of rows) if (r[emailCol]) emails.set(slugKey(r[columns.url]), r[emailCol].trim());
  }
  exports.push({ owner: ownerFromFilename(name), file: basename(name), rows, columns });
}

const merged = mergeExports(exports);
const built = buildGraph(merged.rows, {
  columns: TEAM_COLUMNS, knownBy: merged.knownBy, team: merged.team, tidyCompanies: true
});

if (existsSync(OUT)) rmSync(OUT);
const db = new DatabaseSync(OUT);
db.exec(`
  CREATE TABLE teammates (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    source_file TEXT
  );
  CREATE TABLE contacts (
    id            INTEGER PRIMARY KEY,
    linkedin_slug TEXT UNIQUE,
    linkedin_url  TEXT,
    name          TEXT NOT NULL,
    position      TEXT,
    company       TEXT,            -- tidied: legal suffixes folded, "Self-employed" etc. dropped
    company_raw   TEXT,            -- as the export had it
    domain        TEXT,            -- what they do, from the classifier
    seniority     TEXT,
    email         TEXT
  );
  CREATE TABLE connections (
    teammate_id  INTEGER NOT NULL REFERENCES teammates(id),
    contact_id   INTEGER NOT NULL REFERENCES contacts(id),
    connected_on DATE,
    PRIMARY KEY (teammate_id, contact_id)
  );
  CREATE INDEX contacts_company ON contacts(company);
  CREATE INDEX connections_contact ON connections(contact_id);

  -- One row per (contact, teammate who can introduce them).
  CREATE VIEW routes AS
    SELECT c.id AS contact_id, c.name, c.position, c.company, c.domain, c.seniority,
           c.linkedin_url, t.name AS known_by, k.connected_on
    FROM connections k
    JOIN contacts c ON c.id = k.contact_id
    JOIN teammates t ON t.id = k.teammate_id;

  -- Per company: how many people the team knows there, and through whom.
  CREATE VIEW company_reach AS
    SELECT c.company, COUNT(DISTINCT c.id) AS people,
           GROUP_CONCAT(DISTINCT t.name) AS known_by
    FROM contacts c
    JOIN connections k ON k.contact_id = c.id
    JOIN teammates t ON t.id = k.teammate_id
    WHERE c.company IS NOT NULL AND c.company <> ''
    GROUP BY c.company;
`);

const iso = t => (t ? new Date(t).toISOString().slice(0, 10) : null);
db.exec('BEGIN');
const addT = db.prepare('INSERT INTO teammates (id, name, source_file) VALUES (?, ?, ?)');
merged.team.forEach((name, o) => {
  const src = exports.filter(e => e.owner.trim().toLowerCase() === name.toLowerCase()).map(e => e.file).join(', ');
  addT.run(o + 1, name, src);
});

const addC = db.prepare(`INSERT INTO contacts
  (id, linkedin_slug, linkedin_url, name, position, company, company_raw, domain, seniority, email)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const addK = db.prepare('INSERT INTO connections (teammate_id, contact_id, connected_on) VALUES (?, ?, ?)');
const seenSlug = new Set();
for (const p of built.people) {
  const row = merged.rows[p.row];
  let slug = slugKey(row.URL) || null;
  if (slug && seenSlug.has(slug)) slug = null;     // merge already keyed on it; belt and braces
  if (slug) seenSlug.add(slug);
  const id = p.i + 1;
  addC.run(id, slug, row.URL || null, p.name, row.Position || p.role || null,
    p.company || null, row.Company || null, p.domain || null, p.seniority || null,
    (slug && emails.get(slug)) || null);
  for (const k of p.knownBy || []) addK.run(k.o + 1, id, iso(k.t));
}
db.exec('COMMIT');

const n = sql => db.prepare(sql).get().n;
console.log(`${OUT}
  teammates    ${merged.team.map((t, i) => `${t} (${merged.stats.perOwner[i]})`).join(', ')}
  contacts     ${n('SELECT COUNT(*) n FROM contacts')}
  connections  ${n('SELECT COUNT(*) n FROM connections')}
  shared       ${n('SELECT COUNT(*) n FROM (SELECT contact_id FROM connections GROUP BY contact_id HAVING COUNT(*) > 1)')} known by 2+
  with email   ${n('SELECT COUNT(*) n FROM contacts WHERE email IS NOT NULL')}`);
db.close();
