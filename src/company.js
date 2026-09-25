// Employer names, made comparable.
//
// One export says "Airbus", another "Airbus SE", a third "AIRBUS S.A.S.". For a
// team pooling several exports that split is the difference between "three
// people at Airbus" and three strangers at three companies. So names are keyed
// by a folded form — case, punctuation and legal suffixes removed — and each
// key is shown under whichever spelling most people used.
//
// This is deliberately not a brand list (see CLAUDE.md): nothing here knows
// what any company is. It only knows what a legal suffix looks like, and which
// "employers" are not employers at all.

/** Legal-form and filler tails. Stripped repeatedly from the end only. */
const SUFFIX = /\s+(ltd|limited|llc|llp|lp|inc|incorporated|corp|corporation|co|company|plc|gmbh|ag|sa|sas|sarl|srl|spa|bv|nv|ab|as|asa|oy|oyj|aps|pty|pte|kk|sl|se|group|holdings?|international|global|uk|usa|us)$/;

/**
 * What people put in the Company column when they have no employer, or will
 * not say. These are not hubs: two freelancers do not know each other through
 * "Freelance". Matched against the folded key.
 */
const NOT_AN_EMPLOYER = new Set([
  'self employed', 'selfemployed', 'self', 'freelance', 'freelancer', 'freelance consultant',
  'independent', 'independent consultant', 'stealth', 'stealth startup', 'stealth mode',
  'stealth mode startup', 'confidential', 'retired', 'various', 'none', 'n a', 'na',
  'unemployed', 'career break', 'looking for new opportunities', 'open to work',
  'sabbatical', 'student', 'private', 'tbc', 'tba', 'family', 'home'
]);

/** A company name -> its comparison key. '' for no usable name. */
export function companyKey(name) {
  let k = (name || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['\u2019`]/g, '')
    .replace(/\./g, '')                 // "S.A.S." -> "sas", "Inc." -> "inc"
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the\s+/, '');
  for (let prev = ''; prev !== k;) { prev = k; k = k.replace(SUFFIX, '').trim(); }
  return k;
}

/** True for "Self-employed", "Stealth Startup" and the like. */
export function isNotAnEmployer(name) {
  const k = companyKey(name);
  return !k || NOT_AN_EMPLOYER.has(k);
}

/**
 * Every spelling seen -> the one to show. Spellings sharing a key collapse to
 * the most common of them (ties to the shorter, which is usually the one
 * without a suffix). Non-employers map to ''.
 */
export function canonicalCompanies(names) {
  const byKey = new Map();          // key -> Map(spelling -> count)
  for (const raw of names) {
    const name = (raw || '').trim();
    if (!name) continue;
    const k = companyKey(name);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, new Map());
    const m = byKey.get(k);
    m.set(name, (m.get(name) || 0) + 1);
  }
  const shown = new Map();          // key -> display
  for (const [k, m] of byKey) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    shown.set(k, NOT_AN_EMPLOYER.has(k) ? '' : best);
  }
  return name => {
    const k = companyKey(name);
    return k ? (shown.has(k) ? shown.get(k) : (NOT_AN_EMPLOYER.has(k) ? '' : (name || '').trim())) : '';
  };
}
