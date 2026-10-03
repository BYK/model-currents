import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../cli/dist/', import.meta.url));
rmSync(output, { recursive: true, force: true });
for (const name of ['scripts', 'src']) mkdirSync(`${output}${name}`, { recursive: true });
const scanner = readFileSync(`${root}scripts/history-scanner.mjs`, 'utf8');
if (!scanner.includes("'../src/usage-data.ts'")) throw new Error('Missing scanner CLI import.');
writeFileSync(`${output}scripts/history-scanner.mjs`, scanner.replace("'../src/usage-data.ts'", "'../src/usage-data.js'"));
const source = readFileSync(`${root}scripts/contribute.mjs`, 'utf8');
const imports = ['usage-data', 'weekly-snapshot'];
for (const name of imports) {
    if (!source.includes(`'../src/${name}.ts'`)) throw new Error(`Missing ${name} CLI import.`);
}
writeFileSync(`${output}scripts/contribute.mjs`, imports.reduce((text, name) =>
    text.replace(`'../src/${name}.ts'`, `'../src/${name}.js'`), source));
for (const name of imports) {
    const typescript = readFileSync(`${root}src/${name}.ts`, 'utf8');
    writeFileSync(`${output}src/${name}.js`, stripTypeScriptTypes(typescript));
}
