import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const targets = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'];
const requested = process.argv.slice(2);
if (!requested.length || requested.some((platform) => !targets.includes(platform)) ||
    new Set(requested).size !== requested.length) {
    throw new Error(`Select unique standalone targets: ${targets.join(', ')}.`);
}

const run = (args) => {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Standalone build failed.');
};

run(['scripts/package-cli.mjs']);
run(['node_modules/fossilize/dist/bin/cli.js', 'cli/dist/scripts/contribute.mjs',
    '--node-version', process.versions.node, '--out-dir', 'dist-bin', '--output-name', 'model-tides',
    ...requested.flatMap((platform) => ['--platforms', platform])]);
for (const platform of requested) {
    if (!existsSync(`dist-bin/model-tides-${platform}`)) throw new Error(`Missing ${platform} standalone binary.`);
}
