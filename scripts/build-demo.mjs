// Bundles the game and the match demo into self-contained HTML files:
// dist/game.html and dist/demo.html. When the original game files are in
// original/cm9798v2, their fonts and the BOBBY.PCX backdrop are decoded and
// embedded, so the pages look like the original.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { haveOriginals, loadFonts, loadBackdrop } from './original-assets.mjs';

let assets = '';
if (haveOriginals()) {
  const data = { fonts: loadFonts(), backdrops: { BOBBY: loadBackdrop('BOBBY') } };
  assets = `<script>window.CM_ASSETS=${JSON.stringify(data)}</script>\n`;
} else {
  console.warn('original/cm9798v2 not found: building without the original fonts and backdrop');
}
mkdirSync('dist', { recursive: true });
for (const name of ['game', 'demo']) {
  const out = await build({
    entryPoints: [`src/ui/${name}.ts`], bundle: true, minify: true, format: 'iife',
    target: 'es2020', write: false,
  });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = readFileSync(`src/ui/${name}.html`, 'utf8') + `\n${assets}<script>${js}</script>\n`;
  writeFileSync(`dist/${name}.html`, html);
  console.log(`dist/${name}.html ${(html.length / 1024).toFixed(0)} KB`);
}
