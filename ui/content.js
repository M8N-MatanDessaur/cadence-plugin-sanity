/**
 * Content: the document types, and a type's documents with draft and published folded into
 * one row each (published, published with changes pending, unpublished).
 */
import { ago } from './helpers.js';
import { Panel, Stat, Health, List, ListRow, FILL } from './kit.js';
import { typeRow, docRow, statusColour, statusLabel } from './overview.js';

export function Types({ host, health, q, onOpen }) {
  const { h, ui } = host;
  const { data } = health;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const types = (data ? data.types || [] : []).filter((t) => !q || t.name.toLowerCase().includes(q) || (t.title || '').toLowerCase().includes(q));
  const content = types.filter((t) => !t.singleton);
  const singles = types.filter((t) => t.singleton);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Types', value: !data ? '...' : types.length, tone: 'brass' }),
      Stat(host, { label: 'Documents', value: !data ? '...' : types.reduce((n, t) => n + t.total, 0), tone: 'muted' }),
      Stat(host, { label: 'Unpublished', value: !data ? '...' : types.reduce((n, t) => n + t.drafts + t.changed, 0), tone: data && types.some((t) => t.drafts + t.changed) ? 'brass' : 'muted', hint: 'new drafts and pending changes' }),
      Stat(host, { label: 'In the code', value: !data ? '...' : types.filter((t) => t.inCode).length, tone: 'muted', hint: data && data.schema && data.schema.documents ? `${data.schema.documents} declared` : 'no schema found' })),
    content.length ? Panel(host, { title: 'Content types', wide: true, action: meta(`${content.length}`) }, List(host, content.sort((a, b) => b.total - a.total).map((t) => typeRow(host, t, onOpen)))) : null,
    singles.length ? Panel(host, { title: 'Singletons', wide: true, action: meta('one document each: settings, header, footer') }, List(host, singles.map((t) => typeRow(host, t, onOpen)))) : null,
    !data ? Panel(host, { title: 'Types', wide: true }, h(ui.Skeleton, { count: 6, height: 18 })) : !types.length ? Panel(host, { title: 'Types', wide: true }, empty('No type matches.')) : null);
}

export function Documents({ host, san, project, type, typeRow: t, q, onOpen }) {
  const { h, ui } = host;
  const { useState, useEffect } = host.react;
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [type, q, status]);
  useEffect(() => { setData(null); san(`/entries?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q || '')}&status=${status}&limit=50&offset=${page * 50}`).then(setData).catch((e) => setData({ error: e.message, entries: [] })); }, [type, q, status, page, project]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const list = data ? data.entries || [] : [];
  const matched = data ? data.matched || 0 : 0;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Documents', value: !data ? '...' : data.total, tone: 'brass' }),
      Stat(host, { label: 'Published', value: !data ? '...' : data.published, tone: 'moss' }),
      Stat(host, { label: 'Changes pending', value: !data ? '...' : data.changed, tone: data && data.changed ? 'brass' : 'muted', hint: 'published, edited since' }),
      Stat(host, { label: 'Unpublished', value: !data ? '...' : data.drafts, tone: data && data.drafts ? 'rosin' : 'muted', hint: 'never published' })),
    Panel(host, { title: 'Documents', wide: true, action: h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
      [['', 'All'], ['published', 'Published'], ['changed', 'Changes pending'], ['draft', 'Unpublished']].map(([k, l]) => h(ui.Chip, { key: k, on: status === k, onClick: () => setStatus(k) }, l)),
      data && matched > 50 ? h('span', { className: 'mpanel__meta', style: { marginLeft: 8 } }, `${page * 50 + 1}-${Math.min((page + 1) * 50, matched)} of ${matched}`) : null,
      data && page > 0 ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setPage(page - 1) }, 'Newer') : null,
      data && (page + 1) * 50 < matched ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setPage(page + 1) }, 'Older') : null) },
      !data ? h(ui.Skeleton, { count: 8, height: 18 }) : data.error ? empty(data.error) : list.length ? List(host, list.map((e) => ListRow(host, { key: e.id, lead: h('span', { className: 'mind-dot', style: { background: statusColour(e.status) } }), label: e.title || e.id, sub: `${statusLabel(e.status)}${e.slug ? ` - /${e.slug}` : ''}${e.title !== e.id ? ` - ${e.id}` : ''}`, meta: e.updatedAt ? ago(e.updatedAt) : '', onClick: () => onOpen(e.id) }))) : empty(q ? 'Nothing matches.' : status ? 'Nothing of that kind.' : 'No document of this type yet.')));
}

export function ContentAside({ host, health, openType, onOpenType, onOpenDoc }) {
  const { h, ui } = host;
  const { data } = health;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const types = data ? data.types || [] : [];
  const t = openType ? types.find((x) => x.name === openType) : null;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    t ? Panel(host, { title: 'This type', action: meta(t.inCode ? 'in the code' : 'inferred') }, h(ui.InfoGrid, { items: [{ label: 'Documents', value: t.total }, { label: 'Published', value: t.published }, { label: 'Changed', value: t.changed }, { label: 'Unpublished', value: t.drafts }, { label: 'Stale', value: t.stale || 0 }, { label: 'Fields', value: t.fieldCount || '-' }] })) : null,
    Panel(host, { title: 'Types', ...FILL, action: meta(data ? `${types.length}` : '...') },
      !data ? h(ui.Skeleton, { count: 6, height: 16 }) : List(host, types.slice().sort((a, b) => a.name.localeCompare(b.name)).map((x) => ListRow(host, { key: x.name, lead: h('span', { className: 'mind-dot', style: { background: x.name === openType ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: x.name, sub: `${x.singleton ? 'singleton' : x.inCode ? 'in the code' : 'inferred'} - ${x.total}`, onClick: () => onOpenType(x.name) })))),
    !openType && data && (data.recent || []).length ? Panel(host, { title: 'Changed last', ...FILL, action: meta(`${data.recent.length}`) }, List(host, data.recent.slice(0, 8).map((e) => docRow(host, e, onOpenDoc)))) : null);
}
