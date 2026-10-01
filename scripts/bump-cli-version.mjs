import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const version = process.env.CRAFT_NEW_VERSION;
if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
    throw new Error('Craft must provide a valid CRAFT_NEW_VERSION.');
}

const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (root.private !== true) throw new Error('The site package must stay private.');

const path = fileURLToPath(new URL('../cli/package.json', import.meta.url));
const cli = JSON.parse(readFileSync(path, 'utf8'));
if (cli.name !== 'model-tides' || cli.private === true) throw new Error('Expected the public Model Tides CLI package.');
writeFileSync(path, JSON.stringify({ ...cli, version }, null, 2) + '\n');
