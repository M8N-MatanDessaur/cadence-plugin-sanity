/**
 * One Sanity field as a control, from its schema definition and its value.
 *
 * Strings, text, numbers, switches, lists of choices, dates, slugs, geopoints edit as
 * themselves. Images and files show the asset and pick another from the dataset. References
 * show the document they point to and pick another of the right type. Portable Text edits
 * like a document (bold, italic, headings, lists, links) as long as it holds only standard
 * blocks; anything richer shows as JSON so nothing is flattened. Arrays of objects are cards
 * you can open, reorder, remove and add to, each card drawn from the object's own schema.
 * Objects nest. Whatever has no schema falls back to Monaco with JSON.
 */
import { imageUrl, fileUrl, imageDims, newKey, ptToHtml, htmlToPt, ptToText, isPortableText, looksLikePortableText, bytes, titleOf } from './helpers.js';

export const emptyFor = (f) => {
  const t = f.type;
  if (t === 'boolean') return false;
  if (t === 'number') return null;
  if (t === 'array') return [];
  if (t === 'slug') return { _type: 'slug', current: '' };
  if (t === 'object' && f.fields) return Object.fromEntries(f.fields.filter((sf) => sf.initialValue !== undefined).map((sf) => [sf.name, sf.initialValue]));
  if (t === 'image' || t === 'file' || t === 'reference' || t === 'object' || t === 'geopoint') return null;
  return '';
};

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && v._type === 'slug' && !v.current);
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocalInput = (s) => (s ? new Date(s).toISOString() : '');

/** Fields guessed from a value, for objects the repository does not declare. */
export function inferFields(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  return Object.keys(v).filter((k) => !k.startsWith('_')).map((k) => {
    const x = v[k];
    const type = x === null || x === undefined ? 'string' : typeof x === 'string' ? (x.length > 140 ? 'text' : 'string') : typeof x === 'number' ? 'number' : typeof x === 'boolean' ? 'boolean' : Array.isArray(x) ? 'array' : x._type === 'slug' ? 'slug' : x.asset && x.asset._ref && /^image-/.test(x.asset._ref) ? 'image' : x.asset && x.asset._ref ? 'file' : x._ref ? 'reference' : x._type === 'geopoint' ? 'geopoint' : 'object';
    const f = { name: k, title: '', type, inferred: true };
    if (type === 'array' && x.length) f.of = [...new Set(x.map((i) => (i && typeof i === 'object' ? (i._type === 'block' ? 'block' : i._type || 'object') : typeof i)))].map((t) => ({ type: t }));
    return f;
  });
}

const itemTitle = (item) => (item && typeof item === 'object' ? (titleOf(item) !== item._id ? titleOf(item) : '') || item.text || item.label || item.caption || (item.asset && item.asset._ref ? item.asset._ref.split('-').slice(0, 2).join('-') : '') || (item._ref ? item._ref : '') || ptToText(item.content || item.body || []).slice(0, 60) : String(item ?? ''));

/** A small rich text editor over Portable Text: bold, italic, headings, quote, lists, links, and a JSON view. */
function RichText({ host, value, onChange }) {
  const { h, react, tokens, ui } = host;
  const { useRef, useEffect, useState } = react;
  const ref = useRef(null);
  const [json, setJson] = useState(false);
  const html = ptToHtml(value || []);
  const canRich = html !== null;
  useEffect(() => { if (!json && canRich && ref.current && ref.current.innerHTML !== html) ref.current.innerHTML = html; }, [html, json, canRich]);
  const emit = () => onChange(htmlToPt(ref.current ? ref.current.innerHTML : '', value));
  const cmd = (name, arg) => { ref.current && ref.current.focus(); document.execCommand(name, false, arg); emit(); };
  const tool = (label, fn, title) => h('button', { type: 'button', className: 'sy-btn sy-btn--sm', title, onMouseDown: (e) => e.preventDefault(), onClick: fn }, label);
  return h('div', { style: { border: `1px solid ${tokens('line')}`, borderRadius: 6, background: 'var(--sy-surface)' } },
    h('div', { style: { display: 'flex', gap: 4, padding: 4, borderBottom: `1px solid ${tokens('line')}`, flexWrap: 'wrap', alignItems: 'center' } },
      canRich && !json ? [tool('B', () => cmd('bold'), 'Bold'), tool('I', () => cmd('italic'), 'Italic'), tool('H2', () => cmd('formatBlock', 'h2'), 'Heading 2'), tool('H3', () => cmd('formatBlock', 'h3'), 'Heading 3'), tool('P', () => cmd('formatBlock', 'p'), 'Paragraph'), tool('Quote', () => cmd('formatBlock', 'blockquote'), 'Quote'), tool('List', () => cmd('insertUnorderedList'), 'Bulleted list'), tool('1.', () => cmd('insertOrderedList'), 'Numbered list'), tool('Link', () => { const u = window.prompt('Link to'); if (u) cmd('createLink', u); }, 'Link'), tool('Clear', () => cmd('removeFormat'), 'Remove formatting')].map((t, i) => h('span', { key: i }, t)) : h('span', { className: 'mpanel__meta' }, canRich ? 'JSON' : 'This text holds custom blocks; edit it as JSON so nothing is lost.'),
      h('span', { style: { flex: 1 } }),
      canRich ? tool(json ? 'Rich text' : 'JSON', () => setJson(!json), json ? 'Back to rich text' : 'Edit the Portable Text as JSON') : null),
    json || !canRich
      ? h(ui.CodeEditor, { value: JSON.stringify(value || [], null, 2), language: 'json', height: 260, onChange: (val) => { try { onChange(JSON.parse(val)); } catch (_) {} } })
      : h('div', { ref, contentEditable: true, suppressContentEditableWarning: true, className: 'san-prose', style: { minHeight: 110, maxHeight: 420, overflow: 'auto', padding: '8px 12px', outline: 'none', fontSize: 'var(--sy-fs-sm)', lineHeight: 1.5 }, onInput: emit, onBlur: emit }));
}

/** Pick an asset (image or file) from the dataset. */
function AssetPicker({ host, san, kind, onPick, onClose }) {
  const { h, ui, react, tokens } = host;
  const { useState, useEffect } = react;
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  useEffect(() => { setList(null); const t = setTimeout(() => san(`/assets?type=${kind}&q=${encodeURIComponent(q)}&limit=48`).then((d) => setList(d.assets || [])).catch(() => setList([])), 250); return () => clearTimeout(t); }, [q, kind]);
  return h(ui.Modal, { title: kind === 'image' ? 'Pick an image' : 'Pick a file', onClose, footer: h(ui.Button, { onClick: onClose }, 'Cancel') },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 520 } },
      h(ui.Input, { value: q, placeholder: 'Search by file name', onChange: (e) => setQ(e.target.value), autoFocus: true }),
      list === null ? h(ui.Skeleton, { count: 4, height: 18 }) : !list.length ? h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing matches.') : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, maxHeight: 400, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
        list.map((a) => h('button', { key: a._id, type: 'button', title: a.originalFilename, onClick: () => onPick(a), style: { textAlign: 'left', padding: 0, border: `1px solid ${tokens('line')}`, borderRadius: 8, background: 'var(--sy-surface)', cursor: 'pointer', overflow: 'hidden', color: 'inherit', font: 'inherit' } },
          h('div', { style: { height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'rgba(255,255,255,0.03)' } }, kind === 'image' ? h('img', { src: `${a.url}?w=240&fit=max&auto=format`, alt: '', loading: 'lazy', style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } }) : h('span', { className: 'mpanel__meta' }, a.extension || 'file')),
          h('div', { style: { padding: '4px 6px', fontSize: 'var(--sy-fs-xs)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, a.originalFilename || a._id))))));
}

/** Pick a document to reference, of one of the allowed types. */
function ReferencePicker({ host, san, types, onPick, onClose }) {
  const { h, ui, react } = host;
  const { useState, useEffect } = react;
  const [type, setType] = useState(types[0] || '');
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  useEffect(() => { setList(null); const t = setTimeout(() => san(`/entries?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}&limit=60`).then((d) => setList(d.entries || [])).catch(() => setList([])), 250); return () => clearTimeout(t); }, [q, type]);
  return h(ui.Modal, { title: 'Pick a document', onClose, footer: h(ui.Button, { onClick: onClose }, 'Cancel') },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 480 } },
      h('div', { style: { display: 'flex', gap: 8 } },
        types.length > 1 ? h(ui.Select, { value: type, onChange: (e) => setType(e.target.value), style: { width: 180 } }, types.map((t) => h('option', { key: t, value: t }, t))) : null,
        h(ui.Input, { value: q, placeholder: `Search ${type} documents`, onChange: (e) => setQ(e.target.value), autoFocus: true, style: { flex: 1 } })),
      list === null ? h(ui.Skeleton, { count: 4, height: 18 }) : !list.length ? h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing matches.') : h('ul', { className: 'mlist', role: 'list', style: { maxHeight: 380, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
        list.map((e) => h('li', { key: e.id }, h('button', { type: 'button', className: 'mlist__row mlist__row--tall', onClick: () => onPick(e) }, h('span', { className: 'mind-dot', style: { background: e.status === 'published' ? 'var(--sy-moss)' : 'var(--sy-brass)' } }), h('span', { className: 'mlist__main' }, h('span', { className: 'mlist__label' }, e.title || e.id), h('span', { className: 'mlist__sub' }, `${e.type} - ${e.id}${e.slug ? ` - /${e.slug}` : ''}`))))))));
}

/** Pick which kind of item to add to an array. */
function TypeMenu({ host, choices, onPick, onClose }) {
  const { h, ui } = host;
  return h(ui.Modal, { title: 'Add which kind?', onClose, footer: h(ui.Button, { onClick: onClose }, 'Cancel') },
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 560 } }, choices.map((c) => h(ui.Button, { key: c.type, className: 'sy-btn--sm', onClick: () => onPick(c) }, c.title && c.title !== c.type ? `${c.title} (${c.type})` : c.type))));
}

export function FieldEditor({ host, san, field: f, value: v, onChange, objects, cdn, refs, depth = 0, siblings, onAi, aiBusy }) {
  const { h, ui, tokens, react } = host;
  const { useState } = react;
  const [picker, setPicker] = useState(null);
  const [openItems, setOpenItems] = useState(() => new Set());
  const [tall, setTall] = useState(false);
  const type = f.type || 'string';
  const label = h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' } },
    h('span', { style: { fontWeight: 600, fontSize: 'var(--sy-fs-sm)' } }, f.title || f.name),
    h('span', { className: 'mpanel__meta' }, `${f.title ? `${f.name} - ` : ''}${type}${f.objectType ? `:${f.objectType}` : ''}${f.required ? ' - required' : ''}${f.inferred ? ' - inferred' : ''}`),
    f.required && isEmpty(v) ? h('span', { className: 'mpanel__meta', style: { color: 'var(--sy-rosin)' } }, 'empty') : null,
    f.changed ? h('span', { className: 'mpanel__meta', style: { color: 'var(--sy-brass)' } }, 'changed') : null,
    h('span', { style: { flex: 1 } }),
    onAi && (type === 'string' || type === 'text' || (type === 'array' && looksLikePortableText(v))) && !(f.options && f.options.list) ? h('button', { type: 'button', className: 'mpanel__meta', style: { background: 'none', border: 0, cursor: 'pointer', padding: 0 }, disabled: !!aiBusy || isEmpty(v), title: isEmpty(v) ? 'Type something first' : 'The AI writes this field out from what is typed', onClick: () => onAi(f, v) }, aiBusy === f.name ? 'writing...' : 'write with AI') : null);

  let control;
  const setV = onChange;
  if (f.options && f.options.list && (type === 'string' || type === 'number')) {
    control = h(ui.Select, { value: v === undefined || v === null ? '' : String(v), onChange: (e) => setV(type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value) }, h('option', { value: '' }, '(none)'), f.options.list.map((o) => h('option', { key: String(o.value), value: String(o.value) }, o.title || String(o.value))));
  } else if (type === 'boolean') {
    control = h(ui.Chip, { on: !!v, onClick: () => setV(!v) }, v ? 'true' : 'false');
  } else if (type === 'number') {
    control = h(ui.Input, { type: 'number', value: v === undefined || v === null ? '' : v, onChange: (e) => setV(e.target.value === '' ? null : Number(e.target.value)) });
  } else if (type === 'text' || (type === 'string' && typeof v === 'string' && v.length > 140)) {
    control = h(ui.Textarea, { value: v === undefined || v === null ? '' : String(v), rows: f.rows || Math.min(12, Math.max(3, Math.ceil(String(v || '').length / 90))), onChange: (e) => setV(e.target.value) });
  } else if (type === 'date') {
    control = h(ui.Input, { type: 'date', value: v || '', onChange: (e) => setV(e.target.value || null), style: { width: 200 } });
  } else if (type === 'datetime') {
    control = h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, h(ui.Input, { type: 'datetime-local', value: toLocalInput(v), onChange: (e) => setV(e.target.value ? fromLocalInput(e.target.value) : null), style: { width: 230 } }), h(ui.Button, { className: 'sy-btn--sm', onClick: () => setV(new Date().toISOString()) }, 'Now'), v ? h('span', { className: 'mpanel__meta' }, v) : null);
  } else if (type === 'slug') {
    const cur = v && typeof v === 'object' ? v.current || '' : typeof v === 'string' ? v : '';
    const source = siblings ? siblings(f.options && f.options.source ? f.options.source : 'title') : '';
    control = h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, h('span', { className: 'mpanel__meta' }, '/'), h(ui.Input, { value: cur, placeholder: 'kebab-case', onChange: (e) => setV({ _type: 'slug', current: e.target.value }), style: { flex: 1 } }), source ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setV({ _type: 'slug', current: slugify(source) }) }, 'From the title') : null);
  } else if (type === 'geopoint') {
    const g = v && typeof v === 'object' ? v : {};
    control = h('div', { style: { display: 'flex', gap: 8 } }, h(ui.Input, { type: 'number', step: 'any', placeholder: 'lat', value: g.lat ?? '', onChange: (e) => setV({ _type: 'geopoint', ...g, lat: Number(e.target.value) }), style: { width: 140 } }), h(ui.Input, { type: 'number', step: 'any', placeholder: 'lng', value: g.lng ?? '', onChange: (e) => setV({ _type: 'geopoint', ...g, lng: Number(e.target.value) }), style: { width: 140 } }));
  } else if (type === 'image' || type === 'file') {
    const ref = v && v.asset ? v.asset._ref : null;
    const isImg = type === 'image' || /^image-/.test(ref || '');
    const url = ref ? (isImg ? imageUrl(cdn, ref, 480) : fileUrl(cdn, ref)) : '';
    const dims = imageDims(ref);
    const resolved = refs && ref ? refs[ref] : null;
    const subFields = (f.fields || []).filter((sf) => sf.name !== 'asset');
    control = h('div', null,
      h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-start' } },
        ref ? (isImg && url ? h('img', { src: url, alt: '', style: { maxWidth: 220, maxHeight: 140, borderRadius: 6, display: 'block', background: 'rgba(255,255,255,0.03)' } }) : h('code', { className: 'mpanel__meta', style: { wordBreak: 'break-all' } }, ref)) : h('span', { className: 'mlead', style: { margin: 0 } }, `No ${type} set.`),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 } },
          ref ? h('span', { className: 'mpanel__meta', style: { wordBreak: 'break-all' } }, `${resolved && resolved.title ? `${resolved.title} - ` : ''}${dims ? `${dims.width}x${dims.height} - ` : ''}${ref}`) : null,
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(ui.Button, { className: 'sy-btn--sm', onClick: () => setPicker({ kind: isImg ? 'image' : 'file' }) }, ref ? 'Change' : `Pick ${isImg ? 'an image' : 'a file'}`),
            url ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => window.open(url, '_blank') }, 'Open') : null,
            ref ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setV(null) }, 'Remove') : null))),
      subFields.length && ref ? h('div', { style: { marginTop: 6, paddingLeft: 12, borderLeft: `2px solid ${tokens('line')}` } }, subFields.map((sf) => h(FieldEditor, { key: sf.name, host, san, field: sf, value: v ? v[sf.name] : undefined, onChange: (val) => setV({ ...(v || {}), [sf.name]: val }), objects, cdn, refs, depth: depth + 1 }))) : null,
      picker ? h(AssetPicker, { host, san, kind: picker.kind, onClose: () => setPicker(null), onPick: (a) => { setV({ ...(v || {}), _type: type, asset: { _type: 'reference', _ref: a._id } }); setPicker(null); } }) : null);
  } else if (type === 'reference') {
    const ref = v && v._ref;
    const resolved = refs && ref ? refs[ref] : null;
    const to = (f.to && f.to.length) ? f.to : resolved && resolved._type ? [resolved._type] : [];
    control = h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
      ref ? h('span', { style: { fontSize: 'var(--sy-fs-sm)' } }, resolved ? `${resolved.title} ` : '', h('code', { className: 'mpanel__meta' }, `${resolved ? `${resolved._type} - ` : ''}${ref}`), !resolved && refs ? h('span', { className: 'mpanel__meta', style: { color: 'var(--sy-rosin)', marginLeft: 6 } }, 'not found') : null) : h('span', { className: 'mlead', style: { margin: 0 } }, 'No reference set.'),
      h(ui.Button, { className: 'sy-btn--sm', disabled: !to.length, title: to.length ? `Documents of type ${to.join(', ')}` : 'The schema does not say which type this points to', onClick: () => setPicker({ types: to }) }, ref ? 'Change' : 'Pick a document'),
      ref ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setV(null) }, 'Remove') : null,
      picker ? h(ReferencePicker, { host, san, types: picker.types, onClose: () => setPicker(null), onPick: (e) => { setV({ _type: 'reference', _ref: e.id, ...(v && v._weak ? { _weak: true } : {}) }); setPicker(null); } }) : null);
  } else if (type === 'array') {
    const arr = Array.isArray(v) ? v : [];
    const of = f.of || [];
    const isPt = of.some((o) => o.type === 'block') || (!of.length && looksLikePortableText(arr));
    if (isPt && (!arr.length || isPortableText(arr) || looksLikePortableText(arr))) {
      control = h(RichText, { host, value: arr, onChange: setV });
    } else if (of.length && of.every((o) => o.type === 'string' || o.type === 'number' || o.type === 'url') && (!arr.length || arr.every((x) => typeof x !== 'object'))) {
      const isNum = of[0].type === 'number';
      // The pending chip text lives in `picker`, which this branch has no other use for.
      const pending = picker && picker.text !== undefined ? picker.text : '';
      const add = () => { const t = pending.trim(); if (!t) return; setV([...arr, isNum ? Number(t) : t]); setPicker({ text: '' }); };
      control = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
        arr.map((x, i) => h(ui.Chip, { key: i, on: true, onClick: () => setV(arr.filter((_, k) => k !== i)), title: 'Remove' }, `${x} x`)),
        h(ui.Input, { value: pending, placeholder: of[0].options && of[0].options.list ? 'pick or type' : 'add one and press Enter', onChange: (e) => setPicker({ text: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }, style: { width: 200 } }),
        of[0].options && of[0].options.list ? h(ui.Select, { value: '', onChange: (e) => { if (e.target.value) setV([...arr, isNum ? Number(e.target.value) : e.target.value]); }, style: { width: 160 } }, h('option', { value: '' }, 'choices...'), of[0].options.list.filter((o) => !arr.includes(o.value)).map((o) => h('option', { key: String(o.value), value: String(o.value) }, o.title || String(o.value)))) : null);
    } else {
      // Cards: one per item, drawn from the matching member schema, the object registry, or the value itself.
      const memberFor = (item) => {
        const t = item && typeof item === 'object' ? item._type : null;
        const m = of.find((o) => (o.objectType || o.type) === t || o.name === t) || (t && objects && objects[t] ? { ...objects[t], type: objects[t].type === 'object' || objects[t].fields ? 'object' : objects[t].type, objectType: t } : null);
        if (m) return m;
        if (item && item.asset && item.asset._ref) return { type: /^image-/.test(item.asset._ref) ? 'image' : 'file', fields: of.find((o) => o.type === 'image' || o.type === 'file') ? of.find((o) => o.type === 'image' || o.type === 'file').fields : [] };
        if (item && item._ref) return { type: 'reference', to: (of.find((o) => o.type === 'reference') || {}).to || [] };
        if (item && typeof item === 'object') return { type: 'object', fields: inferFields(item), inferred: true };
        return { type: typeof item === 'number' ? 'number' : 'string' };
      };
      const choices = [...of.filter((o) => o.type !== '?').map((o) => ({ type: o.objectType || o.type, title: o.title, member: o })), ...(f.anyObject && objects ? Object.values(objects).filter((o) => o.type === 'object' && !of.some((m) => (m.objectType || m.type) === o.name)).map((o) => ({ type: o.name, title: o.title, member: { ...o, type: 'object', objectType: o.name } })) : [])];
      const addItem = (c) => {
        const m = c.member;
        let item;
        if (m.type === 'image' || m.type === 'file') { setPicker({ kind: m.type, forArray: true }); return; }
        if (m.type === 'reference') { setPicker({ types: m.to || [], forArray: true }); return; }
        if (m.type === 'object' || (m.fields && m.fields.length)) item = { _type: c.type, _key: newKey(), ...Object.fromEntries((m.fields || []).map((sf) => [sf.name, sf.initialValue !== undefined ? sf.initialValue : emptyFor(sf)]).filter(([, val]) => val !== null && val !== '')) };
        else if (m.type === 'string' || m.type === 'text') item = '';
        else if (m.type === 'number') item = 0;
        else item = { _type: c.type, _key: newKey() };
        setV([...arr, item]);
        setOpenItems(new Set([...openItems, arr.length]));
      };
      const move = (i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; const next = arr.slice(); [next[i], next[j]] = [next[j], next[i]]; setV(next); };
      const key = (item, i) => (item && typeof item === 'object' && item._key) || `i${i}`;
      control = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        arr.map((item, i) => {
          const m = memberFor(item);
          const open = openItems.has(i);
          const title = itemTitle(item);
          const t = item && typeof item === 'object' ? item._type || m.type : m.type;
          return h('div', { key: key(item, i), style: { border: `1px solid ${tokens('line')}`, borderRadius: 8, background: 'var(--sy-surface)' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' } },
              h('button', { type: 'button', className: 'sy-btn sy-btn--sm', style: { width: 28, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }, title: open ? 'Fold' : 'Open', onClick: () => { const n = new Set(openItems); if (open) n.delete(i); else n.add(i); setOpenItems(n); } }, h(host.icons[open ? 'down' : 'right'], { size: 13 })),
              h('span', { className: 'mpanel__meta', style: { flex: 'none' } }, `${i + 1}. ${t}`),
              h('span', { style: { flex: 1, minWidth: 0, fontSize: 'var(--sy-fs-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, title),
              h('span', { style: { display: 'flex', gap: 4, flex: 'none' } },
                h('button', { type: 'button', className: 'sy-btn sy-btn--sm', style: { height: 26 }, title: 'Move up', disabled: i === 0, onClick: () => move(i, -1) }, 'Up'),
                h('button', { type: 'button', className: 'sy-btn sy-btn--sm', style: { height: 26 }, title: 'Move down', disabled: i === arr.length - 1, onClick: () => move(i, 1) }, 'Down'),
                h('button', { type: 'button', className: 'sy-btn sy-btn--sm', style: { height: 26, display: 'inline-flex', alignItems: 'center', gap: 4 }, title: 'Remove this item', onClick: () => setV(arr.filter((_, k) => k !== i)) }, h(host.icons.close, { size: 12 }), 'Remove'))),
            open ? h('div', { style: { padding: '0 10px 8px', borderTop: `1px solid ${tokens('line')}` } },
              m.type === 'object' || (m.fields && m.fields.length)
                ? ((m.fields && m.fields.length ? m.fields : inferFields(item)).map((sf) => h(FieldEditor, { key: sf.name, host, san, field: sf, value: item ? item[sf.name] : undefined, onChange: (val) => setV(arr.map((x, k) => (k === i ? { ...(x || {}), [sf.name]: val } : x))), objects, cdn, refs, depth: depth + 1, siblings: (n) => (item ? item[n] : undefined) })))
                : h(FieldEditor, { host, san, field: { ...m, name: `item ${i + 1}`, title: '' }, value: item, onChange: (val) => setV(arr.map((x, k) => (k === i ? (val && typeof val === 'object' && !Array.isArray(val) ? { _key: key(item, i), ...val } : val) : x))), objects, cdn, refs, depth: depth + 1 })) : null);
        }),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
          choices.length === 1 ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => addItem(choices[0]) }, `Add ${choices[0].title || choices[0].type}`) : choices.length ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setPicker({ menu: true }) }, 'Add...') : h(ui.Button, { className: 'sy-btn--sm', onClick: () => { setV([...arr, { _type: 'object', _key: newKey() }]); setOpenItems(new Set([...openItems, arr.length])); } }, 'Add an item'),
          arr.length ? h('span', { className: 'mpanel__meta' }, `${arr.length} item${arr.length === 1 ? '' : 's'}`) : h('span', { className: 'mpanel__meta' }, 'empty')),
        picker && picker.menu ? h(TypeMenu, { host, choices, onClose: () => setPicker(null), onPick: (c) => { setPicker(null); addItem(c); } }) : null,
        picker && picker.kind && picker.forArray ? h(AssetPicker, { host, san, kind: picker.kind, onClose: () => setPicker(null), onPick: (a) => { setV([...arr, { _type: picker.kind, _key: newKey(), asset: { _type: 'reference', _ref: a._id } }]); setPicker(null); } }) : null,
        picker && picker.types && picker.forArray ? h(ReferencePicker, { host, san, types: picker.types, onClose: () => setPicker(null), onPick: (e) => { setV([...arr, { _type: 'reference', _key: newKey(), _ref: e.id }]); setPicker(null); } }) : null);
    }
  } else if (type === 'object' && depth < 5) {
    const fields = (f.fields && f.fields.length) ? f.fields : inferFields(v);
    const obj = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    control = fields.length
      ? h('div', { style: { paddingLeft: 12, borderLeft: `2px solid ${tokens('line')}` } }, fields.map((sf) => h(FieldEditor, { key: sf.name, host, san, field: sf, value: obj[sf.name], onChange: (val) => setV({ ...obj, ...(f.objectType && !obj._type ? { _type: f.objectType } : {}), [sf.name]: val }), objects, cdn, refs, depth: depth + 1, siblings: (n) => obj[n] })))
      : h('span', { className: 'mlead', style: { margin: 0 } }, 'Empty object.');
  } else if (type === 'string' || type === 'url' || type === 'email' || typeof v === 'string' || v === undefined || v === null) {
    control = h(ui.Input, { value: v === undefined || v === null ? '' : String(v), placeholder: f.description ? '' : '', onChange: (e) => setV(e.target.value) });
  } else {
    const text = JSON.stringify(v, null, 2) || '';
    control = h('div', null,
      h(ui.CodeEditor, { value: text, language: 'json', height: tall ? 460 : Math.min(200, 40 + text.split('\n').length * 18), onChange: (val) => { try { setV(JSON.parse(val)); } catch (_) {} } }),
      text.split('\n').length > 9 ? h('button', { type: 'button', className: 'mpanel__meta', style: { background: 'none', border: 0, cursor: 'pointer', padding: '6px 0 0' }, onClick: () => setTall(!tall) }, tall ? 'smaller' : 'taller') : null);
  }
  return h('div', { style: { padding: depth ? '6px 0' : 'var(--sy-s2) 0', borderTop: depth ? 0 : `1px solid ${tokens('line')}` } }, label, f.description ? h('p', { className: 'mlead', style: { margin: '0 0 6px' } }, f.description) : null, control);
}
