// Checks credits.json covers every file the game ships (src/assets and
// public): each must match a made-here "original" entry or a third-party
// "assets" entry, and every third-party entry must say where it came from,
// who made it, its licence and when it was downloaded.
//   node tools/credits-check.mjs
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const credits = JSON.parse(readFileSync(new URL('../credits.json', import.meta.url)));
const files = execSync('git ls-files src/assets public', { encoding: 'utf8' }).split('\n').filter(Boolean);

const glob = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
const matches = (entry, f) => entry.files.some((g) => glob(g).test(f));

const problems = [];
const NEEDED = ['title', 'source', 'author', 'licence', 'licenceUrl', 'downloaded'];
for (const a of credits.assets) {
  const name = a.title || a.files?.join(', ') || '(unnamed entry)';
  for (const k of NEEDED) if (!a[k]) problems.push(`${name}: missing "${k}"`);
  if (!a.files?.length) problems.push(`${name}: no files listed`);
  if (a.downloaded && !/^\d{4}-\d{2}-\d{2}$/.test(a.downloaded)) problems.push(`${name}: "downloaded" should be YYYY-MM-DD`);
  if (credits.neverUse.some((l) => a.licence?.startsWith(l))) problems.push(`${name}: ${a.licence} can't be used`);
  else if (credits.needsAskingFirst.includes(a.licence)) {
    if (!a.attribution) problems.push(`${name}: ${a.licence} needs an "attribution" line for the credits screen`);
  } else if (!credits.allowedLicences.includes(a.licence)) problems.push(`${name}: licence "${a.licence}" isn't on the allowed list`);
  for (const g of a.files || []) if (!g.includes('*') && !existsSync(g)) problems.push(`${name}: ${g} doesn't exist`);
}
for (const f of files) {
  const third = credits.assets.filter((a) => matches(a, f));
  if (third.length > 1) problems.push(`${f}: listed by more than one asset entry`);
  if (!third.length && !credits.original.some((o) => matches(o, f))) problems.push(`${f}: not in credits.json`);
}

if (problems.length) {
  console.error(problems.map((p) => '  ' + p).join('\n'));
  console.error(`credits.json: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`credits.json covers all ${files.length} shipped files (${credits.assets.length} third-party).`);
