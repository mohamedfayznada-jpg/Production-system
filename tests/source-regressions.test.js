import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readRootFile = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('quality defect cards escape text and do not interpolate data into inline handlers', async () => {
    const source = await readRootFile('app.js');
    const start = source.indexOf('renderScratchesList() {');
    const end = source.indexOf('toggleScratchStatus(id, currentStatus)', start);
    assert.ok(start >= 0 && end > start, 'quality rendering method should be present');
    const renderer = source.slice(start, end);

    assert.ok(renderer.includes('this.escapeHtml(defect.type'));
    assert.ok(renderer.includes('this.escapeHtml(defect.notes'));
    assert.ok(renderer.includes('this.getSafeHttpUrl(defect.image)'));
    assert.ok(renderer.includes('data-defect-action'));
    assert.ok(!renderer.includes('onclick='));
    assert.ok(!renderer.includes('${defect.type}'));
    assert.ok(!renderer.includes('${defect.notes}'));
});

test('client source does not contain the previous master bypass markers', async () => {
    const [app, api, html, css] = await Promise.all([
        readRootFile('app.js'),
        readRootFile('api.js'),
        readRootFile('index.html'),
        readRootFile('styles.css')
    ]);

    for (const marker of ['isBypass', 'MASTER_PASSWORD_HASH', 'public_guest_session', 'master_admin_mfayez']) {
        assert.ok(!app.includes(marker), `app.js should not contain ${marker}`);
        assert.ok(!api.includes(marker), `api.js should not contain ${marker}`);
    }
    assert.ok(html.includes('id="app-shell" aria-hidden="true"'));
    assert.ok(html.includes('id="auth-gate" class="auth-gate" style="display:flex;"'));
    assert.ok(!css.includes('#auth-gate { display:none !important; }'));
    assert.ok(!css.includes('#app-shell[aria-hidden="true"] { display:block !important; }'));
});
