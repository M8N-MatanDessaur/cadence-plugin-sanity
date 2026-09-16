/**
 * Everything about a type beyond its documents, so nobody has to open the Studio for it:
 * a new document, generate documents with AI, find and replace across the type's text
 * fields, export as JSON. The aside offers them; each opens as a panel in the main area.
 * The schema itself lives in the repository and is edited from Studio, not from here.
 */
import { askModel, newKey, ptToText } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';
import { emptyFor, FieldEditor } from './fields.js';

export function useTypeSchema(host, san, type) {
  const { react } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const reload = useCallback((fresh) => { if (!type) return; san(`/schema?type=${encodeURIComponent(type)}${fresh ? '&refresh=1' : ''}`).then(setData).catch(() => setData({ name: type, fields: [], objects: {}, source: 'none' })); }, [san, type]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  return { data, reload };
}

const fieldLine = (f) => `${f.type}${f.objectType ? `:${f.objectType}` : ''}${f.required ? ' - required' : ''}${f.of ? ` of ${f.of.map((o) => o.type).join('|')}${f.anyObject ? '|any object' : ''}` : ''}${f.to ? ` to ${f.to.join('|')}` : ''}${f.inferred ? ' - inferred' : ''}`;

/** The tools of a type, in the right pane. */
export function TypeTools({ host, san, type, typeRow, schema, mode, setMode, onGroq }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const fields = schema ? schema.fields || [] : [];
  const btn = (id, label, primary) => h(ui.Button, { className: 'sy-btn--sm', variant: primary ? 'primary' : undefined, onClick: () => setMode(mode === id ? null : id) }, label);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'Do', action: meta(mode ? 'one open' : '') },
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, btn('new', 'New document', true), btn('generate', 'Generate with AI'), btn('replace', 'Find and replace'), btn('export', 'Export'), h(ui.Button, { className: 'sy-btn--sm', onClick: () => onGroq(`*[_type == "${type}"] | order(_updatedAt desc) [0...20]{\n  _id, _updatedAt, title, "slug": slug.current\n}`) }, 'Query it'))),
    typeRow ? Panel(host, { title: 'This type', action: meta(typeRow.inCode ? 'in the code' : 'inferred') }, h(ui.InfoGrid, { items: [{ label: 'Documents', value: typeRow.total }, { label: 'Published', value: typeRow.published }, { label: 'Changed', value: typeRow.changed }, { label: 'Unpublished', value: typeRow.drafts }, { label: 'Stale', value: typeRow.stale || 0 }] })) : null,
    Panel(host, { title: 'Fields', action: meta(schema ? schema.source === 'code' ? schema.file.split('/').pop() : schema.source === 'documents' ? 'from the documents' : 'unknown' : '...') },
      !schema ? h(ui.Skeleton, { count: 4, height: 14 }) : fields.length ? h('div', { style: { maxHeight: 420, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, fields.map((f) => ListRow(host, { key: f.name, lead: h('span', { className: 'mind-dot', style: { background: f.required ? 'var(--sy-brass)' : 'var(--sy-text-3)', width: 7, height: 7 } }), label: f.title ? `${f.title} (${f.name})` : f.name, sub: `${fieldLine(f)}${f.description ? ` - ${f.description}` : ''}` })))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No field is known: the repository has no schema for this type and no document exists yet.')));
}

export function NewDocument({ host, san, type, schema, seed, onCreated, onCancel }) {
  const { h, ui, notify } = host;
  const { useState } = host.react;
  const fields = (schema ? schema.fields || [] : []).filter((f) => !f.hidden && !f.readOnly);
  const [id, setId] = useState('');
  const [data, setData] = useState(() => seed ? { ...seed } : Object.fromEntries(fields.map((f) => [f.name, f.initialValue !== undefined ? f.initialValue : emptyFor(f)])));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setData({ ...data, [k]: v });
  const missing = fields.filter((f) => f.required && (data[f.name] === undefined || data[f.name] === null || data[f.name] === '' || (Array.isArray(data[f.name]) && !data[f.name].length) || (data[f.name] && data[f.name]._type === 'slug' && !data[f.name].current)));
  const create = async () => {
    setBusy(true);
    try {
      const body = { ...data, _type: type, _draft: true };
      if (id.trim()) body._id = id.trim();
      const r = await san(`/documents/${encodeURIComponent(type)}?draft=1`, { method: 'POST', body: JSON.stringify(body) });
      if (!r || !r.id) throw new Error((r && (r.error || r.message)) || 'Sanity did not return an id');
      notify('Created as a draft', 'moss'); onCreated(r.id);
    } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(false); }
  };
  return Panel(host, { title: seed ? `Duplicate as a new ${type}` : `New ${type}`, wide: true, action: h('span', { className: 'mpanel__meta' }, 'created as a draft; publish it from the document') },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      !schema ? h(ui.Skeleton, { count: 5, height: 16 }) : null,
      h(ui.Field, { label: 'Id', hint: 'leave blank for a generated one; set it for a singleton or a stable slug-like id' }, h(ui.Input, { value: id, placeholder: 'generated', onChange: (e) => setId(e.target.value) })),
      fields.length ? fields.map((f) => h(FieldEditor, { key: f.name, host, san, field: f, value: data[f.name], onChange: (v) => set(f.name, v), objects: schema ? schema.objects : {}, cdn: null, refs: {}, depth: 0, siblings: (n) => data[n] })) : schema ? h('p', { className: 'mlead', style: { margin: 0 } }, 'No field is known for this type; add the JSON below.') : null,
      !fields.length && schema ? h(ui.CodeEditor, { value: JSON.stringify(data, null, 2), language: 'json', height: 220, onChange: (val) => { try { setData(JSON.parse(val)); } catch (_) {} } }) : null,
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        missing.length ? h('span', { className: 'mpanel__meta', style: { color: 'var(--sy-brass)' } }, `${missing.length} required field${missing.length === 1 ? '' : 's'} empty: ${missing.map((f) => f.name).join(', ')}`) : null,
        h('span', { style: { flex: 1 } }),
        h(ui.Button, { onClick: onCancel }, 'Cancel'),
        h(ui.Button, { variant: 'primary', disabled: busy || !schema, onClick: create }, busy ? 'Creating...' : 'Create the draft'))));
}

const shapeOf = (f, objects, depth = 0) => {
  const t = f.type;
  if (t === 'string' || t === 'text' || t === 'url' || t === 'email') return f.options && f.options.list ? `one of ${f.options.list.map((o) => JSON.stringify(o.value)).join('|')}` : 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'slug') return '{ "_type": "slug", "current": "kebab-case" }';
  if (t === 'date') return '"YYYY-MM-DD"';
  if (t === 'datetime') return '"ISO 8601 datetime"';
  if (t === 'image' || t === 'file' || t === 'reference') return 'null (assets and references are set by hand)';
  if (t === 'array') {
    if ((f.of || []).some((o) => o.type === 'block')) return 'Portable Text: [{ "_type": "block", "_key": "k1", "style": "normal"|"h2"|"h3"|"blockquote", "markDefs": [], "children": [{ "_type": "span", "_key": "s1", "text": "...", "marks": [] }] }]';
    const inner = (f.of || []).filter((o) => o.type !== 'image' && o.type !== 'file' && o.type !== 'reference');
    if (inner.length === 1 && inner[0].type === 'string') return '[string]';
    if (inner.length && depth < 2) return `[ one of: ${inner.map((o) => `{ "_type": "${o.objectType || o.type}", "_key": "unique", ${(o.fields || []).map((sf) => `"${sf.name}": ${shapeOf(sf, objects, depth + 1)}`).join(', ')} }`).join(' | ')} ]`;
    if (f.anyObject) return '[objects with a "_type" from the repository]';
    return '[]';
  }
  if (t === 'object' && f.fields && depth < 2) return `{ ${f.fields.map((sf) => `"${sf.name}": ${shapeOf(sf, objects, depth + 1)}`).join(', ')} }`;
  return 'null';
};

export function Generate({ host, san, type, schema, onCreated, onCancel }) {
  const { h, ui, api, notify } = host;
  const { useState } = host.react;
  const fields = (schema ? schema.fields || [] : []).filter((f) => !f.hidden && !f.readOnly);
  const [brief, setBrief] = useState('');
  const [count, setCount] = useState(3);
  const [drafts, setDrafts] = useState(null);
  const [busy, setBusy] = useState(null);
  const generate = async () => {
    if (!brief.trim()) return;
    setBusy('ai'); setDrafts(null);
    try {
      const system = 'You write CMS content for a Sanity document type. Return ONLY a JSON array, no prose, no fences.';
      const prompt = `Write ${count} "${type}" documents from this brief: "${brief.trim()}".\n\nEach document is an object with exactly these fields:\n${fields.map((f) => `  "${f.name}": ${shapeOf(f, schema.objects)}${f.required ? '  (required)' : ''}${f.description ? `  // ${f.description}` : ''}`).join('\n')}\n\nRules: every array item needs a unique "_key"; Portable Text is structured blocks, never HTML; slugs are kebab-case and unique; leave images, files and references null. Concrete, specific, no placeholders, no lorem.`;
      const text = await askModel(api, { prompt, system, maxTokens: 3000, from: 'sanity-generate', timeout: 240000 });
      const m = text.match(/\[[\s\S]*\]/);
      const arr = JSON.parse(m ? m[0] : text);
      if (!Array.isArray(arr) || !arr.length) throw new Error('The AI did not return documents');
      setDrafts(arr.map((x) => ({ data: x, keep: true })));
    } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  const create = async () => {
    const keep = (drafts || []).filter((d) => d.keep);
    if (!keep.length) return;
    setBusy('create');
    let made = 0; let firstId = null;
    for (const d of keep) {
      try { const r = await san(`/documents/${encodeURIComponent(type)}?draft=1`, { method: 'POST', body: JSON.stringify({ ...d.data, _type: type }) }); if (r && r.id) { made++; if (!firstId) firstId = r.id; } }
      catch (e) { notify(e.message, 'rosin'); }
    }
    setBusy(null);
    notify(`Created ${made} draft${made === 1 ? '' : 's'}`, made ? 'moss' : 'rosin');
    if (made) onCreated(firstId);
  };
  const nameOf = (d) => d.title || d.name || d.heading || d.headline || (d.slug && d.slug.current) || 'untitled';
  return Panel(host, { title: `Generate ${type} documents with AI`, wide: true, action: h(ui.Button, { className: 'sy-btn--sm', onClick: onCancel }, 'Close') },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h('p', { className: 'mlead', style: { margin: 0 } }, 'Describe what you need; the AI writes the documents against the type\'s fields. You review them here, untick what you do not want, and they are created as drafts. Nothing is published.'),
      h(ui.Field, { label: 'Brief' }, h(ui.Textarea, { value: brief, rows: 4, placeholder: 'e.g. Three press releases about a product launch, a partnership and an award, in Korean, formal tone.', onChange: (e) => setBrief(e.target.value) })),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h(ui.Field, { label: 'How many' }, h(ui.Input, { type: 'number', value: count, min: 1, max: 20, style: { width: 90 }, onChange: (e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1))) })),
        h('span', { style: { flex: 1 } }),
        h(ui.Button, { variant: drafts ? undefined : 'primary', disabled: !!busy || !brief.trim() || !schema, onClick: generate }, busy === 'ai' ? 'Writing...' : drafts ? 'Write again' : 'Write them'),
        drafts ? h(ui.Button, { variant: 'primary', disabled: !!busy || !drafts.some((d) => d.keep), onClick: create }, busy === 'create' ? 'Creating...' : `Create ${drafts.filter((d) => d.keep).length} draft${drafts.filter((d) => d.keep).length === 1 ? '' : 's'}`) : null),
      drafts ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, drafts.map((d, i) => h('div', { key: i, style: { padding: 'var(--sy-s2)', border: '1px solid var(--sy-line)', borderRadius: 8, opacity: d.keep ? 1 : 0.5 } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 } }, h(ui.Chip, { on: d.keep, onClick: () => setDrafts(drafts.map((x, k) => (k === i ? { ...x, keep: !x.keep } : x))) }, d.keep ? 'create' : 'skip'), h('span', { style: { fontWeight: 600, fontSize: 'var(--sy-fs-sm)' } }, nameOf(d.data))),
        h(ui.CodeEditor, { value: JSON.stringify(d.data, null, 2), language: 'json', height: 200, onChange: (val) => { try { setDrafts(drafts.map((x, k) => (k === i ? { ...x, data: JSON.parse(val) } : x))); } catch (_) {} } })))) : null));
}

const TEXTY = new Set(['string', 'text', 'url', 'email']);

export function FindReplace({ host, san, type, schema, onDone, onCancel }) {
  const { h, ui, notify } = host;
  const { useState } = host.react;
  const fields = (schema ? schema.fields || [] : []).filter((f) => TEXTY.has(f.type) || (f.type === 'array' && (f.of || []).some((o) => o.type === 'block')));
  const [field, setField] = useState(fields[0] ? fields[0].name : '');
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [hits, setHits] = useState(null);
  const [busy, setBusy] = useState(null);
  const apply = (v) => (typeof v === 'string' ? v.split(find).join(repl) : Array.isArray(v) ? v.map((b) => (b && b._type === 'block' && Array.isArray(b.children) ? { ...b, children: b.children.map((c) => (typeof c.text === 'string' ? { ...c, text: c.text.split(find).join(repl) } : c)) } : b)) : v);
  const textOf = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? ptToText(v) : '');
  const preview = async () => {
    if (!field || !find) return;
    setBusy('preview');
    try { const all = await san(`/documents/${encodeURIComponent(type)}/export`, { method: 'POST', body: '{}' }); const list = (all || []).filter((d) => textOf(d[field]).includes(find)); setHits(list.map((d) => ({ id: d._id, title: d.title || d.name || d._id, draft: d._id.startsWith('drafts.'), before: textOf(d[field]), value: d[field] }))); }
    catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  const run = async () => {
    if (!hits || !hits.length) return;
    setBusy('apply');
    try { const r = await san(`/documents/${encodeURIComponent(type)}/bulk-update`, { method: 'POST', body: JSON.stringify({ patches: hits.map((x) => ({ id: x.id, set: { [field]: apply(x.value) } })) }) }); notify(`Updated ${r.total} document${r.total === 1 ? '' : 's'}`, 'moss'); onDone(); }
    catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  return Panel(host, { title: `Find and replace in ${type}`, wide: true, action: h(ui.Button, { className: 'sy-btn--sm', onClick: onCancel }, 'Close') },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h('p', { className: 'mlead', style: { margin: 0 } }, 'Exact text, one field, every document of the type, drafts and published alike. Preview shows what would change; nothing is written until you apply. Published documents stay published with the new text.'),
      h('div', { className: 'san-row2' },
        h(ui.Field, { label: 'Field' }, h(ui.Select, { value: field, onChange: (e) => { setField(e.target.value); setHits(null); } }, fields.map((f) => h('option', { key: f.name, value: f.name }, `${f.name} (${f.type === 'array' ? 'rich text' : f.type})`)))),
        h('div')),
      h('div', { className: 'san-row2' },
        h(ui.Field, { label: 'Find' }, h(ui.Input, { value: find, onChange: (e) => { setFind(e.target.value); setHits(null); } })),
        h(ui.Field, { label: 'Replace with' }, h(ui.Input, { value: repl, onChange: (e) => setRepl(e.target.value) }))),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h(ui.Button, { disabled: !field || !find || !!busy, onClick: preview }, busy === 'preview' ? 'Reading every document...' : 'Preview'),
        hits ? h('span', { className: 'mpanel__meta' }, `${hits.length} document${hits.length === 1 ? '' : 's'} contain it`) : null,
        h('span', { style: { flex: 1 } }),
        hits && hits.length ? h(ui.Button, { variant: 'primary', disabled: !!busy, onClick: run }, busy === 'apply' ? 'Applying...' : `Replace in ${hits.length}`) : null),
      hits && hits.length ? h('div', { style: { maxHeight: 360, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, hits.map((x) => ListRow(host, { key: x.id, lead: h('span', { className: 'mind-dot', style: { background: x.draft ? 'var(--sy-brass)' : 'var(--sy-moss)' } }), label: x.title, sub: x.before.slice(0, 200) })))) : null));
}

export function ExportType({ host, san, type, onCancel }) {
  const { h, ui, notify } = host;
  const { useState } = host.react;
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const fetchAll = async () => { setBusy(true); try { setData(await san(`/documents/${encodeURIComponent(type)}/export`, { method: 'POST', body: '{}' })); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(false); } };
  const text = data ? JSON.stringify(data, null, 2) : '';
  return Panel(host, { title: `Export ${type}`, wide: true, action: h(ui.Button, { className: 'sy-btn--sm', onClick: onCancel }, 'Close') },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h('p', { className: 'mlead', style: { margin: 0 } }, 'Every document of the type, published and draft, as JSON: a backup, or the input of Import-Documents from a shell.'),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h(ui.Button, { variant: 'primary', disabled: busy, onClick: fetchAll }, busy ? 'Reading...' : data ? 'Read again' : 'Read every document'),
        data ? h('span', { className: 'mpanel__meta' }, `${data.length} documents, ${Math.round(text.length / 1024)} KB`) : null,
        h('span', { style: { flex: 1 } }),
        data ? h(ui.Button, { onClick: () => navigator.clipboard.writeText(text).then(() => notify('Copied', 'moss')).catch(() => {}) }, 'Copy JSON') : null,
        data && host.writeNote ? h(ui.Button, { onClick: async () => { if (await host.writeNote(`${type} export ${new Date().toISOString().slice(0, 10)}`, '```json\n' + text + '\n```')) notify('Saved as a note', 'moss'); } }, 'Save as note') : null),
      data ? h(ui.CodeEditor, { value: text.length > 400000 ? text.slice(0, 400000) + '\n// truncated' : text, language: 'json', height: 460, readOnly: true }) : null));
}
