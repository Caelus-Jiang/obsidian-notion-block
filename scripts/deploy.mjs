import { access, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const id = 'notion-block-peng';
const exists = async path => { try { await access(path); return true; } catch { return false; } };

export async function deploy(vault, { source = project, backupRoot = join(homedir(), '.codex/backups/obsidian') } = {}) {
    vault = resolve(vault);
    if (!await exists(join(vault, '.obsidian'))) throw Error('Target is not an Obsidian vault.');
    const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
    if (manifest.id !== id) throw Error('Refusing to deploy a build without the personal plugin ID.');
    const files = ['main.js', 'manifest.json', 'styles.css'];
    const artifacts = await Promise.all(files.map(name => readFile(join(source, name))));
    if (artifacts.some(content => !content.length)) throw Error('Build artifacts are empty. Run npm run check first.');
    const destination = join(vault, '.obsidian/plugins', id);
    let backup = null;
    if (await exists(destination)) {
        backup = join(backupRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-' + id + '-' + process.pid);
        await mkdir(backupRoot, { recursive: true });
        await cp(destination, backup, { recursive: true, errorOnExist: true, force: false });
    }
    await mkdir(destination, { recursive: true });
    const settings = join(destination, 'data.json');
    const officialSettings = join(vault, '.obsidian/plugins/notion-block/data.json');
    if (!await exists(settings) && await exists(officialSettings))
        await cp(officialSettings, settings, { mode: constants.COPYFILE_EXCL });
    for (const [index, name] of files.entries()) {
        const pending = join(destination, name + '.pending-' + process.pid);
        await writeFile(pending, artifacts[index]);
        await rename(pending, join(destination, name));
    }
    return { destination, version: manifest.version, backup };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const args = process.argv.slice(2);
        const at = args.indexOf('--vault');
        const local = at >= 0 ? null : JSON.parse(await readFile(join(project, '.deploy.local.json'), 'utf8'));
        const vault = at >= 0 ? args[at + 1] : local?.vault;
        if (!vault) throw Error('Usage: npm run deploy -- --vault /absolute/path/to/vault');
        console.log(JSON.stringify(await deploy(vault), null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
