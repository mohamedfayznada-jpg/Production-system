import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readRootFile = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('temporary open mode is explicit and login gate markup is absent', async () => {
    const [app, html] = await Promise.all([readRootFile('app.js'), readRootFile('index.html')]);
    assert.ok(app.includes('TEMPORARY OPEN MODE'));
    assert.ok(app.includes('uid: \'temporary_open_mode\''));
    assert.ok(app.includes('this.showAuthenticatedShell()'));
    assert.ok(!html.includes('id="auth-gate"'));
    assert.ok(html.includes('id="app-shell" aria-hidden="false"'));
});

test('brand assets and app install metadata are present', async () => {
    const [html, manifest, css] = await Promise.all([
        readRootFile('index.html'), readRootFile('manifest.json'), readRootFile('styles.css')
    ]);
    assert.ok(html.includes('src="brand-mark.svg"'));
    assert.ok(html.includes('MES CORE | Eng. Mohamed Fayez'));
    assert.ok(manifest.includes('icons/icon-192.svg'));
    assert.ok(manifest.includes('icons/icon-512.svg'));
    for (const color of ['#1A0F12', '#8B1E3F', '#FF5A7A', '#F5C451', '#F9E6D1']) {
        assert.ok(css.includes(color), `brand color ${color} should exist`);
    }
});
