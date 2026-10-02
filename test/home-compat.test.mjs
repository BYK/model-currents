import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('home advertises the released CLI while keeping browser uploads available', () => {
    const home = readFileSync(new URL('../src/home.ts', import.meta.url), 'utf8');
    assert.match(home, /const command = 'npx model-tides@latest upload'/);
    assert.match(home, /id="upload-command"/);
    assert.match(home, /id="copy-command"/);
    assert.match(home, /href="\/local\/"/);
});
