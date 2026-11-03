import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = JSON.parse(await readFile(join(root, '.upstream.json'), 'utf8'));
git('fetch', 'upstream', '--no-tags');
const tags = git('ls-remote', '--tags', '--refs', 'upstream').split('\n')
    .map(line => line.match(/refs\/tags\/(\d+\.\d+\.\d+)$/)?.[1]).filter(Boolean)
    .sort((a, b) => {
        const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
        return 0;
    });
console.log('Upstream:', baseline.repository);
console.log('Current source baseline:', baseline.version, baseline.commit);
console.log('Latest upstream release tag:', tags.at(-1) || '(none)');
console.log('Commits after baseline:\n' + (git('log', '--oneline', baseline.commit + '..upstream/main') || '(none)'));
console.log('This command only fetches and reports; it does not merge or deploy.');
