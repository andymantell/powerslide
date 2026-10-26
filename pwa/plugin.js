import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]);

// Writes dist/sw.js after the build: precaches every output file, with a version
// hash of their contents so each deploy replaces the previous offline copy.
export function serviceWorker() {
  let outDir;
  return {
    name: 'powerslide-sw',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; },
    closeBundle() {
      const list = files(outDir)
        .map((f) => relative(outDir, f).split('\\').join('/'))
        .filter((f) => f !== 'sw.js')
        .sort();
      const hash = createHash('sha256');
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const urls = ['./', ...list.map((f) => `./${f}`)];
      const src = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
        .replace('__VERSION__', JSON.stringify(version))
        .replace('__FILES__', JSON.stringify(urls, null, 2));
      writeFileSync(join(outDir, 'sw.js'), src);
    },
  };
}
