/* Local Notion block extension: table formatting and persistent column sizing. */
const MARKER = /^<!-- notion-table: header-row=([01]) header-column=([01])(?: widths=([0-9]+(?:,[0-9]+)*))? -->$/;

function validWidths(widths, count) {
  return Array.isArray(widths) && widths.length === count &&
    widths.every(w => Number.isFinite(w) && w >= 24 && w <= 10000)
    ? widths.map(Math.round) : null;
}

function markerFor(table, options = {}) {
  const widths = validWidths(options.widths === undefined ? table.widths : options.widths, table.separators.length);
  return `<!-- notion-table: header-row=${+(options.headerRow ?? table.headerRow)} header-column=${+(options.headerColumn ?? table.headerColumn ?? false)}${widths ? ' widths=' + widths.join(',') : ''} -->`;
}

function resizePair(widths, column, delta) {
  if (!validWidths(widths, widths.length) || column < 0 || column >= widths.length - 1 || !Number.isFinite(delta))
    throw Error('无效的表格列宽。');
  const result = widths.map(Math.round);
  const total = result[column] + result[column + 1];
  const minimum = Math.min(64, Math.floor(total / 2));
  result[column] = Math.max(minimum, Math.min(total - minimum, Math.round(result[column] + delta)));
  result[column + 1] = total - result[column];
  return result;
}

function withWidths(table, widths, defaultHeaderColumn = false) {
  if (widths !== null && !validWidths(widths, table.separators.length)) throw Error('列数或列宽无效。');
  const raw = table.markerLine == null ? table.original :
    table.original.split('\n').slice(table.startLine - table.markerLine).join('\n');
  return markerFor(table, { widths, headerColumn: table.headerColumn ?? defaultHeaderColumn }) + '\n\n' + raw;
}

function cells(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) {
    let slashes = 0;
    for (let i = text.length - 2; i >= 0 && text[i] === '\\'; i--) slashes++;
    if (slashes % 2 === 0) text = text.slice(0, -1);
  }
  const result = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '|') continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) slashes++;
    if (slashes % 2) continue;
    result.push(text.slice(start, i).trim());
    start = i + 1;
  }
  result.push(text.slice(start).trim());
  return result;
}
const delimiter = line => line.includes('|') && cells(line).every(c => /^:?-{2,}:?$/.test(c));
const blank = row => row.every(c => !c.trim());

function tables(text) {
  const lines = text.split('\n');
  const offsets = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const result = [];
  let fence = null, comment = false, htmlComment = false, yaml = lines[0] === '---';
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    if (yaml) { if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) yaml = false; continue; }
    const f = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    if (htmlComment || line.includes('<!--')) {
      htmlComment = !line.includes('-->');
      continue;
    }
    if ((line.match(/%%/g) || []).length % 2) { comment = !comment; continue; }
    if (comment || /^\s{4}|^\t|^ {0,3}>/.test(line)) continue;
    if (!line.includes('|') || delimiter(line) || !delimiter(lines[i + 1])) continue;
    const header = cells(line), separators = cells(lines[i + 1]);
    if (header.length !== separators.length) continue;
    const rows = [header];
    let end = i + 1;
    for (let j = i + 2; j < lines.length; j++) {
      if (!lines[j].trim()) {
        let k = j + 1;
        while (k < lines.length && !lines[k].trim()) k++;
        // Do not join two independently headed tables across a blank line.
        if (k >= lines.length || !/^ {0,3}\|.*\|\s*$/.test(lines[k]) ||
            delimiter(lines[k + 1] || '') || cells(lines[k]).length !== header.length) break;
        end = j;
        continue;
      }
      if (!lines[j].includes('|') || /^\s{4}|^\t|^ {0,3}>/.test(lines[j]) ||
          delimiter(lines[j]) || delimiter(lines[j + 1] || '')) break;
      const row = cells(lines[j]);
      // Refuse malformed rows instead of silently dropping or inventing cells.
      if (row.length !== header.length) {
        rows.push(null); end = j; break;
      }
      rows.push(row); end = j;
    }
    let markerLine = i - 1;
    while (markerLine >= 0 && !lines[markerLine].trim()) markerLine--;
    const marker = markerLine >= 0 ? lines[markerLine].match(MARKER) : null;
    const start = marker ? markerLine : i;
    result.push({ startLine: i, endLine: end, from: offsets[start],
      to: offsets[end] + lines[end].length, rows, separators,
      headerRow: marker ? marker[1] === '1' : true,
      headerColumn: marker ? marker[2] === '1' : null,
      widths: marker?.[3] ? validWidths(marker[3].split(',').map(Number), header.length) : null,
      markerLine: marker ? markerLine : null,
      original: lines.slice(start, end + 1).join('\n') });
    i = end;
  }
  return result;
}

function selectedTable(text, fromLine, toLine = fromLine) {
  const found = tables(text).filter(t => fromLine <= t.endLine && toLine >= (t.markerLine ?? t.startLine));
  if (found.length !== 1) return null;
  const table = found[0], lines = text.split('\n');
  if (lines.slice(fromLine, table.startLine).some(l => l.trim() && !MARKER.test(l)) ||
      lines.slice(table.endLine + 1, toLine + 1).some(l => l.trim())) return null;
  return table;
}

function format(table, options) {
  if (table.rows.some(r => !r)) throw Error('表格列数不一致，请先检查缺失或未转义的竖线。');
  let [header, ...body] = table.rows.map(r => [...r]);
  let removed = 0, promoted = false;
  if (options.removeEmptyRows) {
    const before = body.length;
    body = body.filter(r => !blank(r));
    removed += before - body.length;
  }
  if (options.headerRow) {
    if (blank(header)) {
      const first = body.findIndex(r => !blank(r));
      if (first >= 0) { header = body.splice(first, 1)[0]; promoted = true; removed++; }
    }
  } else {
    if (!blank(header)) body.unshift(header);
    header = table.separators.map(() => '');
  }
  const row = r => `| ${r.join(' | ')} |`;
  const separators = table.separators.map(c => `${c.startsWith(':') ? ':' : ''}---${c.endsWith(':') ? ':' : ''}`);
  const markdown = [row(header), row(separators), ...body.map(row)].join('\n');
  const marker = markerFor(table, options);
  return { text: marker + '\n\n' + markdown, markdown, removed, promoted, rows: body.length };
}

function styleTable(table, options) {
  table.classList.toggle('nb-table-no-header', !options.headerRow);
  table.classList.toggle('nb-table-header-column', options.headerColumn);
  table.classList.toggle('nb-table-no-header-column', !options.headerColumn);
  setColumnWidths(table, options.widths);
}

const originalLayouts = new WeakMap();
function setColumnWidths(table, requested, force = false) {
  if (table.dataset.nbColumnResizing && !force) return;
  const count = table.rows[0]?.cells.length || 0;
  const widths = validWidths(requested, count);
  let group = table.querySelector(':scope > colgroup[data-nb-widths]');
  if (!widths) {
    group?.remove();
    table.classList.remove('nb-table-sized');
    if (originalLayouts.has(table)) {
      const { value, priority } = originalLayouts.get(table);
      if (value) table.style.setProperty('width', value, priority);
      else table.style.removeProperty('width');
      originalLayouts.delete(table);
    }
    return;
  }
  if (!originalLayouts.has(table)) originalLayouts.set(table,
    { value: table.style.getPropertyValue('width'), priority: table.style.getPropertyPriority('width') });
  const total = widths.reduce((a, b) => a + b, 0);
  table.classList.add('nb-table-sized');
  table.style.setProperty('width', total + 'px');
  if (!group) {
    group = table.ownerDocument.createElement('colgroup');
    group.dataset.nbWidths = '';
    table.prepend(group);
  }
  if (group.children.length !== count) group.replaceChildren(...widths.map(() => table.ownerDocument.createElement('col')));
  widths.forEach((width, i) => { group.children[i].style.width = (width / total * 100) + '%'; });
}

function install(plugin, api, cm, getBlocks, history) {
  const { Modal, Setting, Notice, MarkdownView, MarkdownRenderer, Component } = api;
  const cache = new WeakMap();
  function parsed(doc) {
    if (!cache.has(doc)) cache.set(doc, tables(doc.toString()));
    return cache.get(doc);
  }
  function at(view, lineNo) {
    const line = Math.max(0, lineNo - 1);
    return parsed(view.state.doc).find(t => (t.markerLine ?? t.startLine) <= line && t.endLine >= line);
  }
  function inherited(view) {
    return !!view.dom.closest('.markdown-source-view.table-header-column');
  }

  const resizable = new Map();
  function disposeResize(table) {
    const state = resizable.get(table);
    if (!state) return;
    state.cancel?.();
    state.observer.disconnect();
    state.overlay.remove();
    if (!state.host.querySelector('.nb-table-column-handles')) state.host.classList.remove('nb-table-resize-host');
    delete table.dataset.nbColumnResizing;
    setColumnWidths(table, null);
    resizable.delete(table);
  }
  function measuredWidths(table) {
    const row = Array.from(table.rows).find(r => r.getBoundingClientRect().height > 0);
    return row ? Array.from(row.cells).map(c => Math.round(c.getBoundingClientRect().width)) : [];
  }
  function snapshot(state) {
    const binding = state.binding;
    if (binding.view) {
      const view = binding.view;
      const doc = view.state.doc;
      const entry = at(view, doc.lineAt(view.posAtDOM(state.table)).number);
      if (!entry) throw Error('表格已变化，请重新拖动。');
      return { view, doc, entry, defaultHeaderColumn: inherited(view) };
    }
    return { ...binding };
  }
  async function saveWidths(state, saved, widths) {
    if (state.saving) return;
    state.saving = true;
    try {
      if (saved.view) {
        const view = saved.view, entry = saved.entry;
        if (!view.dom.isConnected || view.state.doc !== saved.doc) throw Error('表格已变化，此次列宽调整未保存。');
        view.dispatch({ changes: { from: entry.from, to: entry.to,
          insert: withWidths(entry, widths, saved.defaultHeaderColumn) },
          annotations: history.isolateHistory.of('full'), userEvent: 'input.table-width' });
        const owner = plugin.app.workspace.getLeavesOfType('markdown').find(l => l.view.editor?.cm === view)?.view;
        if (owner) await owner.save();
      } else {
        const file = plugin.app.vault.getAbstractFileByPath(saved.path);
        if (!file) throw Error('笔记已关闭或移动，列宽未保存。');
        await plugin.app.vault.process(file, text => {
          const matches = tables(text).filter(t => t.original === saved.entry.original);
          const entry = text === saved.source ? matches.find(t => t.from === saved.entry.from) :
            matches.length === 1 ? matches[0] : null;
          if (!entry) throw Error('表格已变化，此次列宽调整未保存。');
          return text.slice(0, entry.from) + withWidths(entry, widths, saved.defaultHeaderColumn) + text.slice(entry.to);
        });
      }
    } catch (error) {
      setColumnWidths(state.table, saved.entry.widths, true);
      new Notice(error.message);
    } finally { state.saving = false; }
  }
  function makeResizable(table, binding) {
    if (table.rows[0]?.cells.length < 2 || binding.entry.rows.some(r => !r)) return;
    let state = resizable.get(table);
    if (state) { state.binding = binding; state.layout(); return; }
    const host = table.parentElement;
    if (!host) return;
    host.classList.add('nb-table-resize-host');
    const overlay = host.createDiv({ cls: 'nb-table-column-handles' });
    const win = table.ownerDocument.defaultView;
    state = { table, host, overlay, binding, handles: [], saving: false };
    resizable.set(table, state);
    const direction = () => win.getComputedStyle(table).direction === 'rtl' ? -1 : 1;
    state.layout = () => {
      const row = Array.from(table.rows).find(r => r.getBoundingClientRect().height > 0) ||
        (table.classList.contains('nb-table-no-header') ? table.tBodies[0]?.rows[0] : table.rows[0]);
      if (!row) return;
      const count = row.cells.length - 1;
      if (state.handles.length !== count) {
        overlay.empty(); state.handles = [];
        for (let column = 0; column < count; column++) {
          const handle = overlay.createDiv({ cls: 'nb-table-column-resize', attr: {
            role: 'separator', tabindex: '0', 'aria-orientation': 'vertical',
            'aria-label': `调整第 ${column + 1} 列宽度`,
            title: '拖动调整列宽；方向键微调；双击或 Enter 恢复整表自动列宽'
          } });
          handle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || state.saving) return;
            event.preventDefault(); event.stopPropagation();
            const initial = measuredWidths(table);
            if (!validWidths(initial, row.cells.length)) return;
            let saved;
            try { saved = snapshot(state); } catch (error) { new Notice(error.message); return; }
            const x = event.clientX, id = event.pointerId;
            let widths = initial, changed = false;
            table.dataset.nbColumnResizing = '1';
            overlay.classList.add('is-resizing');
            try { handle.setPointerCapture(id); } catch { /* Detached test or cancelled pointer. */ }
            const move = e => {
              if (e.pointerId !== id) return;
              e.preventDefault(); e.stopPropagation();
              widths = resizePair(initial, column, (e.clientX - x) * direction());
              changed = widths.some((w, i) => Math.abs(w - initial[i]) >= 2);
              setColumnWidths(table, widths, true); state.layout();
            };
            const finish = commit => {
              win.removeEventListener('pointermove', move, true);
              win.removeEventListener('pointerup', up, true);
              win.removeEventListener('pointercancel', cancel, true);
              win.removeEventListener('keydown', key, true);
              try { if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id); } catch { /* Pointer capture was already released. */ }
              state.cancel = null;
              delete table.dataset.nbColumnResizing;
              overlay.classList.remove('is-resizing');
              if (commit && changed) void saveWidths(state, saved, widths);
              else { setColumnWidths(table, saved.entry.widths, true); state.layout(); }
            };
            const up = e => { if (e.pointerId === id) { e.preventDefault(); e.stopPropagation(); finish(true); } };
            const cancel = () => finish(false);
            const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
            state.cancel = cancel;
            win.addEventListener('pointermove', move, true);
            win.addEventListener('pointerup', up, true);
            win.addEventListener('pointercancel', cancel, true);
            win.addEventListener('keydown', key, true);
          });
          handle.addEventListener('dblclick', event => {
            event.preventDefault(); event.stopPropagation();
            if (state.saving) return;
            try { const saved = snapshot(state); setColumnWidths(table, null, true); void saveWidths(state, saved, null); }
            catch (error) { new Notice(error.message); }
          });
          handle.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !state.saving) {
              event.preventDefault(); event.stopPropagation();
              try { const saved = snapshot(state); setColumnWidths(table, null, true); void saveWidths(state, saved, null); }
              catch (error) { new Notice(error.message); }
              return;
            }
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || state.saving) return;
            event.preventDefault(); event.stopPropagation();
            try {
              const widths = measuredWidths(table), saved = snapshot(state);
              const delta = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : 10) * direction();
              const next = resizePair(widths, column, delta);
              setColumnWidths(table, next); void saveWidths(state, saved, next);
            } catch (error) { new Notice(error.message); }
          });
          state.handles.push(handle);
        }
      }
      const hostRect = host.getBoundingClientRect(), rect = table.getBoundingClientRect();
      state.handles.forEach((handle, i) => {
        const cell = row.cells[i].getBoundingClientRect();
        const edge = direction() === 1 ? cell.right : cell.left;
        handle.style.left = (edge - hostRect.left + host.scrollLeft - host.clientLeft) + 'px';
        handle.style.top = (rect.top - hostRect.top + host.scrollTop - host.clientTop) + 'px';
        handle.style.height = rect.height + 'px';
        handle.setAttribute('aria-valuenow', String(Math.round(cell.width)));
        const pair = cell.width + row.cells[i + 1].getBoundingClientRect().width;
        const minimum = Math.min(64, Math.floor(pair / 2));
        handle.setAttribute('aria-valuemin', String(minimum));
        handle.setAttribute('aria-valuemax', String(Math.round(pair - minimum)));
        handle.setAttribute('aria-valuetext', Math.round(cell.width) + ' 像素');
      });
    };
    state.observer = new win.ResizeObserver(state.layout);
    state.observer.observe(table); state.observer.observe(host);
    state.layout();
  }

  class TableFormatModal extends Modal {
    constructor(view, table) {
      super(plugin.app);
      this.view = view;
      this.table = table;
      this.capturedDoc = view.state.doc;
      this.options = { removeEmptyRows: true, headerRow: table.headerRow,
        headerColumn: table.headerColumn ?? inherited(view) };
      this.component = plugin.addChild(new Component());
      this.generation = 0;
    }
    onOpen() {
      this.setTitle('格式化当前表格');
      this.modalEl.addClass('nb-table-format-modal');
      new Setting(this.contentEl).setName('删除空白行')
        .setDesc('只删除所有单元格均为空的行，保留有内容的行。')
        .addToggle(t => t.setValue(true).onChange(v => { this.options.removeEmptyRows = v; this.preview(); }));
      new Setting(this.contentEl).setName('标题行')
        .setDesc('开启时将第一行作为标题；关闭时原列名保留为普通数据行。')
        .addToggle(t => t.setValue(this.options.headerRow).onChange(v => { this.options.headerRow = v; this.preview(); }));
      new Setting(this.contentEl).setName('标题列')
        .setDesc('强调第一列，仅影响当前表格。')
        .addToggle(t => t.setValue(this.options.headerColumn).onChange(v => { this.options.headerColumn = v; this.preview(); }));
      this.summary = this.contentEl.createDiv({ cls: 'nb-table-format-summary' });
      this.previewEl = this.contentEl.createDiv({ cls: 'nb-table-format-preview markdown-rendered' });
      new Setting(this.contentEl).addButton(b => b.setButtonText('取消').onClick(() => this.close()))
        .addButton(b => b.setButtonText('应用').setCta().onClick(() => this.apply()));
      this.preview();
    }
    async preview() {
      const generation = ++this.generation;
      this.previewEl.empty();
      let result;
      try { result = format(this.table, this.options); }
      catch (error) { this.summary.setText(error.message); return; }
      this.summary.setText(`将删除 ${result.removed} 行空白行${result.promoted ? '，并提升实际标题行' : ''}。应用后可用撤销恢复。`);
      const container = this.previewEl.createDiv();
      const file = plugin.app.workspace.getActiveFile();
      await MarkdownRenderer.render(plugin.app, result.markdown, container, file?.path || '', this.component);
      if (generation !== this.generation) { container.remove(); return; }
      container.querySelectorAll('table').forEach(t => styleTable(t, { ...this.options, widths: this.table.widths }));
    }
    async apply() {
      const { view, table } = this;
      if (!view.dom.isConnected || view.state.doc !== this.capturedDoc || view.state.doc.sliceString(table.from, table.to) !== table.original) {
        new Notice('表格已发生变化，请关闭窗口后重新选择。'); return;
      }
      try {
        const result = format(table, this.options);
        view.dispatch({ changes: { from: table.from, to: table.to, insert: result.text },
          selection: { anchor: table.from + result.text.indexOf('\n') + 1 },
          annotations: history.isolateHistory.of('full'),
          userEvent: 'input.table-format' });
        const owner = plugin.app.workspace.getLeavesOfType('markdown').find(l => l.view.editor?.cm === view)?.view;
        if (owner) await owner.save();
        this.close(); view.focus();
      } catch (error) { new Notice(error.message); }
    }
    onClose() { this.generation++; plugin.removeChild(this.component); this.contentEl.empty(); }
  }

  function openAt(view, lineNo) {
    const selection = view.state.selection.main;
    const table = lineNo == null
      ? selectedTable(view.state.doc.toString(), view.state.doc.lineAt(selection.from).number - 1,
        view.state.doc.lineAt(Math.max(selection.from, selection.to - 1)).number - 1)
      : at(view, lineNo);
    if (!table) { new Notice('请将光标放在一张 Markdown 表格内，或只选中一张表格。'); return; }
    if (table.rows.some(r => !r)) { new Notice('表格列数不一致，请先检查缺失或未转义的竖线。'); return; }
    new TableFormatModal(view, table).open();
  }

  // Reuse the existing block parser so editor decoration never touches fenced code.
  function paint(view) {
    const doc = view.state.doc;
    const valid = getBlocks(doc).filter(b => b.type === 'table');
    for (const [table, state] of resizable) {
      if (state.binding.view === view && !view.dom.contains(table)) disposeResize(table);
    }
    for (const table of view.dom.querySelectorAll('.cm-content > .cm-line table, .cm-table-widget table')) {
      try {
        const line = doc.lineAt(view.posAtDOM(table)).number;
        const entry = at(view, line);
        if (!entry || !valid.some(b => b.startLine - 1 === entry.startLine || b.startLine - 1 === entry.markerLine)) continue;
        styleTable(table, { headerRow: entry.headerRow, headerColumn: entry.headerColumn ?? inherited(view), widths: entry.widths });
        makeResizable(table, { view, entry });
      } catch { /* Native cell editors may detach during a transaction. */ }
    }
  }
  const extension = cm.ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.win = view.dom.ownerDocument.defaultView ?? window;
      this.timer = null;
      this.decorations = this.markers(view);
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(view.dom, { childList: true, subtree: true });
      this.schedule();
    }
    schedule() {
      this.win.clearTimeout(this.timer);
      this.timer = this.win.setTimeout(() => { this.timer = null; paint(this.view); }, 0);
    }
    markers(view) {
      const selection = view.state.selection.main;
      const ranges = parsed(view.state.doc).flatMap(t => {
        if (t.markerLine == null) return [];
        const line = view.state.doc.line(t.markerLine + 1);
        if (selection.from <= line.to && selection.to >= line.from) return [];
        return [cm.Decoration.line({ class: 'nb-table-format-marker' }).range(line.from)];
      });
      return cm.Decoration.set(ranges, true);
    }
    update(u) {
      if (u.docChanged || u.selectionSet) this.decorations = this.markers(u.view);
      if (u.docChanged || u.viewportChanged) this.schedule();
    }
    destroy() {
      this.win.clearTimeout(this.timer); this.observer.disconnect();
      for (const [table, state] of resizable) if (state.binding.view === this.view) disposeResize(table);
    }
  }, { decorations: value => value.decorations });
  plugin.registerEditorExtension(extension);
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    if (el.closest('.nb-table-format-preview')) return;
    const info = ctx.getSectionInfo(el);
    if (!info) return;
    const candidates = tables(info.text).filter(t => t.startLine >= info.lineStart && t.startLine <= info.lineEnd);
    const classes = ctx.frontmatter?.cssclasses ?? plugin.app.metadataCache.getCache(ctx.sourcePath)?.frontmatter?.cssclasses;
    const defaultColumn = (Array.isArray(classes) ? classes : String(classes || '').split(/[ ,]+/)).includes('table-header-column');
    el.querySelectorAll('table').forEach((table, i) => {
      const entry = candidates[i];
      if (entry) {
        styleTable(table, { headerRow: entry.headerRow,
          headerColumn: entry.headerColumn ?? defaultColumn, widths: entry.widths });
        makeResizable(table, { path: ctx.sourcePath, source: info.text, entry, defaultHeaderColumn: defaultColumn });
        const lifecycle = new api.MarkdownRenderChild(el);
        lifecycle.register(() => disposeResize(table));
        ctx.addChild(lifecycle);
      }
    });
  });
  plugin.addCommand({ id: 'format-current-table', name: '格式化当前表格…',
    editorCheckCallback: (checking, editor, markdownView) => {
      const view = markdownView.editor?.cm;
      if (!view) return false;
      const s = view.state.selection.main;
      const table = selectedTable(view.state.doc.toString(), view.state.doc.lineAt(s.from).number - 1,
        view.state.doc.lineAt(Math.max(s.from, s.to - 1)).number - 1);
      if (!table) return false;
      if (!checking) openAt(view);
      return true;
    } });
  // Remember the actual clicked table even when its native cell editor owns focus.
  const clicked = new WeakMap();
  plugin.registerDomEvent(document, 'contextmenu', event => {
    const table = event.target.closest?.('.cm-table-widget table');
    const markdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const view = markdownView?.editor?.cm;
    if (!view || !table || !view.dom.contains(table)) return;
    try { clicked.set(view, { line: view.state.doc.lineAt(view.posAtDOM(table)).number, time: Date.now() }); }
    catch { /* The generic editor command remains available. */ }
  }, true);
  plugin.registerEvent(plugin.app.workspace.on('editor-menu', (menu, editor, markdownView) => {
    const view = markdownView.editor?.cm;
    if (!view) return;
    const click = clicked.get(view);
    const line = click && Date.now() - click.time < 1000 ? click.line : view.state.doc.lineAt(view.state.selection.main.head).number;
    if (at(view, line)) menu.addItem(item => item.setTitle('格式化当前表格…').setIcon('table-properties')
      .onClick(() => openAt(view, line)));
  }));
  plugin.register(() => {
    for (const table of resizable.keys()) disposeResize(table);
    document.querySelectorAll('table.nb-table-no-header, table.nb-table-header-column, table.nb-table-no-header-column')
      .forEach(t => t.classList.remove('nb-table-no-header', 'nb-table-header-column', 'nb-table-no-header-column'));
  });
  return { openAt, hasTable: (view, line) => !!at(view, line), paint };
}

export { cells, tables, selectedTable, format, install, validWidths, resizePair, withWidths };
