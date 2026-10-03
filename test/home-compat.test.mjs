import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('home leads with weekly counts and does not advertise the removed browser import', () => {
    const home = readFileSync(new URL('../src/home.ts', import.meta.url), 'utf8');
    assert.ok(home.indexOf('global-card home-graph') < home.indexOf('home-cta'));
    assert.match(home, /id="theme-toggle"/);
    assert.match(home, /id="command-manager"/);
    assert.match(home, /pnpx model-tides@latest upload/);
    assert.match(home, /yarn dlx model-tides@latest upload/);
    assert.match(home, /navigator\.clipboard\.writeText\(commandText\.textContent/);
    assert.doesNotMatch(home, /\/local\/|Choose a file|personal chart in your browser/);
});
