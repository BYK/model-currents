import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('home only advertises a working browser path while the incompatible older CLI is published', () => {
    const home = readFileSync(new URL('../src/home.ts', import.meta.url), 'utf8');
    assert.match(home, /href="\/local\/"/);
    assert.doesNotMatch(home, /npx model-tides@latest upload/);
});
