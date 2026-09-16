/**
 * GROQ: a query console on the dataset. The query in Monaco, the result as JSON, the
 * documents it returned openable, a history of what you ran, and a shelf of useful queries.
 */
import { Panel, Stat, Health, List, ListRow, FILL } from './kit.js';

const HISTORY_KEY = 'sy.san.groq.history';
const readHistory = () => { try { const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeHistory = (list) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 30))); } catch {} };
const when = (at) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const SHELF = [
  { label: 'Everything, newest first', q: '*[!(_type match "system.*") && !(_type match "sanity.*")] | order(_updatedAt desc) [0...20]{\n  _id, _type, _updatedAt, title\n}' },
  { label: 'Drafts', q: '*[_id in path("drafts.**")]{\n  _id, _type, _updatedAt, title\n}' },
  { label: 'Count by type', q: '{\n  "types": array::unique(*[defined(_type)]._type)\n}' },
  { label: 'Documents with a slug', q: '*[defined(slug.current)]{\n  _type, "slug": slug.current, title\n} | order(slug asc)' },
  { label: 'Images and where they are used', q: '*[_type == "sanity.imageAsset"][0...20]{\n  _id, originalFilename, altText,\n  "usedBy": count(*[references(^._id)])\n}' },
  { label: 'Documents referencing a given id', q: '*[references("REPLACE_WITH_ID")]{\n  _id, _type, title\n}' },
  { label: 'Full text search', q: '*[title match "press*" || pt::text(content) match "press*"]{\n  _id, _type, title\n}' },
];

export function Groq({ host, san, project, health, seed, onOpenDoc }) {
  const { h, ui, notify } = host;
  const { useState, useEffect } = host.react;
  const [query, setQuery] = useState(() => (seed && seed.query) || SHELF[0].q);
  const [params, setParams] = useState('{}');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(readHistory);
  useEffect(() => { if (seed && seed.query) { setQuery(seed.query); run(seed.query); } }, [seed && seed.at]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const run = async (q) => {
    const text = (q !== undefined ? q : query).trim();
    if (!text || busy) return;
    let p = {};
    try { p = params.trim() ? JSON.parse(params) : {}; } catch (e) { notify(`Params: ${e.message}`, 'rosin'); return; }
    setBusy(true); setResult(null);
    const started = Date.now();
    try {
      const r = await san('/groq', { method: 'POST', body: JSON.stringify({ query: text, params: p, meta: true }) });
      const entry = { query: text, at: new Date().toISOString(), ms: Date.now() - started, count: r.count };
      setResult({ ...r, took: Date.now() - started });
      const next = [entry, ...history.filter((e) => e.query !== text)]; writeHistory(next); setHistory(next);
    } catch (e) { setResult({ error: e.message, took: Date.now() - started }); } finally { setBusy(false); }
  };
  const docs = result && Array.isArray(result.result) ? result.result.filter((d) => d && typeof d === 'object' && d._id && d._type && !/^sanity\./.test(d._type)) : [];
  const text = result && !result.error ? JSON.stringify(result.result, null, 2) : '';
  const column = (...children) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0, minHeight: 0 } }, ...children);
  return h('div', { className: 'san-ask', style: { alignItems: 'start' } },
    column(
      Panel(host, { title: 'Query', action: h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, meta(project ? `${project}${health.data ? ` / ${health.data.dataset}` : ''}` : ''), h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: busy || !query.trim(), onClick: () => run() }, busy ? 'Running...' : 'Run (Ctrl+Enter)')) },
        h('div', { onKeyDown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } } }, h(ui.CodeEditor, { value: query, language: 'javascript', height: 170, onChange: setQuery })),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 } }, h('span', { className: 'mpanel__meta', style: { flex: 'none' } }, 'Params ($name)'), h(ui.Input, { value: params, onChange: (e) => setParams(e.target.value), placeholder: '{"type": "page"}', style: { flex: 1, fontFamily: 'var(--sy-mono, monospace)' } }))),
      Panel(host, { title: 'Result', action: h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, result && !result.error ? meta(`${result.count !== null && result.count !== undefined ? `${result.count} item${result.count === 1 ? '' : 's'} - ` : ''}${result.took} ms${result.ms !== undefined ? ` (${result.ms} ms in Sanity)` : ''}`) : meta(busy ? 'running...' : ''), text ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => navigator.clipboard.writeText(text).then(() => notify('Copied', 'moss')).catch(() => {}) }, 'Copy') : null) },
        busy ? h(ui.Skeleton, { count: 6, height: 16 }) : !result ? h('p', { className: 'mlead', style: { margin: 0 } }, 'Run a query. Results come back as JSON; documents in them open from the right pane.') : result.error ? h('p', { className: 'mlead', style: { margin: 0, color: 'var(--sy-rosin)' } }, result.error) : h(ui.CodeEditor, { value: text.length > 400000 ? text.slice(0, 400000) + '\n// truncated' : text, language: 'json', height: 'max(228px, calc(100vh - 640px))', readOnly: true }))),
    column(
      docs.length ? Panel(host, { title: 'Documents in the result', bodyStyle: { maxHeight: 'max(100px, calc(100vh - 660px))', overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' }, action: meta(`${docs.length}`) }, List(host, docs.slice(0, 100).map((d) => ListRow(host, { key: d._id, lead: h('span', { className: 'mind-dot', style: { background: d._id.startsWith('drafts.') ? 'var(--sy-brass)' : 'var(--sy-moss)', width: 7, height: 7 } }), label: d.title || d.name || d._id, sub: `${d._type} - ${d._id}`, onClick: () => onOpenDoc(d._type, d._id.replace(/^drafts\./, '')) })))) : null,
      Panel(host, { title: 'Useful queries', action: meta('click to load') }, List(host, SHELF.map((s) => ListRow(host, { key: s.label, label: s.label, onClick: () => setQuery(s.q) })))),
      Panel(host, { title: 'History', bodyStyle: { maxHeight: 'max(120px, calc(100vh - 700px))', overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' }, action: history.length ? h('button', { type: 'button', className: 'mpanel__meta', style: { background: 'none', border: 0, cursor: 'pointer', padding: 0 }, onClick: () => { writeHistory([]); setHistory([]); } }, 'forget all') : meta('kept in the app') },
        history.length ? List(host, history.map((e) => ListRow(host, { key: e.at, label: e.query.split('\n')[0].slice(0, 70), sub: `${when(e.at)} - ${e.ms} ms${e.count !== null && e.count !== undefined ? ` - ${e.count}` : ''}`, onClick: () => setQuery(e.query) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing run yet.'))));
}

export function GroqAside({ host, health }) {
  const { h } = host;
  const d = health.data;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'GROQ in short' }, h('div', { className: 'san-prose', style: { fontSize: 'var(--sy-fs-sm)' } },
      h('p', null, h('code', null, '*[_type == "page"]'), ' filters; ', h('code', null, '| order(_updatedAt desc)'), ' sorts; ', h('code', null, '[0...10]'), ' slices; ', h('code', null, '{title, "slug": slug.current}'), ' projects.'),
      h('p', null, h('code', null, 'author->name'), ' follows a reference; ', h('code', null, 'references($id)'), ' finds what points at it; ', h('code', null, 'match'), ' searches text; ', h('code', null, 'pt::text(body)'), ' flattens Portable Text.'),
      h('p', null, 'Drafts live under ', h('code', null, 'drafts.<id>'), '; ', h('code', null, '_id in path("drafts.**")'), ' selects them. Reads go through the API with the project token, so drafts are visible.'))),
    d ? Panel(host, { title: 'Types here' }, h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, (d.types || []).map((t) => h('code', { key: t.name, className: 'mpanel__meta' }, `${t.name} (${t.total})`)))) : null);
}
