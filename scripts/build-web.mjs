import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds the web shell into dist/web: bundles src/web/main.js with browser
// shims for the node builtins the core requires, copies the unchanged renderer
// (views, styles, vendor scripts), and derives index.html from the renderer's
// own page so the two shells cannot drift apart.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist', 'web');
const serve = process.argv.includes('--serve');

fs.mkdirSync(path.join(outDir, 'views'), { recursive: true });

const buildOptions = {
  entryPoints: [path.join(root, 'src', 'web', 'main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: path.join(outDir, 'pick42-web.js'),
  minify: !serve,
  sourcemap: true,
  loader: { '.csv': 'text' },
  alias: {
    'node:events': path.join(root, 'src', 'web', 'shims', 'events.js'),
    'node:fs': path.join(root, 'src', 'web', 'shims', 'fs.js'),
    'node:path': path.join(root, 'src', 'web', 'shims', 'path.js'),
    'node:crypto': path.join(root, 'src', 'web', 'shims', 'crypto.js'),
    'node:os': path.join(root, 'src', 'web', 'shims', 'os.js'),
    'node:zlib': path.join(root, 'src', 'web', 'shims', 'zlib.js'),
    'node:readline': path.join(root, 'src', 'web', 'shims', 'readline.js')
  },
  logLevel: 'info'
};

function copyAssets() {
  const rendererDir = path.join(root, 'src', 'draft-renderer');
  const copies = [
    [path.join(root, 'assets', 'icon.png'), path.join(outDir, 'icon.png')],
    [path.join(rendererDir, 'styles.css'), path.join(outDir, 'styles.css')],
    [path.join(root, 'src', 'draft', 'recipe-queue.js'), path.join(outDir, 'recipe-queue.js')],
    [path.join(root, 'src', 'draft', 'arena-sort.js'), path.join(outDir, 'arena-sort.js')],
    [path.join(root, 'node_modules', 'lucide', 'dist', 'umd', 'lucide.min.js'), path.join(outDir, 'lucide.min.js')]
  ];
  for (const name of fs.readdirSync(path.join(rendererDir, 'views'))) {
    copies.push([path.join(rendererDir, 'views', name), path.join(outDir, 'views', name)]);
  }
  for (const [from, to] of copies) fs.copyFileSync(from, to);
}

function writeIndexHtml() {
  let html = fs.readFileSync(path.join(root, 'src', 'draft-renderer', 'index.html'), 'utf8');
  const replacements = [
    [
      /<meta http-equiv="Content-Security-Policy"[^>]*>/,
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data: https://cards.scryfall.io https://*.scryfall.io; connect-src https://api.scryfall.com">'
    ],
    [/<title>[^<]*<\/title>/, '<title>Pick 42</title>\n    <link rel="icon" href="icon.png">'],
    [/<body>/, '<body class="web-shell">'],
    ['<script src="../../node_modules/lucide/dist/umd/lucide.min.js"></script>', '<script src="lucide.min.js"></script>'],
    ['<script src="../draft/recipe-queue.js"></script>', '<script src="recipe-queue.js"></script>'],
    [
      '<script src="../draft/arena-sort.js"></script>',
      '<script src="arena-sort.js"></script>\n    <script src="pick42-web.js"></script>'
    ]
  ];
  for (const [from, to] of replacements) {
    const before = html;
    html = html.replace(from, to);
    if (html === before) throw new Error(`index.html transform did not match: ${from}`);
  }
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
}

copyAssets();
writeIndexHtml();

if (serve) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
  const { hosts, port } = await context.serve({ servedir: outDir, port: 4242 });
  console.log(`Pick 42 web shell serving at http://${hosts[0] || 'localhost'}:${port}`);
} else {
  await esbuild.build(buildOptions);
  console.log('Pick 42 web shell built into dist/web');
}
