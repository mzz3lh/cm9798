// Bundles the match demo into one self-contained HTML file: dist/demo.html.
// When the original game files are in original/cm9798v2, their fonts and the
// BOBBY.PCX backdrop are decoded and embedded, so the demo looks like the original.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { haveOriginals, loadFonts, loadBackdrop } from './original-assets.mjs';

const out = await build({
  entryPoints: ['src/ui/demo.ts'], bundle: true, minify: true, format: 'iife',
  target: 'es2020', write: false,
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let assets = '';
if (haveOriginals()) {
  const data = { fonts: loadFonts(), backdrops: { BOBBY: loadBackdrop('BOBBY') } };
  assets = `<script>window.CM_ASSETS=${JSON.stringify(data)}</script>\n`;
} else {
  console.warn('original/cm9798v2 not found: building without the original fonts and backdrop');
}
const html = readFileSync('src/ui/demo.html', 'utf8') + `\n${assets}<script>${js}</script>\n`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/demo.html', html);
console.log(`dist/demo.html ${(html.length / 1024).toFixed(0)} KB`);
