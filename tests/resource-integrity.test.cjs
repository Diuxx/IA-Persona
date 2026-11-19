const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function resolveProjectResource(owner, relativePath) {
  assert.match(relativePath, /^\.\/?|^\.\.\//, `Only local resources are supported: ${relativePath}`);
  const absolutePath = path.resolve(path.dirname(owner), relativePath);
  assert.ok(absolutePath.startsWith(`${ROOT}${path.sep}`), `Resource escapes the project: ${relativePath}`);
  assert.ok(fs.existsSync(absolutePath), `Missing resource ${relativePath}, referenced by ${path.relative(ROOT, owner)}`);
  assert.ok(fs.statSync(absolutePath).isFile(), `Resource is not a file: ${relativePath}`);
}

function listJavaScriptFiles(directory) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...listJavaScriptFiles(location));
    else if (entry.isFile() && /\.(?:js|cjs)$/.test(entry.name)) results.push(location);
  }
  return results;
}

test('all local JavaScript and CSS references in index.html exist', () => {
  const html = path.join(ROOT, 'index.html');
  const source = fs.readFileSync(html, 'utf8');
  const scriptPaths = [...source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match => match[1]);
  const stylesheetPaths = [...source.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["']/g)].map(match => match[1]);

  assert.ok(scriptPaths.length >= 1, 'The entrypoint must load at least one script');
  for (const resourcePath of [...scriptPaths, ...stylesheetPaths]) {
    resolveProjectResource(html, resourcePath);
  }
});

test('all local CommonJS imports resolve to existing files', () => {
  for (const filename of listJavaScriptFiles(ROOT)) {
    const source = fs.readFileSync(filename, 'utf8');
    for (const match of source.matchAll(/\brequire\(["'](\.[^"']+)["']\)/g)) {
      const importPath = match[1];
      resolveProjectResource(filename, /\.(?:js|cjs|json)$/.test(importPath) ? importPath : `${importPath}.js`);
    }
  }
});
