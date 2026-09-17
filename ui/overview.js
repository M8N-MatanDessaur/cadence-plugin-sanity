/**
 * The dataset as a bento: what it holds, what needs attention, what changed last, and whether
 * the site answers.
 */
import { ago } from './helpers.js';
import { Panel, Stat, Health, Bars, List, ListRow, FILL } from './kit.js';

export function useHealth(host, san, project, enabled) {
  const { react } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback((fresh) => {
    if (!project || !enabled) return;
    setError(null);
    san(`/health${fresh ? '?refresh=1' : ''}`).then(setData).catch((e) => { setData(null); setError(e.message); });
  }, [san, project, enabled]);
  useEffect(() => { setData(null); reload(); }, [project, enabled]);
  return { data, error, reload };
}

export const statusColour = (s) => (s === 'published' ? 'var(--sy-moss)' : s === 'changed' ? 'var(--sy-brass)' : s === 'draft' ? 'var(--sy-rosin)' : 'var(--sy-text-3)');
export const statusLabel = (s) => (s === 'published' ? 'published' : s === 'changed' ? 'published, changes pending' : s === 'draft' ? 'unpublished' : s || '');
export const typeRow = (host, t, onOpen) => ListRow(host, { key: t.name, lead: host.h('span', { className: 'mind-dot', style: { background: t.singleton ? 'var(--sy-text-3)' : t.inCode ? 'var(--sy-brass)' : 'var(--sy-rosin)' } }), label: t.title && t.title !== t.name ? `${t.title} (${t.name})` : t.name, sub: `${t.singleton ? 'singleton' : t.inCode ? `${t.fieldCount} field${t.fieldCount === 1 ? '' : 's'}` : 'no schema in the repository'} - ${t.published} published${t.drafts ? `, ${t.drafts} unpublished` : ''}${t.changed ? `, ${t.changed} changed` : ''}${t.stale ? ` - ${t.stale} stale` : ''}`, meta: `${t.total}`, onClick: () => onOpen(t.name) });
export const docRow = (host, e, onOpen, extra) => ListRow(host, { key: `${e.type}-${e.id}`, lead: host.h('span', { className: 'mind-dot', style: { background: statusColour(e.status) } }), label: e.title || e.id, sub: `${e.type}${e.slug ? ` - /${e.slug}` : ''} - ${statusLabel(e.status)}${extra ? ` - ${extra}` : ''}`, meta: e.updatedAt ? ago(e.updatedAt) : '', onClick: () => onOpen(e.type, e.id) });

export function Overview({ host, health, insights, q, onOpenDoc, onOpenType, onAction }) {
  const { h, ui, api } = host;
  const { useState, useEffect } = host.react;
  const { data, error } = health;
  const [preview, setPreview] = useState(null);
  useEffect(() => { setPreview(null); if (data && data.previewUrl) api(`/api/plugins/sanity/preview-check?url=${encodeURIComponent(data.previewUrl)}`).then(setPreview).catch(() => setPreview({ ok: false })); }, [data && data.previewUrl]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (error) return h(ui.EmptyState, { title: 'Sanity did not answer', body: error });
  const loading = !data;
  const types = (data ? data.types || [] : []).filter((t) => !q || t.name.toLowerCase().includes(q) || (t.title || '').toLowerCase().includes(q));
  const issues = data ? data.issues || [] : [];
  const c = insights.data ? insights.data.counts : null;
  const toLook = c ? c.changed + c.stale + c.missingTitle + c.missingSlug + c.duplicateSlug + c.missingAlt + c.brokenRef + c.missingRequired + (c.invalidItem || 0) : 0;
  // The documents that are actually broken (not merely unpublished or old), worst first, so the home page says where the problems are.
  const SERIOUS = ['invalid-item', 'broken-ref', 'duplicate-slug', 'missing-slug', 'missing-title'];
  const serious = (e) => e.issues.filter((i) => SERIOUS.includes(i) || i.startsWith('missing-required:'));
  const broken = insights.data ? (insights.data.entries || []).filter((e) => serious(e).length).sort((a, b) => serious(b).length - serious(a).length) : [];
  const describe = (e) => serious(e).map((i) => i === 'invalid-item' ? `${e.invalidItems ? e.invalidItems.length : ''} list item${e.invalidItems && e.invalidItems.length === 1 ? '' : 's'} of the wrong type${e.invalidItems && e.invalidItems[0] ? ` (${e.invalidItems[0].found} in a list of ${e.invalidItems[0].allowed.join('/')}, at ${e.invalidItems[0].path})` : ''}` : i === 'broken-ref' ? 'a broken reference' : i === 'duplicate-slug' ? 'a slug another document uses' : i === 'missing-slug' ? 'no slug' : i === 'missing-title' ? 'no title' : `empty required field ${i.slice('missing-required:'.length)}`).join('; ');
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Documents', value: loading ? '...' : data.totalDocuments, tone: 'brass', hint: loading ? undefined : `in ${data.totalTypes} type${data.totalTypes === 1 ? '' : 's'}` }),
      Stat(host, { label: 'Unpublished', value: loading ? '...' : data.draftsCount, tone: data && data.draftsCount ? 'brass' : 'muted', hint: loading ? undefined : `${data.totalDrafts} new, ${data.totalChanged} changed` }),
      Stat(host, { label: 'Broken', value: !c ? '...' : broken.length, tone: broken.length ? 'rosin' : 'moss', hint: !c ? 'reading the documents...' : broken.length ? `document${broken.length === 1 ? '' : 's'} the studio flags in red` : 'every document matches the schema' }),
      Stat(host, { label: 'To look at', value: !c ? '...' : toLook, tone: toLook ? 'brass' : 'muted', hint: c ? `${c.stale} stale, ${c.missingAlt} without alt` : 'reading the documents...' }),
      Stat(host, { label: 'Site', value: !data || !data.previewUrl ? 'none' : preview === null ? '...' : preview.ok ? 'up' : 'down', tone: preview && preview.ok ? 'moss' : preview ? 'rosin' : 'muted', hint: data && data.previewUrl ? data.previewUrl.replace(/^https?:\/\//, '') : 'no environment URL' })),
    h('div', { className: 'mhealth' },
      Health(host, { label: 'project', value: loading ? '...' : data.projectId }),
      Health(host, { label: 'dataset', value: loading ? '...' : data.dataset }),
      Health(host, { label: 'images', value: loading ? '...' : data.assets.images || 0 }),
      Health(host, { label: 'files', value: loading ? '...' : data.assets.files || 0 }),
      Health(host, { label: 'schema', value: loading ? '...' : data.schema.documents ? `${data.schema.documents} types in code` : 'not in the repository' }),
      Health(host, { label: 'environment', value: data ? data.activeEnv || '-' : '...' })),
    onAction ? Panel(host, { title: 'Do', wide: true, action: meta('everything Sanity, from here') },
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
        h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', onClick: () => onOpenType((types.find((t) => !t.singleton) || types[0] || {}).name || '') }, 'Open a type to add, generate or edit documents'),
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => onAction('insights') }, 'Fix what is stale or missing'),
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => onAction('assets') }, 'Assets and alt text'),
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => onAction('groq') }, 'Run a GROQ query'),
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => onAction('studio') }, 'The schema code'),
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => onAction('ask') }, 'Ask the AI about the content'))) : null,
    broken.length ? Panel(host, { title: 'Broken documents', wide: true, action: meta(`${broken.length}, worst first; click one to open it`) },
      List(host, broken.slice(0, 24).map((e) => ListRow(host, { key: e.id, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-rosin)' } }), label: `${e.title || e.id}`, sub: describe(e), meta: e.type, onClick: onOpenDoc ? () => onOpenDoc({ type: e.type, id: e.id }) : undefined })))) : null,
    issues.length ? Panel(host, { title: 'Needs attention', wide: true, action: meta(`${issues.length}`) },
      List(host, issues.map((i, k) => ListRow(host, { key: k, lead: h('span', { className: 'mind-dot', style: { background: i.level === 'warn' ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: i.message, sub: i.issue === 'draft' || i.issue === 'changed' ? 'Content > unpublished' : i.issue === 'stale' ? 'Insights > stale' : i.issue === 'empty' ? 'Content: a type with nothing in it yet' : i.issue === 'orphan' ? 'Studio: documents whose type the code no longer declares' : 'Content' })))) : null,
    h('div', { className: 'san-row2' },
      Panel(host, { title: 'Types', action: meta(loading ? '' : `${types.length}`) },
        loading ? h(ui.Skeleton, { count: 5, height: 18 }) : types.length ? h('div', { style: { maxHeight: 520, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, types.slice().sort((a, b) => b.total - a.total).map((t) => typeRow(host, t, onOpenType)))) : empty('No document type in this dataset.')),
      Panel(host, { title: 'Changed last', action: meta(loading ? '' : `${(data.recent || []).length}`) },
        loading ? h(ui.Skeleton, { count: 5, height: 18 }) : (data.recent || []).length ? List(host, data.recent.map((e) => docRow(host, e, onOpenDoc))) : empty('Nothing changed lately.'))));
}

export function OverviewAside({ host, health, insights, onOpenDoc, onOpenType }) {
  const { h, ui } = host;
  const { data } = health;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const c = insights.data ? insights.data.counts : null;
  const worst = insights.data ? (insights.data.entries || []).filter((e) => e.issues.some((i) => i !== 'draft' && i !== 'stale')).sort((a, b) => b.issues.length - a.issues.length).slice(0, 15) : [];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'Issues', action: meta(c ? `${c.total} documents read` : '...') },
      c ? Bars(host, { rows: [{ label: 'unpublished', value: c.draft }, { label: 'changed', value: c.changed, color: 'var(--sy-brass)' }, { label: 'stale', value: c.stale, color: 'var(--sy-brass)' }, { label: 'no title', value: c.missingTitle, color: 'var(--sy-rosin)' }, { label: 'no slug', value: c.missingSlug, color: 'var(--sy-rosin)' }, { label: 'same slug', value: c.duplicateSlug, color: 'var(--sy-rosin)' }, { label: 'missing alt', value: c.missingAlt, color: 'var(--sy-rosin)' }, { label: 'broken ref', value: c.brokenRef, color: 'var(--sy-rosin)' }, { label: 'empty required', value: c.missingRequired, color: 'var(--sy-brass)' }] }) : h(ui.Skeleton, { count: 5, height: 14 })),
    Panel(host, { title: 'Fix first', ...FILL, action: meta(insights.data ? `${worst.length}` : '...') },
      !insights.data ? h(ui.Skeleton, { count: 4, height: 16 }) : worst.length ? List(host, worst.map((e) => ListRow(host, { key: `${e.type}-${e.id}`, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-rosin)' } }), label: e.title || e.id, sub: `${e.type} - ${e.issues.filter((i) => i !== 'draft' && i !== 'stale').map((i) => i.replace('missing-required:', 'empty ')).join(', ')}`, onClick: () => onOpenDoc(e.type, e.id) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing beyond drafts and age.')),
    data && data.types ? Panel(host, { title: 'Empty types', action: meta(`${data.types.filter((t) => !t.total).length}`) },
      data.types.filter((t) => !t.total).length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, data.types.filter((t) => !t.total).map((t) => h(ui.Chip, { key: t.name, onClick: () => onOpenType(t.name) }, t.name))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Every type has documents.')) : null);
}
