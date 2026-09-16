/**
 * One document as a form, with the Studio's own semantics: editing writes a draft, Publish
 * copies the draft over the published version, Unpublish moves it back, Discard drops the
 * draft. The preview shows the page on the site. The AI reviews the document or writes a
 * field from what you typed. The right pane has the facts, the history, the references.
 */
import { ago, askModel, titleOf, slugOf, ptToText, looksLikePortableText, imageUrl } from './helpers.js';
import { Panel, Stat, Health, List, ListRow, FILL } from './kit.js';
import { statusColour, statusLabel } from './overview.js';
import { FieldEditor, inferFields } from './fields.js';

export function useDocument(host, san, open) {
  const { react } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!open) return;
    setError(null);
    san(`/document?id=${encodeURIComponent(open.id)}`).then((d) => { if (!d || d.error) throw new Error((d && d.error) || 'Document not found'); setData(d); }).catch((e) => setError(e.message));
  }, [san, open && open.id]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  return { data, title: data ? titleOf(data.doc) : '', error, reload };
}

export function DocumentPage({ host, san, project, current, open, doc, schema, health, onChanged, onClose, onOpenDoc, onDuplicate, onGroq }) {
  const { h, ui, api, notify, tokens } = host;
  const { useState, useEffect } = host.react;
  const { data, error } = doc;
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const [ai, setAi] = useState(null);
  const [aiKind, setAiKind] = useState(null);
  const [writeFor, setWriteFor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [zoom, setZoom] = useState(0.6);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState(null);
  useEffect(() => { setDraft({}); setAi(null); setAiKind(null); setConfirmDelete(false); setJsonMode(false); setShowPreview(false); }, [open.id, data && data.doc && data.doc._rev]);
  // Which of the usual URLs answers: the first reachable one wins.
  useEffect(() => {
    setPreviewUrl(null);
    if (!data || !data.previewCandidates || !data.previewCandidates.length) { setPreviewUrl(''); return; }
    let alive = true;
    (async () => { for (const u of data.previewCandidates) { const r = await api(`/api/plugins/sanity/preview-check?url=${encodeURIComponent(u)}`).catch(() => ({ ok: false })); if (!alive) return; if (r.ok) { setPreviewUrl(u); return; } } if (alive) setPreviewUrl(''); })();
    return () => { alive = false; };
  }, [data && data.previewCandidates && data.previewCandidates.join('|')]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (error) return h(ui.EmptyState, { title: 'Could not open the document', body: error });
  if (!data) return h('div', null, h('div', { className: 'mstats mstats--head' }, [0, 1, 2, 3].map((k) => h('div', { key: k, className: 'mstat' }, h(ui.Skeleton, { count: 2, height: 14 })))), h('div', { className: 'san-item', style: { marginTop: 'var(--sy-s3)' } }, Panel(host, { title: 'Fields' }, h(ui.Skeleton, { count: 8, height: 16 })), Panel(host, { title: 'Publish' }, h(ui.Skeleton, { count: 3, height: 16 }))));

  const base = data.doc;
  const status = data.status;
  const fields = schema.data ? (schema.data.fields || []).filter((f) => !f.hidden) : [];
  const known = new Set(fields.map((f) => f.name));
  const extra = inferFields(base).filter((f) => !known.has(f.name));
  const dirty = Object.keys(draft).length > 0;
  const val = (name) => (name in draft ? draft[name] : base[name]);
  const merged = () => { const out = { ...base, ...draft }; for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]; return out; };
  const act = async (fn, done) => { try { await fn(); if (done) notify(done, 'moss'); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };
  const save = (publish) => { setBusy(publish ? 'save-publish' : 'save'); act(() => san('/save', { method: 'POST', body: JSON.stringify({ id: data.id, doc: merged(), publish: !!publish }) }).then(() => setDraft({})), publish ? 'Saved and published' : 'Saved as a draft'); };
  const publish = () => { setBusy('publish'); act(() => san(`/documents/${encodeURIComponent(base._type)}/${encodeURIComponent(data.id)}/publish`, { method: 'POST', body: '{}' }), 'Published'); };
  const unpublish = () => { setBusy('unpublish'); act(() => san(`/documents/${encodeURIComponent(base._type)}/${encodeURIComponent(data.id)}/unpublish`, { method: 'POST', body: '{}' }), 'Unpublished; it lives on as a draft'); };
  const discard = () => { setBusy('discard'); act(() => san(`/documents/${encodeURIComponent(base._type)}/${encodeURIComponent(data.id)}/discard`, { method: 'POST', body: '{}' }).then(() => { if (!data.published) onClose(); }), 'Draft discarded'); };
  const remove = () => { setBusy('delete'); act(() => san(`/documents/${encodeURIComponent(base._type)}/${encodeURIComponent(data.id)}`, { method: 'DELETE' }).then(() => onClose()), 'Deleted'); };
  const duplicate = async () => { setBusy('duplicate'); try { const r = await san('/duplicate', { method: 'POST', body: JSON.stringify({ id: data.id }) }); notify('Duplicated as a draft', 'moss'); onChanged(); onDuplicate(r.id); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };

  const summary = () => fields.map((f) => `${f.name} (${f.type}${f.required ? ', required' : ''}): ${(() => { const v = val(f.name); if (looksLikePortableText(v)) return JSON.stringify(ptToText(v)).slice(0, 400); return JSON.stringify(v === undefined ? null : v).slice(0, 300); })()}`).join('\n');
  const askAi = async (kind, field, value) => {
    setAiKind(kind === 'write' ? 'write' : kind); setAi(null); setWriteFor(field ? field.name : null);
    try {
      const system = 'You help a content editor working in Sanity. Plain, specific, no fluff, no emoji. Markdown unless asked for raw text.';
      const isPt = field && looksLikePortableText(value);
      const prompt = kind === 'review'
        ? `Review this ${base._type} document "${titleOf(base)}" (${statusLabel(status)}). Say what is missing, weak, inconsistent or risky (empty required fields, placeholder text, images without alt text, a missing or odd slug, SEO title and description, tone), then what to change, field by field. Short.\n\nFields:\n${summary()}`
        : kind === 'seo'
          ? `Write SEO metadata for this ${base._type} document "${titleOf(base)}": a title under 60 characters and a description under 160 characters, in the document's own language. Reply as two lines, "Title: ..." and "Description: ...", nothing else.\n\nFields:\n${summary()}`
          : kind === 'alt'
            ? `Suggest alt text for every image in this ${base._type} document "${titleOf(base)}" that has none. Reply as a Markdown list: the field path, then the alt text (short, descriptive, no "image of"), in the document's language.\n\nDocument:\n${JSON.stringify(merged()).slice(0, 12000)}`
            : `Write the value of the field "${field.name}" (${field.type}) of the ${base._type} document "${titleOf(base)}". The editor wants to say, in their words: "${isPt ? ptToText(value) : String(value || '').trim()}". Write that out properly in the site's voice and language - keep their intent, add only what makes it clear, never invent facts. Reply with the text only, no quotes, no label${isPt ? ', as plain paragraphs separated by blank lines (a line starting with ## is a heading)' : ''}.\n\nThe other fields, for context:\n${summary()}`;
      const text = await askModel(api, { prompt, system, maxTokens: kind === 'write' ? 900 : 900, from: 'sanity' });
      if (!text) { notify('Nothing came back', 'rosin'); setAiKind(null); return; }
      if (kind === 'write') {
        const clean = text.replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
        const next = isPt ? clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => ({ _type: 'block', _key: Math.random().toString(36).slice(2, 12), style: /^##\s/.test(p) ? 'h2' : 'normal', markDefs: [], children: [{ _type: 'span', _key: Math.random().toString(36).slice(2, 12), text: p.replace(/^##\s*/, ''), marks: [] }] })) : clean;
        setDraft({ ...draft, [field.name]: next }); setAiKind(null); notify(`${field.name} written - review it, then Save`, 'moss');
      } else if (kind === 'seo') {
        const t = (text.match(/Title:\s*(.+)/i) || [])[1]; const d = (text.match(/Description:\s*([\s\S]+)/i) || [])[1];
        const patch = {};
        const tKey = ['seoTitle', 'metaTitle', 'ogTitle'].find((k) => known.has(k)) || (base.seo && typeof base.seo === 'object' ? null : 'seoTitle');
        const dKey = ['seoDescription', 'metaDescription', 'description', 'ogDescription'].find((k) => known.has(k)) || 'seoDescription';
        if (t && tKey) patch[tKey] = t.trim(); if (d && dKey) patch[dKey] = d.trim();
        if (base.seo && typeof base.seo === 'object' && known.has('seo')) patch.seo = { ...base.seo, ...(t ? { title: t.trim() } : {}), ...(d ? { description: d.trim() } : {}) };
        setDraft({ ...draft, ...patch }); setAiKind(null); setAi(text); notify('SEO fields written - review them, then Save', 'moss');
      } else setAi(text);
    } catch (e) { notify(e.message, 'rosin'); setAiKind(null); }
  };

  const requiredEmpty = fields.filter((f) => f.required && (val(f.name) === undefined || val(f.name) === null || val(f.name) === '' || (Array.isArray(val(f.name)) && !val(f.name).length) || (val(f.name) && val(f.name)._type === 'slug' && !val(f.name).current)));
  const fieldView = (f) => h(FieldEditor, { key: f.name, host, san, field: { ...f, changed: f.name in draft }, value: val(f.name), onChange: (val) => setDraft({ ...draft, [f.name]: val }), objects: schema.data ? schema.data.objects : {}, cdn: data.cdn, refs: data.refs, depth: 0, siblings: (n) => val(n), onAi: (field, value) => askAi('write', field, value), aiBusy: aiKind === 'write' ? writeFor : null });

  const previewPanel = showPreview && previewUrl ? Panel(host, { title: 'Preview', wide: true, style: { marginBottom: 'var(--sy-s3)' }, action: h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
    h('span', { className: 'mpanel__meta' }, previewUrl.replace(/^https?:\/\//, '')),
    h('span', { role: 'group', 'aria-label': 'Zoom', style: { display: 'inline-flex', alignItems: 'center', border: `1px solid ${tokens('line')}`, borderRadius: 6, overflow: 'hidden', height: 28 } },
      h('button', { type: 'button', title: 'Zoom out', onClick: () => setZoom(Math.max(0.3, Math.round((zoom - 0.1) * 10) / 10)), style: { width: 28, height: 28, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 15, lineHeight: 1 } }, '−'),
      h('span', { className: 'mpanel__meta', style: { width: 44, textAlign: 'center', borderLeft: `1px solid ${tokens('line')}`, borderRight: `1px solid ${tokens('line')}`, lineHeight: '28px' } }, `${Math.round(zoom * 100)}%`),
      h('button', { type: 'button', title: 'Zoom in', onClick: () => setZoom(Math.min(1, Math.round((zoom + 0.1) * 10) / 10)), style: { width: 28, height: 28, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 15, lineHeight: 1 } }, '+')),
    h('span', { style: { display: 'inline-flex', gap: 6 } },
      h('button', { type: 'button', className: 'sy-btn sy-btn--sm', style: { height: 28, display: 'inline-flex', alignItems: 'center', gap: 6 }, onClick: () => window.open(previewUrl, '_blank') }, h(host.icons.external, { size: 13 }), 'Open in a tab'),
      h('button', { type: 'button', className: 'sy-btn sy-btn--sm', style: { height: 28, display: 'inline-flex', alignItems: 'center', gap: 6 }, onClick: () => setShowPreview(false) }, h(host.icons.close, { size: 13 }), 'Hide'))) },
    h('div', { style: { position: 'relative', width: '100%', height: 560, overflow: 'hidden', borderRadius: 6, border: `1px solid ${tokens('line')}`, background: '#fff' } },
      h('iframe', { key: `${previewUrl}-${base._rev}`, src: `/api/plugins/sanity/preview?url=${encodeURIComponent(previewUrl)}`, referrerPolicy: 'no-referrer', title: 'Preview', style: { position: 'absolute', top: 0, left: 0, width: `${100 / zoom}%`, height: `${100 / zoom}%`, border: 0, transform: `scale(${zoom})`, transformOrigin: '0 0' } }))) : null;
  const jsonPanel = jsonMode ? Panel(host, { title: 'The document as JSON', wide: true, style: { marginBottom: 'var(--sy-s3)' }, action: h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, jsonError ? h('span', { className: 'mpanel__meta', style: { color: 'var(--sy-rosin)' } }, jsonError) : null, h(ui.Button, { className: 'sy-btn--sm', onClick: () => setJsonMode(false) }, 'Back to fields'), h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: !!busy, onClick: async () => { try { const parsed = JSON.parse(jsonText); setJsonError(null); setBusy('save'); await act(() => san('/save', { method: 'POST', body: JSON.stringify({ id: data.id, doc: { ...parsed, _type: base._type } }) }).then(() => { setDraft({}); setJsonMode(false); }), 'Saved as a draft'); } catch (e) { setJsonError(e.message); } } }, busy === 'save' ? 'Saving...' : 'Save the JSON as a draft')) },
    h(ui.CodeEditor, { value: jsonText, language: 'json', height: 'calc(100vh - 430px)', onChange: (val) => { setJsonText(val); setJsonError(null); } })) : null;
  const aiPanel = Panel(host, { title: 'AI', action: h('div', { style: { display: 'flex', gap: 6 } },
    ai && host.writeNote ? h(ui.Button, { className: 'sy-btn--sm', onClick: async () => { if (await host.writeNote(`${base._type} ${titleOf(base)} review`, `# ${titleOf(base)}\n\n${ai}`)) notify('Saved and opened', 'moss'); } }, 'Save as note') : null,
    !ai ? meta(aiKind && aiKind !== 'write' ? 'reading...' : 'reads the fields') : null) },
    ai ? h('div', { style: { maxHeight: 360, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, h(ui.Markdown, { source: ai })) : h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, 'Review says what is missing or weak, field by field. SEO writes the title and description fields. Alt text suggests text for every image without one. Each text field has its own "write with AI" that expands what you typed.'),
    aiKind && aiKind !== 'write' && !ai ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, h(ui.Skeleton, { count: 4, height: 14 })) : null,
    h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: ai ? 'var(--sy-s3)' : 0 } },
      h(ui.Button, { className: 'sy-btn--sm', disabled: !!aiKind && !ai, onClick: () => askAi('review') }, 'Review'),
      h(ui.Button, { className: 'sy-btn--sm', disabled: !!aiKind && !ai, onClick: () => askAi('seo') }, 'SEO'),
      h(ui.Button, { className: 'sy-btn--sm', disabled: !!aiKind && !ai, onClick: () => askAi('alt') }, 'Alt text')));

  const outgoing = Object.values(data.refs || {}).filter((r) => r._type && !/^sanity\./.test(r._type));
  const hero = ['featuredImage', 'mainImage', 'image', 'heroImage', 'seoImage', 'ogImage'].map((k) => base[k]).find((v) => v && v.asset && v.asset._ref);

  return h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
    h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 'var(--sy-s3)', marginBottom: 'var(--sy-s3)' } },
      hero ? h('img', { src: imageUrl(data.cdn, hero.asset._ref, 160), alt: '', style: { width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flex: 'none', background: 'rgba(255,255,255,0.03)' } }) : null,
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } }, h('span', { className: 'mind-dot', style: { background: statusColour(status) } }), h('span', { className: 'mpanel__title' }, `${base._type} - ${statusLabel(status)}`)),
        h('h2', { style: { margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 600, color: 'var(--sy-text)' } }, titleOf(base) || data.id),
        h('p', { className: 'mlead', style: { margin: '6px 0 0' } }, `${slugOf(base) ? `/${slugOf(base)} - ` : ''}${fields.length} field${fields.length === 1 ? '' : 's'}${extra.length ? ` + ${extra.length} outside the schema` : ''}${base._updatedAt ? ` - updated ${ago(base._updatedAt)}` : ''}${base._createdAt ? ` - created ${new Date(base._createdAt).toLocaleDateString()}` : ''}.`)),
      h('div', { style: { display: 'flex', gap: 6, flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        previewUrl ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setShowPreview(!showPreview) }, showPreview ? 'Hide preview' : 'Preview here') : previewUrl === null && data.previewCandidates && data.previewCandidates.length ? h(ui.Button, { className: 'sy-btn--sm', disabled: true }, 'Finding the page...') : null,
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => { setJsonText(JSON.stringify(merged(), null, 2)); setJsonError(null); setJsonMode(!jsonMode); } }, jsonMode ? 'Fields' : 'JSON'),
        h(ui.Button, { className: 'sy-btn--sm', disabled: !!busy, onClick: duplicate }, busy === 'duplicate' ? 'Duplicating...' : 'Duplicate'),
        data.studioUrl ? h('a', { className: 'sy-btn sy-btn--sm', href: data.studioUrl, target: '_blank', rel: 'noreferrer' }, 'In the Studio') : null)),
    previewPanel,
    jsonPanel,
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'State', value: status === 'published' ? 'Published' : status === 'changed' ? 'Changes pending' : 'Unpublished', tone: status === 'published' ? 'moss' : status === 'changed' ? 'brass' : 'rosin', hint: data.published ? `${status === 'changed' ? 'live version' : 'live'} ${ago(data.published._updatedAt)}` : 'not live' }),
      Stat(host, { label: 'Required empty', value: schema.data ? requiredEmpty.length : '...', tone: requiredEmpty.length ? 'rosin' : 'muted', hint: requiredEmpty.length ? requiredEmpty.map((f) => f.name).slice(0, 3).join(', ') : undefined }),
      Stat(host, { label: 'Unsaved', value: Object.keys(draft).length, tone: dirty ? 'brass' : 'muted', hint: dirty ? 'Save writes the draft' : undefined }),
      Stat(host, { label: 'Referenced by', value: (data.incoming || []).length, tone: 'muted', hint: (data.incoming || []).length ? 'cannot be deleted while referenced' : 'nothing points here' })),
    h('div', { className: 'san-row2', style: showPreview || jsonMode ? { flex: 'none' } : { flex: 1, minHeight: 360 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0, minHeight: 0 } },
        Panel(host, { title: 'Fields', ...FILL, action: h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, dirty ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setDraft({}) }, 'Discard') : null, h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: !dirty || !!busy, onClick: () => save(false) }, busy === 'save' ? 'Saving...' : dirty ? `Save ${Object.keys(draft).length}` : 'Saved')) },
          !schema.data ? h(ui.Skeleton, { count: 6, height: 16 }) : fields.length ? h('div', null, fields.map(fieldView)) : empty('No schema for this type in the repository; the fields below are read from the document itself.'),
          extra.length ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, fields.length ? h('div', { className: 'mpanel__meta', style: { margin: '6px 0' } }, 'Also in the document, outside the schema') : null, extra.map(fieldView)) : null)),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0, minHeight: 0, overflow: 'auto', paddingRight: 8, scrollbarGutter: 'stable' } },
        Panel(host, { title: 'Publish', action: meta(status === 'published' ? 'live' : status === 'changed' ? 'live, edits pending' : 'not live') },
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            dirty ? h(ui.Button, { variant: 'primary', disabled: !!busy, onClick: () => save(true) }, busy === 'save-publish' ? 'Publishing...' : 'Save and publish') : data.draft ? h(ui.Button, { variant: 'primary', disabled: !!busy, onClick: publish }, busy === 'publish' ? 'Publishing...' : status === 'changed' ? 'Publish the changes' : 'Publish') : null,
            data.published ? h(ui.Button, { disabled: !!busy, onClick: unpublish }, busy === 'unpublish' ? 'Unpublishing...' : 'Unpublish') : null,
            data.draft && data.published ? h(ui.Button, { disabled: !!busy, onClick: discard }, busy === 'discard' ? 'Discarding...' : 'Discard the changes') : null,
            confirmDelete ? h(ui.Button, { disabled: !!busy, onClick: remove, style: { color: 'var(--sy-rosin)' } }, busy === 'delete' ? 'Deleting...' : 'Yes, delete it') : h(ui.Button, { disabled: !!busy, onClick: () => setConfirmDelete(true) }, 'Delete'),
            confirmDelete ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setConfirmDelete(false) }, 'Keep it') : null),
          dirty ? h('p', { className: 'mlead', style: { margin: 'var(--sy-s2) 0 0', color: 'var(--sy-brass)' } }, 'Unsaved changes are not on the site until you Save and publish.') : status === 'changed' ? h('p', { className: 'mlead', style: { margin: 'var(--sy-s2) 0 0' } }, 'The site shows the published version; the draft holds the newer edits.') : null,
          confirmDelete && (data.incoming || []).length ? h('p', { className: 'mlead', style: { margin: 'var(--sy-s2) 0 0', color: 'var(--sy-rosin)' } }, `${data.incoming.length} document${data.incoming.length === 1 ? '' : 's'} reference this one; Sanity will refuse until they are changed.`) : null),
        aiPanel,
        Panel(host, { title: 'References', bodyStyle: { maxHeight: 220, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' }, action: meta(`${(data.incoming || []).length} in, ${outgoing.length} out`) },
          (data.incoming || []).length || outgoing.length ? List(host, [
            ...(data.incoming || []).map((e) => ListRow(host, { key: `in-${e.id}`, lead: h('span', { className: 'mind-dot', style: { background: statusColour(e.status), width: 7, height: 7 } }), label: e.title || e.id, sub: `${e.type} - points here`, onClick: () => onOpenDoc(e.type, e.id) })),
            ...outgoing.map((r) => ListRow(host, { key: `out-${r._id}`, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-text-3)', width: 7, height: 7 } }), label: r.title || r._id, sub: `${r._type} - referenced from here`, onClick: () => onOpenDoc(r._type, r._id) })),
            ...(data.missingRefs || []).map((id) => ListRow(host, { key: `miss-${id}`, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-rosin)', width: 7, height: 7 } }), label: id, sub: 'referenced, but no such document' })),
          ]) : empty('Nothing points here and this document points nowhere.')),
        Panel(host, { title: 'Preview', bodyStyle: { maxHeight: 140, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' }, action: meta(previewUrl === null ? 'checking...' : previewUrl ? 'found' : 'none') },
          previewUrl === null && data.previewCandidates && data.previewCandidates.length ? h(ui.Skeleton, { count: 2, height: 16 }) : previewUrl ? List(host, [ListRow(host, { key: 'p', label: 'On the site', sub: previewUrl.replace(/^https?:\/\//, ''), meta: current && current.activeEnv ? current.activeEnv : '', onClick: () => window.open(previewUrl, '_blank') })]) : empty(data.previewCandidates && data.previewCandidates.length ? `None of the usual paths answered on ${(data.previewCandidates[0] || '').replace(/^https?:\/\/([^/]+).*$/, '$1')}.` : slugOf(base) ? 'The project has no environment URL; set one under Projects.' : 'This document has no slug, so no page of its own.')))));
}

export function DocumentAside({ host, san, project, current, open, doc, schema, onOpenDoc, onGroq }) {
  const { h, ui } = host;
  const { useState, useEffect } = host.react;
  const { data } = doc;
  const [history, setHistory] = useState(null);
  useEffect(() => { setHistory(null); if (open) san(`/history?id=${encodeURIComponent(open.id)}`).then((d) => setHistory(d.transactions || [])).catch((e) => setHistory({ error: e.message })); }, [open && open.id, data && data.doc && data.doc._rev]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const fields = schema.data ? schema.data.fields || [] : [];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    data ? Panel(host, { title: 'Details' }, h(ui.InfoGrid, { items: [{ label: 'Id', value: data.id }, { label: 'Type', value: data.type }, { label: 'Updated', value: data.doc._updatedAt ? new Date(data.doc._updatedAt).toLocaleString() : '-' }, { label: 'Created', value: data.doc._createdAt ? new Date(data.doc._createdAt).toLocaleString() : '-' }, { label: 'Published', value: data.published ? new Date(data.published._updatedAt).toLocaleString() : 'never' }, { label: 'Revision', value: data.doc._rev || '-' }] })) : null,
    Panel(host, { title: 'History', ...FILL, action: meta(history === null ? 'reading...' : history.error ? 'unavailable' : `${history.length}`) },
      history === null ? h(ui.Skeleton, { count: 3, height: 16 }) : history.error ? h('p', { className: 'mlead', style: { margin: 0 } }, history.error) : history.length ? List(host, history.map((t) => ListRow(host, { key: t.id, lead: h('span', { className: 'mind-dot', style: { background: t.documentIds.some((x) => !x.startsWith('drafts.')) ? 'var(--sy-moss)' : 'var(--sy-brass)', width: 7, height: 7 } }), label: `${t.author}`, sub: `${t.documentIds.some((x) => !x.startsWith('drafts.')) ? 'published' : 'draft'} - ${t.mutations} change${t.mutations === 1 ? '' : 's'}`, meta: ago(t.at) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No history yet.')),
    Panel(host, { title: 'Schema', action: meta(schema.data ? schema.data.source === 'code' ? schema.data.file.split('/').pop() : 'inferred' : '...') },
      !schema.data ? h(ui.Skeleton, { count: 4, height: 14 }) : fields.length ? h('div', { style: { maxHeight: 260, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, fields.map((f) => ListRow(host, { key: f.name, lead: h('span', { className: 'mind-dot', style: { background: f.required ? 'var(--sy-brass)' : 'var(--sy-text-3)', width: 7, height: 7 } }), label: f.name, sub: `${f.type}${f.required ? ' - required' : ''}` })))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No declared fields.')),
    data ? Panel(host, { title: 'Query it' }, h(ui.Button, { className: 'sy-btn--sm', onClick: () => onGroq(`*[_id in ["${data.id}", "drafts.${data.id}"]]`) }, 'Open in GROQ')) : null);
}
