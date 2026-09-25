// Pooling several teammates' exports: merge, who-knows-whom, employer tidying
// and route strength. All synthetic — no real person is named here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../src/csv.js';
import { deNote, buildGraph, leanPeople, hydratePeople } from '../src/build.js';
import { mergeExports, ownerFromFilename, TEAM_COLUMNS } from '../src/team.js';
import { companyKey, isNotAnEmployer, canonicalCompanies } from '../src/company.js';
import { routeScore, routeLabel, routesFor, reach, byTeammate } from '../src/routes.js';
import { matchTargets, parseTargets } from '../src/targets.js';

const HEAD = 'Notes:\n"a note"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n';
const csv = lines => parseCSV(deNote(HEAD + lines.join('\n')));

const A = csv([
  'Ada,Quill,https://www.linkedin.com/in/ada-quill,,Skyward Airways Ltd,Head of Fuel,03 Mar 2025',
  'Bo,Tern,https://www.linkedin.com/in/bo-tern,,Self-employed,Consultant,12 Jan 2014',
  'Cy,Wren,https://www.linkedin.com/in/cy-wren,,Skyward Airways,Sustainability Manager,01 Jun 2019'
]);
const B = csv([
  'Ada,Quill,https://uk.linkedin.com/in/Ada-Quill/,,Skyward Airways,VP Fuel & Sustainability,10 Feb 2026',
  'Di,Lark,https://www.linkedin.com/in/di-lark,,The Carbon Office GmbH,CEO,20 Aug 2024'
]);

test('owner names come from the file name', () => {
  assert.equal(ownerFromFilename('Connections_patrick.csv'), 'Patrick');
  assert.equal(ownerFromFilename('be9a4884-Connections_patrick.csv'), 'Patrick');
  assert.equal(ownerFromFilename('LinkedIn Connections - jane doe (2).csv'), 'Jane Doe');
  assert.equal(ownerFromFilename('Connections.csv'), '');
});

test('exports merge on the profile slug and remember who knows whom', () => {
  const m = mergeExports([{ owner: 'Alex', rows: A }, { owner: 'Sam', rows: B }]);
  assert.deepEqual(m.team, ['Alex', 'Sam']);
  assert.equal(m.stats.rowsIn, 5);
  assert.equal(m.stats.contacts, 4);
  assert.equal(m.stats.shared, 1);
  const ada = m.rows.findIndex(r => r.Name === 'Ada Quill');
  assert.deepEqual(m.knownBy[ada].map(k => k.o), [1, 0], 'most recent link first');
  assert.equal(m.rows[ada].Position, 'VP Fuel & Sustainability', 'fresher copy of the job wins');
});

test('the same owner twice is one teammate', () => {
  const m = mergeExports([{ owner: 'Alex', rows: A }, { owner: 'alex', rows: B }]);
  assert.deepEqual(m.team, ['Alex']);
  assert.ok(m.knownBy.every(k => k.length === 1));
});

test('employer names fold legal suffixes, and non-employers are dropped', () => {
  assert.equal(companyKey('Skyward Airways Ltd.'), companyKey('skyward airways'));
  assert.equal(companyKey('The Carbon Office GmbH'), 'carbon office');
  assert.equal(companyKey('Airbus S.A.S.'), 'airbus');
  assert.ok(isNotAnEmployer('Self-employed'));
  assert.ok(isNotAnEmployer('Stealth Startup'));
  assert.ok(!isNotAnEmployer('Skyward Airways'));
  const canon = canonicalCompanies(['Skyward Airways', 'Skyward Airways', 'Skyward Airways Ltd', 'Freelance']);
  assert.equal(canon('Skyward Airways Ltd'), 'Skyward Airways');
  assert.equal(canon('Freelance'), '');
});

test('a pooled graph carries the team and one hub per employer', () => {
  const m = mergeExports([{ owner: 'Alex', rows: A }, { owner: 'Sam', rows: B }]);
  const b = buildGraph(m.rows, { columns: TEAM_COLUMNS, knownBy: m.knownBy, team: m.team, tidyCompanies: true });
  assert.deepEqual(b.D.team, ['Alex', 'Sam']);
  assert.deepEqual(b.D.comps, ['Skyward Airways']);
  const bo = b.people.find(p => p.name === 'Bo Tern');
  assert.equal(bo.company, '');
  const ada = b.people.find(p => p.name === 'Ada Quill');
  assert.deepEqual(b.D.people[ada.i][7], [1, 0]);
  // and it survives the single-file bundle's lean round trip
  const back = hydratePeople(b.D, leanPeople(b.people));
  assert.deepEqual(back[ada.i].knownBy.map(k => k.o), [1, 0]);
  assert.ok(back[ada.i].knownBy[0].t > 0);
});

test('a single export builds exactly as before', () => {
  const plain = buildGraph(A);
  assert.equal(plain.D.team, undefined);
  assert.equal(plain.people[0].knownBy, undefined);
});

test('route strength fades with age and names itself', () => {
  const now = Date.UTC(2026, 8, 1);
  assert.equal(routeScore(Date.UTC(2025, 0, 1), now), 1);
  assert.ok(routeScore(Date.UTC(2013, 0, 1), now) < 0.3);
  assert.equal(routeLabel(routeScore(null, now)), 'fair');
  const p = { knownBy: [{ o: 0, t: Date.UTC(2013, 0, 1) }, { o: 1, t: Date.UTC(2025, 5, 1) }] };
  const r = routesFor(p, ['Alex', 'Sam'], now);
  assert.equal(r[0].owner, 'Sam');
  assert.equal(r[0].label, 'strong');
  assert.ok(reach(p, now) > 1, 'two teammates beat one');
  const t = byTeammate([p, { knownBy: [{ o: 0, t: Date.UTC(2025, 0, 1) }] }], ['Alex', 'Sam'], now);
  assert.deepEqual(t.map(x => [x.owner, x.n, x.strong]), [['Alex', 2, 1], ['Sam', 1, 1]]);
});

test('target accounts parse from a pasted list or a CSV column', () => {
  assert.deepEqual(parseTargets('Skyward Airways\n\n  Carbon Office \nSkyward Airways'), ['Skyward Airways', 'Carbon Office']);
  assert.deepEqual(parseTargets('Company Name,Domain\nSkyward Airways,sky.example\n"Carbon Office, The",co.example'),
    ['Skyward Airways', 'Carbon Office, The']);
});

test('targets match employers by whole words, subsidiaries included', () => {
  const now = Date.UTC(2026, 8, 1);
  const people = [
    { i: 0, name: 'A', company: 'Skyward Airways', seniority: 'Founder & C-suite', knownBy: [{ o: 0, t: Date.UTC(2025, 0, 1) }] },
    { i: 1, name: 'B', company: 'Skyward Airways Cargo', seniority: 'Unstated', knownBy: [{ o: 1, t: Date.UTC(2012, 0, 1) }] },
    { i: 2, name: 'C', company: 'Skywardly', seniority: 'Unstated', knownBy: [{ o: 1, t: null }] }
  ];
  const [sky, none] = matchTargets(['Skyward Airways Ltd', 'Nobody Inc'], people, ['Alex', 'Sam'], now);
  assert.deepEqual(sky.people.map(p => p.name), ['A', 'B']);
  assert.equal(sky.best.person.name, 'A');
  assert.equal(sky.best.route.owner, 'Alex');
  assert.deepEqual(sky.teammates.map(t => t.owner), ['Alex', 'Sam']);
  assert.equal(none.people.length, 0);
});
