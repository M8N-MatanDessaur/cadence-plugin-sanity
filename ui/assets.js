/**
 * Assets: the images and files of the dataset as a grid, one selected on the right with where it
 * is used, its own alt text and title (editable on the asset itself), and Delete for the unused.
 */
import { ago, bytes } from './helpers.js';
import { Panel, Stat, Health, List, ListRow, FILL } from './kit.js';
import { statusColour, statusLabel } from './overview.js';

export function Assets({ host, san, project, health, q, selected, onSelect }) {
  const { h, ui, tokens } = host;
  const { useState, useEffect } = host.react;
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('all');
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [q, project, kind]);
  useEffect(() => { setData(null); san(`/assets?type=${kind}&q=${encodeURIComponent(q || '')}&limit=48&offset=${offset}`).then(setData).catch((e) => setData({ error: e.message, assets: [] })); }, [q, offset, project, kind, selected && selected._bump]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const list = data ? data.assets || [] : [];
  const isImg = (a) => a._type === 'sanity.imageAsset';
  const thumb = (a) => (isImg(a) ? `${a.url}?w=320&h=200&fit=max&auto=format` : '');
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Matching', value: !data ? '...' : data.total, tone: 'brass', hint: q ? 'searching the whole dataset' : 'newest first' }),
      Stat(host, { label: 'Images', value: !health.data ? '...' : health.data.assets.images || 0, tone: 'muted' }),
      Stat(host, { label: 'Files', value: !health.data ? '...' : health.data.assets.files || 0, tone: 'muted' }),
      Stat(host, { label: 'Without alt text', value: !data ? '...' : list.filter((a) => isImg(a) && !a.altText).length, tone: data && list.some((a) => isImg(a) && !a.altText) ? 'brass' : 'muted', hint: 'on this page; alt lives on the asset, and on each use' })),
    Panel(host, { title: 'Assets', wide: true, action: h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
      [['all', 'All'], ['image', 'Images'], ['file', 'Files']].map(([k, l]) => h(ui.Chip, { key: k, on: kind === k, onClick: () => setKind(k) }, l)),
      offset > 0 ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setOffset(Math.max(0, offset - 48)) }, 'Newer') : null,
      data && offset + 48 < data.total ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setOffset(offset + 48) }, 'Older') : null,
      meta(data ? `${data.total ? offset + 1 : 0}-${offset + list.length} of ${data.total}` : '')) },
      !data ? h(ui.Skeleton, { count: 6, height: 18 }) : data.error ? empty(data.error) : list.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 } },
        list.map((a) => h('button', { key: a._id, type: 'button', onClick: () => onSelect(a), title: a.originalFilename || a._id, style: { textAlign: 'left', padding: 0, border: `1px solid ${selected && selected._id === a._id ? 'var(--sy-brass)' : tokens('line')}`, borderRadius: 8, background: 'var(--sy-surface)', cursor: 'pointer', overflow: 'hidden', color: 'inherit', font: 'inherit' } },
          h('div', { style: { height: 96, background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } }, isImg(a) ? h('img', { src: thumb(a), alt: '', loading: 'lazy', style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } }) : h('span', { className: 'mpanel__meta' }, a.extension || (a.mimeType || 'file').split('/').pop())),
          h('div', { style: { padding: '6px 8px' } }, h('div', { style: { fontSize: 'var(--sy-fs-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, a.originalFilename || a._id), h('div', { className: 'mpanel__meta' }, `${a.metadata && a.metadata.dimensions ? `${a.metadata.dimensions.width}x${a.metadata.dimensions.height} - ` : ''}${bytes(a.size)}${isImg(a) && !a.altText ? ' - no alt' : ''}`)))))
        : empty(q ? 'No asset matches.' : 'No asset in this dataset.')));
}

export function AssetsAside({ host, san, project, health, selected, onOpenDoc, onChanged, onCleared }) {
  const { h, ui, notify } = host;
  const { useState, useEffect } = host.react;
  const [usages, setUsages] = useState(null);
  const [alt, setAlt] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setUsages(null); setConfirm(false); setAlt(selected ? selected.altText || '' : ''); setTitle(selected ? selected.title || '' : ''); if (selected) san(`/assets/${encodeURIComponent(selected._id)}/usage`).then((d) => setUsages(Array.isArray(d) ? d : [])).catch(() => setUsages([])); }, [selected && selected._id, project]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  if (!selected) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } }, Panel(host, { title: 'This asset' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'Pick an asset to see where it is used, set the alt text and title Sanity keeps on the asset itself, or delete it when nothing uses it.')));
  const isImg = selected._type === 'sanity.imageAsset';
  const save = async () => { setBusy('save'); try { await san(`/assets/${encodeURIComponent(selected._id)}`, { method: 'PATCH', body: JSON.stringify({ altText: alt, title }) }); notify('Asset updated', 'moss'); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };
  const remove = async () => { setBusy('delete'); try { await san(`/assets/${encodeURIComponent(selected._id)}`, { method: 'DELETE' }); notify('Asset deleted', 'moss'); onCleared(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); setConfirm(false); } };
  const dims = selected.metadata && selected.metadata.dimensions;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'This asset', action: h('a', { className: 'mpanel__meta', href: selected.url, target: '_blank', rel: 'noreferrer' }, 'open') },
      isImg ? h('img', { src: `${selected.url}?w=600&fit=max&auto=format`, alt: '', style: { width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 6, background: 'rgba(255,255,255,0.03)', marginBottom: 'var(--sy-s2)' } }) : null,
      h(ui.InfoGrid, { items: [{ label: 'File', value: selected.originalFilename || selected._id }, { label: 'Type', value: selected.mimeType || '-' }, { label: 'Size', value: `${dims ? `${dims.width}x${dims.height}, ` : ''}${bytes(selected.size) || '-'}` }, { label: 'Uploaded', value: selected._createdAt ? ago(selected._createdAt) : '-' }, { label: 'Id', value: selected._id }] })),
    isImg ? Panel(host, { title: 'On the asset', action: meta('alt text and title Sanity keeps with the file') },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h(ui.Field, { label: 'Alt text' }, h(ui.Input, { value: alt, placeholder: 'What the image shows', onChange: (e) => setAlt(e.target.value) })),
        h(ui.Field, { label: 'Title' }, h(ui.Input, { value: title, onChange: (e) => setTitle(e.target.value) })),
        h('div', null, h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: busy === 'save' || (alt === (selected.altText || '') && title === (selected.title || '')), onClick: save }, busy === 'save' ? 'Saving...' : 'Save')))) : null,
    Panel(host, { title: 'Used in', ...FILL, action: meta(usages === null ? 'searching...' : `${usages.length}`) },
      usages === null ? h(ui.Skeleton, { count: 3, height: 16 }) : usages.length ? List(host, usages.map((u) => ListRow(host, { key: u.id, lead: h('span', { className: 'mind-dot', style: { background: statusColour(u.status) } }), label: u.title || u.id, sub: `${u.type} - ${statusLabel(u.status)}`, onClick: () => onOpenDoc(u.type, u.id) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No document uses it.')),
    usages && !usages.length ? Panel(host, { title: 'Unused', action: meta('safe to delete') }, h('div', { style: { display: 'flex', gap: 6 } }, confirm ? [h(ui.Button, { key: 'y', disabled: !!busy, onClick: remove, style: { color: 'var(--sy-rosin)' } }, busy === 'delete' ? 'Deleting...' : 'Yes, delete it'), h(ui.Button, { key: 'n', className: 'sy-btn--sm', onClick: () => setConfirm(false) }, 'Keep it')] : h(ui.Button, { onClick: () => setConfirm(true) }, 'Delete the asset'))) : null);
}
