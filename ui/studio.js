/**
 * Studio: the code side of the project. The schema files the repository declares (and which
 * types each defines), the components that render them, the repository's shape, and a shell
 * on it to work. Files open read-only in the code editor; changes happen in a shell.
 */
import { Panel, Stat, Health, List, ListRow } from './kit.js';

export function Studio({ host, san, project, current, health, q }) {
  const { h, ui } = host;
  const { useState, useEffect } = host.react;
  const [info, setInfo] = useState(null);
  const [schemas, setSchemas] = useState(null);
  const [files, setFiles] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    setInfo(null); setSchemas(null); setFiles(null); setOpen(null);
    if (!current || !current.repoPath) return;
    san('/repo/info').then(setInfo).catch((e) => setInfo({ error: e.message }));
    san('/repo/schemas').then((l) => setSchemas(Array.isArray(l) ? l : [])).catch((e) => setSchemas({ error: e.message }));
    san('/repo/components').then((l) => setFiles(Array.isArray(l) ? l : [])).catch((e) => setFiles({ error: e.message }));
  }, [current && current.repoPath, project]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (!current || !current.repoPath) return h(ui.EmptyState, { title: 'No repository on this project', body: 'Give the project a repository under Projects, and its schema files and components show up here.' });
  const schemaList = Array.isArray(schemas) ? schemas.filter((f) => !q || f.relativePath.toLowerCase().includes(q) || f.types.some((t) => t.toLowerCase().includes(q))) : [];
  const fileList = Array.isArray(files) ? files.filter((f) => f.kind !== 'schema' && (!q || f.relativePath.toLowerCase().includes(q))) : [];
  const openFile = async (f) => { try { const r = await san(`/repo/file/${encodeURIComponent(f.relativePath)}`); setOpen({ ...f, content: r.content || '' }); } catch (e) { setOpen({ ...f, content: e.message }); } };
  const types = health.data ? health.data.types || [] : [];
  const orphans = types.filter((t) => !t.inCode && t.total);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Schema files', value: schemas === null ? '...' : schemaList.length, tone: 'brass', hint: info && info.schema ? `${info.schema.documents.length} document types, ${info.schema.objects.length} object types` : undefined }),
      Stat(host, { label: 'Component files', value: files === null ? '...' : fileList.length, tone: 'muted' }),
      Stat(host, { label: 'Framework', value: info ? `${info.framework || '-'}${info.nextSanity ? ' + next-sanity' : ''}` : '...', tone: 'muted', hint: info && info.sanityVersion ? `sanity ${info.sanityVersion}` : undefined }),
      Stat(host, { label: 'Studio', value: info ? info.hasSanityConfig ? 'in this repo' : info.studioPath ? 'in a subfolder' : 'elsewhere' : '...', tone: 'muted', hint: info ? info.sanityConfig || info.studioPath || 'no sanity.config found' : undefined })),
    orphans.length ? Panel(host, { title: 'Documents without a schema here', wide: true, action: meta(`${orphans.length} type${orphans.length === 1 ? '' : 's'}`) }, h('p', { className: 'mlead', style: { margin: 0 } }, `${orphans.map((t) => `${t.name} (${t.total})`).join(', ')}: the dataset holds them but this repository declares no type for them. The Studio may live in another repository, or the type was removed.`)) : null,
    h('div', { className: 'san-row2' },
      Panel(host, { title: 'Schema files', action: meta(schemas === null ? 'reading...' : `${schemaList.length}`) },
        schemas === null ? h(ui.Skeleton, { count: 5, height: 16 }) : schemas.error ? empty(schemas.error) : schemaList.length ? h('div', { style: { maxHeight: 480, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, schemaList.map((f) => ListRow(host, { key: f.relativePath, lead: h('span', { className: 'mind-dot', style: { background: f.types.some((t) => types.some((x) => x.name === t)) ? 'var(--sy-moss)' : 'var(--sy-brass)' } }), label: f.name, sub: `${f.relativePath} - ${f.types.join(', ')}`, onClick: () => openFile(f) })))) : empty('No file with defineType or a document/object literal was found.')),
      Panel(host, { title: 'Components', action: meta(files === null ? '' : `${fileList.length}`) },
        files === null ? h(ui.Skeleton, { count: 5, height: 16 }) : files.error ? empty(files.error) : fileList.length ? h('div', { style: { maxHeight: 480, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, fileList.map((f) => ListRow(host, { key: f.relativePath, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-text-3)', width: 7, height: 7 } }), label: f.name, sub: f.relativePath, onClick: () => openFile(f) })))) : empty('No component files under components/, src/components/ or app/components/.'))),
    open ? Panel(host, { title: open.relativePath, wide: true, action: h('div', { style: { display: 'flex', gap: 6 } }, host.openShell ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => host.openShell({ repo: current.name, path: current.repoPath }, { launch: true, label: open.name }) }, 'Work on it') : null, h(ui.Button, { className: 'sy-btn--sm', onClick: () => setOpen(null) }, 'Close')) },
      h(ui.CodeEditor, { value: open.content.slice(0, 400000), language: open.name, height: 560, readOnly: true })) : null);
}

export function StudioAside({ host, current, health }) {
  const { h, ui } = host;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'Repository' },
      current && current.repoPath ? h('div', null,
        h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)', wordBreak: 'break-all' } }, current.repoPath),
        host.openShell ? h(ui.Button, { variant: 'primary', className: 'sy-btn--sm', onClick: () => host.openShell({ repo: current.name, path: current.repoPath }, { launch: true, label: current.name }) }, 'Start working') : null)
        : h('p', { className: 'mlead', style: { margin: 0 } }, 'No repository on this project.')),
    Panel(host, { title: 'Studio', action: h('span', { className: 'mpanel__meta' }, current && current.studioUrl ? 'deployed' : 'no URL') },
      current && current.studioUrl ? h('a', { className: 'sy-btn sy-btn--sm', href: current.studioUrl, target: '_blank', rel: 'noreferrer' }, 'Open the Studio') : h('p', { className: 'mlead', style: { margin: 0 } }, 'Set the Studio URL under Projects to deep-link documents into it.')),
    Panel(host, { title: 'Environments', action: h('span', { className: 'mpanel__meta' }, current ? `${(current.environments || []).length}` : '') },
      current && (current.environments || []).length ? h('ul', { className: 'mlist', role: 'list' }, current.environments.map((e) => h('li', { key: e.id }, h('div', { className: 'mlist__row mlist__row--tall' }, h('span', { className: 'mind-dot', style: { background: e.id === current.activeEnv ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), h('span', { className: 'mlist__main' }, h('span', { className: 'mlist__label' }, e.label), h('span', { className: 'mlist__sub' }, e.url || (e.localPort ? `localhost:${e.localPort}` : 'no URL'))))))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'None.')),
    Panel(host, { title: 'Changing the schema' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'Sanity schemas are code. Open a shell on the repository and ask the AI to add or change a type; the Studio picks it up on its next build, and this screen reads it on the next refresh.')));
}
