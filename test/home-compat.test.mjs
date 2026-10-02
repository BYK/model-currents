import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('home directs uploads to the compatible browser while the older published CLI is still latest', () => {
    const home = readFileSync(new URL('../src/home.ts', import.meta.url), 'utf8');
    assert.match(home, /href="\/local\/"/);
    assert.doesNotMatch(home, /model-tides@latest.*upload|id="upload-command"/);
});
