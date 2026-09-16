/**
 * Insights: every document with a problem, grouped by the kind of problem. Each row opens the document.
 */
import { ago } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';
import { statusColour } from './overview.js';

export function useInsights(host, san, project, enabled) {
  const { react } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => { if (!project || !enabled) return; setError(null); san('/insights').then(setData).catch((e) => { setData(null); setError(e.message); }); }, [san, project, enabled]);
  useEffect(() => { setData(null); reload(); }, [project, enabled]);
  return { data, error, reload };
}

const KINDS = [
  ['changed', 'Changes pending', 'published, edited since, not republished'],
  ['draft', 'Unpublished', 'never published'],
  ['stale', 'Not touched in 90 days', 'published, and old'],
  ['missing-title', 'No title', 'nothing to call it by'],
  ['missing-slug', 'No slug', 'a page-like type without a URL'],
  ['duplicate-slug', 'Same slug', 'two documents of a type share a URL'],
  ['missing-alt', 'Images without alt text', 'accessibility and SEO'],
  ['broken-ref', 'Broken references', 'points at a document that no longer exists'],
  ['missing-required', 'Empty required fields', 'the schema says they must be set'],
];
const SHORT = { changed: 'Changes', draft: 'Unpublished', stale: 'Stale', 'missing-title': 'No title', 'missing-slug': 'No slug', 'duplicate-slug': 'Same slug', 'missing-alt': 'Alt text', 'broken-ref': 'Broken refs', 'missing-required': 'Required' };
const has = (e, k) => (k === 'missing-required' ? e.issues.some((i) => i.startsWith('missing-required:')) : e.issues.includes(k));
const label = (i) => i.replace('missing-required:', 'empty ');

export function Insights({ host, insights, q, onOpen }) {
  const { h, ui } = host;
  const { data, error } = insights;
  const { useState } = host.react;
  const [kind, setKind] = useState('');
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (error) return h(ui.EmptyState, { title: 'Could not read the documents', body: error });
  const entries = (data ? data.entries || [] : []).filter((e) => e.issues.length && (!q || `${e.title} ${e.type} ${e.slug}`.toLowerCase().includes(q)));
  const c = data ? data.counts : null;
  const serious = (e) => e.issues.some((i) => i !== 'draft' && i !== 'stale' && i !== 'changed');
  const row = (e) => ListRow(host, { key: `${e.type}-${e.id}`, lead: h('span', { className: 'mind-dot', style: { background: serious(e) ? 'var(--sy-rosin)' : statusColour(e.status) } }), label: e.title || e.id, sub: `${e.type}${e.slug ? ` - /${e.slug}` : ''} - ${e.issues.map(label).join(', ')}${e.images && e.images.length ? ` (${e.images.length} image${e.images.length === 1 ? '' : 's'})` : ''}${e.brokenRefs && e.brokenRefs.length ? ` (${e.brokenRefs.map((b) => b.path).join(', ')})` : ''}`, meta: e.updatedAt ? ago(e.updatedAt) : '', onClick: () => onOpen(e.type, e.id) });
  const shown = kind ? entries.filter((e) => has(e, kind)) : entries;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Documents read', value: !c ? '...' : c.total, tone: 'brass' }),
      Stat(host, { label: 'With a problem', value: !data ? '...' : entries.filter(serious).length, tone: entries.some(serious) ? 'rosin' : 'moss', hint: 'beyond drafts and age' }),
      Stat(host, { label: 'Images without alt', value: !c ? '...' : c.imagesMissingAlt, tone: c && c.imagesMissingAlt ? 'rosin' : 'muted', hint: c ? `in ${c.missingAlt} document${c.missingAlt === 1 ? '' : 's'}` : undefined }),
      Stat(host, { label: 'Unpublished', value: !c ? '...' : c.draft + c.changed, tone: 'muted', hint: c ? `${c.draft} new, ${c.changed} changed` : undefined })),
    h('div', { className: 'mhealth' }, ...KINDS.map(([k, l]) => Health(host, { key: k, label: l, value: !data ? '...' : entries.filter((e) => has(e, k)).length }))),
    Panel(host, { title: kind ? KINDS.find(([k]) => k === kind)[1] : 'Everything to look at', wide: true, action: h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, h(ui.Chip, { on: !kind, onClick: () => setKind('') }, 'All'), ...KINDS.map(([k]) => h(ui.Chip, { key: k, on: kind === k, onClick: () => setKind(k) }, SHORT[k]))) },
      !data ? h(ui.Skeleton, { count: 8, height: 18 }) : shown.length ? h('div', { style: { maxHeight: 640, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, shown.sort((a, b) => b.issues.length - a.issues.length).slice(0, 300).map(row))) : empty(kind ? 'Nothing of that kind.' : 'Every document is clean.')));
}

export function InsightsAside({ host, insights, onOpen }) {
  const { h, ui } = host;
  const { data } = insights;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const types = data ? data.types || [] : [];
  const serious = (e) => e.issues.some((i) => i !== 'draft' && i !== 'stale' && i !== 'changed');
  const perType = types.map((t) => ({ name: t.name, count: (data.entries || []).filter((e) => e.type === t.name && serious(e)).length })).filter((t) => t.count).sort((a, b) => b.count - a.count);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'By type', action: meta(data ? `${perType.length}` : '...') },
      !data ? h(ui.Skeleton, { count: 4, height: 16 }) : perType.length ? List(host, perType.map((t) => ListRow(host, { key: t.name, label: t.name, meta: `${t.count}` }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No type has a problem beyond drafts and age.')),
    data && (data.counts.emptyTypes || []).length ? Panel(host, { title: 'Types with no document', action: meta(`${data.counts.emptyTypes.length}`) }, h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, data.counts.emptyTypes.map((m) => h(ui.Chip, { key: m }, m)))) : null,
    Panel(host, { title: 'How it reads' }, h('p', { className: 'mlead', style: { margin: 0 } }, `Up to 2500 documents, drafts and published, folded into one row each. Stale means published and untouched for ${data ? data.staleDays : 90} days. Alt text is checked on every image object that carries an asset. Required fields come from the schema in the repository. Slugs are expected on types whose schema has one, or whose documents mostly have one.`)));
}
