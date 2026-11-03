import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deploy } from '../scripts/deploy.mjs';

test('Deployment migrates settings once, preserves personal settings on update, and keeps a rollback copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notion-deploy-'));
    try {
        const vault = join(root, 'vault'), source = join(root, 'build'), backupRoot = join(root, 'backups');
        const official = join(vault, '.obsidian/plugins/notion-block');
        await mkdir(official, { recursive: true }); await mkdir(source);
        await writeFile(join(official, 'data.json'), '{"hoverDelay":123}');
        await writeFile(join(official, 'main.js'), 'official build');
        await writeFile(join(source, 'main.js'), 'personal build v1');
        await writeFile(join(source, 'styles.css'), 'body {}');
        await writeFile(join(source, 'manifest.json'), JSON.stringify({ id: 'notion-block-peng', version: '1.7.2-peng.1' }));
        const first = await deploy(vault, { source, backupRoot });
        assert.equal(await readFile(join(first.destination, 'data.json'), 'utf8'), '{"hoverDelay":123}');
        await writeFile(join(first.destination, 'data.json'), '{"hoverDelay":456}');
        await writeFile(join(source, 'main.js'), 'personal build v2');
        const second = await deploy(vault, { source, backupRoot });
        assert.equal(await readFile(join(second.destination, 'data.json'), 'utf8'), '{"hoverDelay":456}');
        assert.equal(await readFile(join(second.destination, 'main.js'), 'utf8'), 'personal build v2');
        assert.equal(await readFile(join(second.backup, 'main.js'), 'utf8'), 'personal build v1');
        assert.equal(await readFile(join(official, 'main.js'), 'utf8'), 'official build');
        await writeFile(join(source, 'manifest.json'), '{"id":"notion-block"}');
        await assert.rejects(deploy(vault, { source, backupRoot }), /personal plugin ID/);
    } finally { await rm(root, { recursive: true, force: true }); }
});
