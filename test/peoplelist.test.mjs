import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePeople, matchPeople, nameKey, looksLikePeople, slugKey } from '../src/peoplelist.js';

const team = ['Ed', 'Patrick'];
const people = [
  { name: 'Ada Lovelace', slug: 'ada-lovelace-1', company: 'Analytical Engines', role: 'CTO', seniority: 'C-suite & Founders', knownBy: [{ o: 0, t: Date.UTC(2024, 0, 1) }] },
  { name: 'John Smith', slug: 'jsmith', company: 'Airbus', role: 'Engineer', knownBy: [{ o: 1, t: Date.UTC(2025, 0, 1) }] },
  { name: 'John Smith', slug: 'jsmith2', company: 'Boeing', role: 'Pilot', knownBy: [{ o: 0, t: null }] },
  { name: 'José Núñez', slug: '', company: 'Iberia', role: 'Head of Fuel', knownBy: [{ o: 1, t: Date.UTC(2023, 0, 1) }] }
];

test('names fold accents, titles and asides', () => {
  assert.equal(nameKey('Dr. José  Núñez (PhD)'), 'jose nunez');
  assert.equal(nameKey('Ada Lovelace, MBA'), 'ada lovelace');
  assert.equal(slugKey('https://www.linkedin.com/in/Ada-Lovelace-1/'), 'ada-lovelace-1');
});

test('lines: links, name + company, bare names; repeats dropped', () => {
  const l = parsePeople('https://linkedin.com/in/jsmith\nJohn Smith, Boeing\nJose Nunez\nJohn Smith at Boeing\nGrace Hopper - US Navy');
  assert.deepEqual(l.map(p => [p.slug, p.name, p.company]), [
    ['jsmith', '', ''], ['', 'John Smith', 'Boeing'], ['', 'Jose Nunez', ''], ['', 'Grace Hopper', 'US Navy']
  ]);
});

test('a CSV is read by its headers', () => {
  const l = parsePeople('First Name,Last Name,Company\nAda,Lovelace,Analytical Engines\n');
  assert.deepEqual(l[0], { label: 'Ada Lovelace', name: 'Ada Lovelace', company: 'Analytical Engines', slug: '' });
  assert.ok(looksLikePeople('First Name,Last Name,Company\nAda,Lovelace,X'));
  assert.ok(!looksLikePeople('Airbus\nBoeing'));
});

test('matching: link, then name + company, then a unique name', () => {
  const r = matchPeople(parsePeople(
    'https://linkedin.com/in/jsmith\nJohn Smith, Boeing\nJohn Smith\nJose Nunez\nNobody Here, Airbus\nNobody Else'), people, team);
  assert.deepEqual(r.map(x => x.status), ['link', 'name+company', 'ambiguous', 'name', 'company', 'none']);
  assert.equal(r[0].person.company, 'Airbus');
  assert.equal(r[1].person.role, 'Pilot');
  assert.equal(r[2].candidates.length, 2);
  assert.equal(r[3].routes[0].owner, 'Patrick');
  assert.equal(r[4].via.best.person.name, 'John Smith', 'not in the network, but the team knows someone at Airbus');
});
