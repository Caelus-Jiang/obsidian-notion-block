import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'notion-table-tests-'));
const bundle = await build({
    stdin: { contents: `export * from './src/tableFormat'; export { getBlockRanges } from './src/blockRange';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', write: false
});
const modulePath = join(temp, 'table-tools.mjs');
await writeFile(modulePath, bundle.outputFiles[0].contents);
const { cells, tables, selectedTable, format, validWidths, resizePair, withWidths, getBlockRanges } = await import(pathToFileURL(modulePath));
const options = { removeEmptyRows: true, headerRow: true, headerColumn: true };
const emptyHead = '| | |\n| :--- | ---: |\n| 名称 | 数值 |\n| a | 0 |\n| | |\n| b | false |';
const table = tables(emptyHead)[0];
assert.equal(tables(emptyHead).length, 1);
const clean = format(table, options);
assert.ok(clean.text.includes('-->\n\n|'), 'separate HTML metadata from the table for Live Preview');
assert.equal(clean.removed, 2);
assert.ok(clean.markdown.startsWith('| 名称 | 数值 |\n| :--- | ---: |'));
assert.ok(clean.markdown.includes('| a | 0 |'));
assert.ok(clean.markdown.includes('| b | false |'));
assert.equal(format(tables(clean.text)[0], options).text, clean.text, 'idempotent formatting');
const withoutHead = format(tables(clean.text)[0], { ...options, headerRow: false });
assert.ok(withoutHead.markdown.startsWith('|  |  |'));
assert.ok(withoutHead.markdown.includes('| 名称 | 数值 |'));
assert.equal(format(tables(withoutHead.text)[0], options).text, clean.text, 'header round trip preserves labels');
const escaped = '| Key | Value |\n| --- | --- |\n| a\\|b | [[Note\\|alias]] |\n| `x\\|y` | tail\\\\ |';
assert.deepEqual(tables(escaped)[0].rows[1], ['a\\|b', '[[Note\\|alias]]']);
assert.deepEqual(cells('| x\\\\| y |'), ['x\\\\', 'y']);
assert.ok(format(tables(escaped)[0], options).text.includes('[[Note\\|alias]]'));
assert.equal(tables('```md\n' + emptyHead + '\n```').length, 0);
assert.equal(tables('~~~md\n' + emptyHead + '\n~~~').length, 0);
assert.equal(tables('%%\n' + emptyHead + '\n%%').length, 0);
assert.equal(tables('<!--\n' + emptyHead + '\n-->').length, 0);
assert.equal(tables('---\n' + emptyHead + '\n---').length, 0);
assert.equal(tables(emptyHead.split('\n').map(l => '> ' + l).join('\n')).length, 0);
assert.equal(tables('| a | b |\n| --- | --- |\n| x | missing | extra |')[0].rows.at(-1), null);
assert.throws(() => format(tables('| a | b |\n| --- | --- |\n| x | missing | extra |')[0], options));
const two = 'Intro\n\n' + emptyHead + '\n\n' + escaped + '\n\n^table-anchor\nOutro';
assert.equal(tables(two).length, 2);
assert.ok(selectedTable(two, 4));
assert.equal(selectedTable(two, 0, two.split('\n').length - 1), null, 'do not format multiple tables or prose');
const target = tables(two)[0];
const edited = two.slice(0, target.from) + format(target, options).text + two.slice(target.to);
assert.ok(edited.startsWith('Intro\n\n'));
assert.ok(edited.endsWith(escaped + '\n\n^table-anchor\nOutro'));
assert.equal(tables('| A | B |\n|---|---|\n| 1 | 2 |\n\n| 3 | 4 |').length, 1);
assert.equal(tables('| A | B |\n|---|---|\n| 1 | 2 |\n\n| C | D |\n|---|---|\n|3|4|').length, 2);
assert.equal(format(table, { ...options, removeEmptyRows: false }).rows, 3);
console.log('Table formatter checks passed: headers, blank rows, escapes, scope, malformed input and undo-safe replacement.');

assert.deepEqual(resizePair([200, 300, 100], 0, 50), [250, 250, 100]);
assert.deepEqual(resizePair([200, 300], 0, 9999), [436, 64]);
assert.deepEqual(resizePair([200, 300], 0, -9999), [64, 436]);
assert.deepEqual(resizePair([30, 40], 0, 999), [35, 35]);
assert.throws(() => resizePair([100, 200], 1, 10));
assert.equal(validWidths([NaN, 200], 2), null);
assert.equal(validWidths([100], 2), null);
const sized = withWidths(table, [180, 320], true);
const parsedSized = tables(sized)[0];
assert.ok(selectedTable(sized, 0), 'the metadata belongs to its table');
assert.deepEqual(parsedSized.widths, [180, 320]);
assert.deepEqual(parsedSized.rows, table.rows, 'resizing preserves all cells and blank rows');
assert.equal(parsedSized.headerColumn, true);
assert.deepEqual(tables(format(parsedSized, options).text)[0].widths, [180, 320], 'formatting preserves widths');
assert.equal(tables(withWidths(parsedSized, null))[0].widths, null, 'reset returns to automatic layout');
assert.equal(withWidths(parsedSized, [180, 320]), sized, 'resizing does not duplicate metadata');
assert.equal(tables(sized.replace('180,320', '1,320'))[0].widths, null);
console.log('Column width checks passed: clamping, persistence, reset, invalid input and cell preservation.');

// Exercise the existing block parser too: moving a table must carry its settings.
const source = 'Before\n\n' + sized + '\n\n^keep-id\n\nAfter';
const sourceLines = source.split('\n');
const doc = { lines: sourceLines.length, line(number) {
  const from = sourceLines.slice(0, number - 1).reduce((n, l) => n + l.length + 1, 0);
  return { text: sourceLines[number - 1], from, to: from + sourceLines[number - 1].length };
} };
const block = getBlockRanges(doc).find(b => b.type === 'table');
assert.ok(source.slice(block.from, block.to).startsWith('<!-- notion-table:'));
assert.ok(source.slice(block.from, block.to).endsWith('^keep-id'));
assert.equal(getBlockRanges(doc).filter(b => b.from >= block.from && b.to <= block.to).length, 1);
console.log('Block movement check passed: metadata and block ID stay with their table.');

await rm(temp, { recursive: true, force: true });
