// Bundles the match demo into one self-contained HTML file: dist/demo.html.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/ui/demo.ts'], bundle: true, minify: true, format: 'iife',
  target: 'es2020', write: false,
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/ui/demo.html', 'utf8') + `\n<script>${js}</script>\n`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/demo.html', html);
console.log(`dist/demo.html ${(html.length / 1024).toFixed(0)} KB`);
