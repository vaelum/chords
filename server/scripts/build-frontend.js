#!/usr/bin/env node
/*
 * Precompiles the frontend's JSX into plain JS so the browser/webview loads
 * ready-to-run scripts instead of transpiling in-browser.
 *
 * Why this is required (not just an optimization): the packaged Tauri app serves
 * the frontend over its custom protocol, where Tauri injects a per-load `nonce`
 * into the CSP. Per the CSP spec, once a nonce is present the browser IGNORES
 * `'unsafe-inline'` — which silently blocks every inline <script>, including the
 * ones Babel Standalone injects when it transpiles `type="text/babel"` tags. The
 * result is a blank/black window (React never mounts). `cargo tauri dev` doesn't
 * hit this because it serves over a plain localhost dev server with no CSP.
 *
 * By precompiling, there are zero inline/eval'd scripts at runtime, so a strict
 * `script-src 'self'` works everywhere (Tauri app + web).
 *
 * Uses the already-vendored Babel Standalone — no npm install required. This is
 * the exact same transform the browser was doing, just done ahead of time.
 *
 * Usage:
 *   node build-frontend.js            compile once
 *   node build-frontend.js --watch    recompile on save (for development)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const Babel = require(path.join(FRONTEND, 'vendor', 'babel.min.js'));

// JSX source files (without extension). These are classic, non-module scripts
// that share a single global lexical scope and reference React/ReactDOM as
// globals, so we transform syntax only — no bundling, no module wrapping.
const FILES = ['icons', 'ui', 'tweaks-panel', 'song-view', 'stage-view', 'screens', 'app'];

// Babel already builds the useful part of a syntax error — the message and a
// code frame — and puts it in `e.message`. What it cannot know is which file it
// was reading (it says "unknown:") and, if the error is simply thrown, node
// prints it under a stack trace through the minified vendored Babel: ~64KB of
// one-letter variable names with the one line you need buried in it.
//
// So: name the file, keep Babel's frame, drop the stack.
function report(name, e) {
  const where = e.loc
    ? `${name}.jsx:${e.loc.line}:${e.loc.column + 1}`   // Babel's column is 0-based
    : `${name}.jsx`;
  // Babel's first line ends with its own "(line:column)". We print a better
  // one — with the file name, and 1-based — so drop the duplicate.
  const message = String(e.message || e)
    .replace(/^unknown:\s*/, '')
    .replace(/^(.*?) \(\d+:\d+\)$/m, '$1');
  console.error(`\nerror: ${where} — ${message}\n`);
  console.error(`${name}.js was NOT written; it still holds the previous build.`);
}

function compile(name) {
  const srcPath = path.join(FRONTEND, name + '.jsx');
  const outPath = path.join(FRONTEND, name + '.js');
  const src = fs.readFileSync(srcPath, 'utf8');
  const { code } = Babel.transform(src, {
    presets: ['react'],   // JSX -> React.createElement (classic runtime)
    sourceType: 'script', // keep classic script scoping (shared globals)
    compact: false,
  });
  const header =
    `// AUTO-GENERATED from ${name}.jsx by server/scripts/build-frontend.js — do not edit.\n`;
  fs.writeFileSync(outPath, header + code);
  console.log(`compiled ${name}.jsx -> ${name}.js`);
}

// Stops at the first failure, rather than reporting every file: one bad edit
// usually cascades, and a wall of frames hides the one that is actually yours.
// Exits non-zero so a caller — CI, a release, a `&&` chain — notices.
function compileAll() {
  for (const f of FILES) {
    try {
      compile(f);
    } catch (e) {
      report(f, e);
      return false;
    }
  }
  return true;
}

const ok = compileAll();
if (!ok && !process.argv.includes('--watch')) process.exit(1);

if (process.argv.includes('--watch')) {
  console.log('watching for .jsx changes (Ctrl-C to stop)…');
  for (const f of FILES) {
    const srcPath = path.join(FRONTEND, f + '.jsx');
    // A broken save must not kill the watcher: report it and wait for the fix.
    fs.watch(srcPath, { persistent: true }, () => {
      try {
        compile(f);
      } catch (e) {
        report(f, e);
      }
    });
  }
}
