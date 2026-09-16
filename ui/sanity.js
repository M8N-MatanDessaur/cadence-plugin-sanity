/**
 * Sanity in Cadence 3.0: three regions and a header, like the other plugins.
 *
 *   Sidebar: Overview, Content, Insights, Assets, GROQ, Studio, Ask, Projects; the project
 *   this screen is on (it follows the repository the active shell is on), its environment,
 *   a search.
 *   Main: the dataset as a bento, a type's documents, one document as a form you can edit,
 *   publish and preview, the issues, the assets, a query console, the code side, questions.
 *   Right: what to fix first, the types, or the document's facts and history.
 *
 * Every call carries ?project=<name>, so two screens on two repositories never fight over a
 * global active project. API tokens never reach the browser.
 */
import { ensureStyles, NavItem, Section } from './kit.js';
import { ago } from './helpers.js';
import { useHealth, Overview, OverviewAside } from './overview.js';
import { Types, Documents, ContentAside } from './content.js';
import { useDocument, DocumentPage, DocumentAside } from './document.js';
import { useTypeSchema, TypeTools, NewDocument, Generate, FindReplace, ExportType } from './type.js';
import { useInsights, Insights, InsightsAside } from './insights.js';
import { Assets, AssetsAside } from './assets.js';
import { Groq, GroqAside } from './groq.js';
import { Studio, StudioAside } from './studio.js';
import { Ask } from './ask.js';
import { Projects, ProjectsAside } from './projects.js';

export const API = '/api/plugins/sanity';

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'chart', hint: 'The dataset: types, documents, drafts, what needs attention, what changed last.' },
  { id: 'content', label: 'Content', icon: 'list', hint: 'Document types and their documents. Open one to read, edit, preview and publish it.' },
  { id: 'insights', label: 'Insights', icon: 'warning', hint: 'Documents with a problem: unpublished changes, stale, missing titles or slugs, images without alt text, broken references, empty required fields.' },
  { id: 'assets', label: 'Assets', icon: 'epic', hint: 'Images and files in the dataset, where they are used, and their alt text.' },
  { id: 'groq', label: 'GROQ', icon: 'run', hint: 'A query console on the dataset. Results as JSON, a history of what you ran.' },
  { id: 'studio', label: 'Studio', icon: 'branch', hint: 'The code side: the schema files and components this repository defines.' },
  { id: 'ask', label: 'Ask', icon: 'search', hint: 'A question about the content. The AI reads the dataset for you.' },
  { id: 'projects', label: 'Projects', icon: 'story', hint: 'The Sanity projects this workspace knows, their datasets, repositories and environments.' },
];

function Sanity({ host }) {
  const { h, ui, api, notify, context } = host;
  const { useState, useEffect, useCallback, useMemo } = host.react;
  const [tab, setTab] = useState('overview');
  const [projects, setProjects] = useState(null);
  const [project, setProject] = useState(() => { try { return localStorage.getItem('sy.san.project') || ''; } catch { return ''; } });
  const [q, setQ] = useState('');
  const [openType, setOpenType] = useState(null);
  const [openDoc, setOpenDoc] = useState(null);
  const [openAsset, setOpenAsset] = useState(null);
  const [mode, setMode] = useState(null);
  const [seed, setSeed] = useState(null);
  const [groqSeed, setGroqSeed] = useState(null);
  useEffect(() => { ensureStyles(); }, []);
  const san = useCallback((path, opts) => api(`${API}${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(project)}`, opts), [api, project]);
  const loadProjects = useCallback(() => api(`${API}/projects`).then((d) => {
    const list = d.projects || [];
    setProjects(list);
    const focused = ((context && context()) || {}).focused;
    const norm = (v) => String(v || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const byRepo = focused && focused.path ? list.find((p) => p.repoPath && norm(p.repoPath) === norm(focused.path)) : null;
    setProject((cur) => (byRepo ? byRepo.name : (cur && list.some((p) => p.name === cur)) ? cur : (d.activeProject && list.some((p) => p.name === d.activeProject)) ? d.activeProject : (list[0] ? list[0].name : '')));
  }).catch((e) => { setProjects([]); notify(e.message, 'rosin'); }), [api, context]);
  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { try { if (project) localStorage.setItem('sy.san.project', project); } catch {} }, [project]);
  const current = (projects || []).find((p) => p.name === project) || null;
  const configured = !!(current && current.projectId && current.dataset && current.apiTokenSet);
  const health = useHealth(host, san, project, configured && tab !== 'projects');
  const insights = useInsights(host, san, project, configured && (tab === 'insights' || tab === 'overview'));
  const doc = useDocument(host, san, openDoc);
  const schema = useTypeSchema(host, san, openType || (openDoc ? openDoc.type : null));
  const leave = () => { setOpenDoc(null); setOpenAsset(null); setMode(null); setSeed(null); };
  const setEnv = async (id) => { try { await san('/env', { method: 'POST', body: JSON.stringify({ env: id }) }); await loadProjects(); health.reload(true); notify(`On ${id}`, 'moss'); } catch (e) { notify(e.message, 'rosin'); } };
  const nav = NAV.find((n) => n.id === tab) || NAV[0];
  const filtered = useMemo(() => q.trim().toLowerCase(), [q]);
  const typeRow = openType && health.data ? (health.data.types || []).find((t) => t.name === openType) : null;
  const openTheDoc = (type, id) => { setTab('content'); setOpenType(type); setOpenAsset(null); setMode(null); setOpenDoc({ type, id }); };
  const runGroq = (query) => { setGroqSeed({ query, at: Date.now() }); setTab('groq'); leave(); };
  const problems = insights.data ? (insights.data.entries || []).filter((e) => e.issues.some((i) => i !== 'draft')).length : 0;

  const left = h('div', { className: 'sb' },
    h('div', { className: 'sb__head' }, h('span', { className: 'sb__title' }, 'Sanity')),
    h('div', { className: 'mind-stats' },
      !health.data ? h('span', null, projects === null ? 'reading the projects...' : configured ? 'reading the dataset...' : 'no project configured') : [h('span', { key: 't' }, `${health.data.totalTypes} types`), h('span', { key: 'd' }, `${health.data.totalDocuments} documents`), h('span', { key: 'r' }, `${health.data.draftsCount} drafts`)]),
    h('ul', { className: 'sb__list', role: 'list' },
      NAV.map((n) => NavItem(host, {
        key: n.id, icon: host.icons[n.icon], label: n.label, active: tab === n.id && !openDoc, title: n.hint,
        badge: n.id === 'content' && health.data ? (health.data.totalDocuments || undefined) : n.id === 'insights' && insights.data ? (problems || undefined) : n.id === 'projects' && projects ? (projects.length || undefined) : undefined,
        onClick: () => { setTab(n.id); leave(); if (n.id !== 'content') setOpenType(null); },
      }))),
    h('div', { style: { flex: 1 } }),
    Section(host, 'Project'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '0 var(--sy-s3) var(--sy-s2)' } },
      h(ui.Select, { value: project, onChange: (e) => { setProject(e.target.value); leave(); setOpenType(null); }, 'aria-label': 'Project' },
        (projects || []).map((p) => h('option', { key: p.name, value: p.name }, `${p.name}${p.dataset ? ` (${p.dataset})` : ''}`)),
        !(projects || []).length ? h('option', { value: '' }, 'No project yet') : null),
      current && (current.environments || []).length > 1 ? h(ui.Select, { value: current.activeEnv || '', onChange: (e) => setEnv(e.target.value), 'aria-label': 'Environment' },
        current.environments.map((e) => h('option', { key: e.id, value: e.id }, `${e.label}${e.url || e.localPort ? '' : ' (no URL)'}`))) : null,
      tab === 'content' || tab === 'insights' || tab === 'assets' || tab === 'studio' ? h(ui.Input, { value: q, placeholder: tab === 'assets' ? 'Search assets' : tab === 'studio' ? 'Search files' : 'Search documents', onChange: (e) => setQ(e.target.value), 'aria-label': 'Search' }) : null),
    h('div', { className: 'sb__foot' }, openDoc ? 'One document. Back to the type from the header.' : openType ? 'One type. Back to the types from the header.' : nav.hint));

  const header = h('div', { className: 'mind-view__head' },
    h('div', null,
      h('h1', { className: 'stage-title' }, openDoc ? (doc.data ? doc.title || openDoc.id : 'Document') : openType ? (typeRow && typeRow.title && typeRow.title !== typeRow.name ? `${typeRow.title} (${openType})` : openType) : nav.label),
      h('p', { style: { margin: 0, color: 'var(--sy-text-3)', fontSize: 'var(--sy-fs-sm)' } },
        openDoc ? `${openDoc.type} - ${doc.data ? doc.data.status === 'published' ? 'published' : doc.data.status === 'changed' ? 'published, with unpublished changes' : 'draft, not published' : 'reading...'}${doc.data && doc.data.doc && doc.data.doc._updatedAt ? ` - updated ${ago(doc.data.doc._updatedAt)}` : ''}` : openType ? (typeRow ? `${typeRow.total} document${typeRow.total === 1 ? '' : 's'}${typeRow.drafts ? `, ${typeRow.drafts} unpublished` : ''}${typeRow.changed ? `, ${typeRow.changed} with changes` : ''}${typeRow.inCode ? ` - ${typeRow.fieldCount} fields in ${typeRow.name}'s schema.` : ' - no schema in the repository; fields are inferred from the documents.'}` : 'A document type.') : `${nav.hint}${project ? ` On ${project}${current && current.dataset ? ` / ${current.dataset}` : ''}${current && current.activeEnv ? ` (${current.activeEnv})` : ''}.` : ''}`)),
    h('div', { className: 'mind-view__actions' },
      current && current.studioUrl && !openDoc ? h('a', { className: 'sy-btn', href: current.studioUrl, target: '_blank', rel: 'noreferrer' }, 'Open the Studio') : null,
      tab === 'content' && openType && !openDoc && !mode ? h(ui.Button, { variant: 'primary', onClick: () => setMode('new') }, 'New document') : null,
      openDoc ? h(ui.Button, { onClick: () => { setOpenDoc(null); setSeed(null); } }, 'Back to the type') : mode ? h(ui.Button, { onClick: () => { setMode(null); setSeed(null); } }, 'Back to the documents') : openType ? h(ui.Button, { onClick: () => setOpenType(null) }, 'Back to the types') : h(ui.Button, { onClick: () => { health.reload(true); insights.reload(); loadProjects(); } }, 'Refresh')));

  const main = h('div', { style: { padding: '12px 16px 24px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
    projects && !projects.length && tab !== 'projects' ? h(ui.EmptyState, { title: 'No Sanity project yet', body: 'Add one under Projects: a name, the project id and dataset, an API token, and the repository it belongs to.' })
      : !configured && tab !== 'projects' && projects && projects.length ? h(ui.EmptyState, { title: `${project || 'This project'} is not complete`, body: 'Give it a project id, a dataset and an API token under Projects.' })
      : openDoc
        ? h(DocumentPage, { host, san, project, current, open: openDoc, doc, schema, health, onChanged: () => { doc.reload(); health.reload(true); insights.reload(); }, onClose: () => setOpenDoc(null), onOpenDoc: openTheDoc, onDuplicate: (id) => setOpenDoc({ type: openDoc.type, id }), onGroq: runGroq })
      : tab === 'content'
        ? (openType && mode === 'new' ? h(NewDocument, { host, san, type: openType, schema: schema.data, seed, onCreated: (id) => { setMode(null); setSeed(null); health.reload(true); setOpenDoc({ type: openType, id }); }, onCancel: () => { setMode(null); setSeed(null); } })
          : openType && mode === 'generate' ? h(Generate, { host, san, type: openType, schema: schema.data, onCreated: (id) => { setMode(null); health.reload(true); insights.reload(); if (id) setOpenDoc({ type: openType, id }); }, onCancel: () => setMode(null) })
          : openType && mode === 'replace' ? h(FindReplace, { host, san, type: openType, schema: schema.data, onDone: () => { setMode(null); health.reload(true); insights.reload(); }, onCancel: () => setMode(null) })
          : openType && mode === 'export' ? h(ExportType, { host, san, type: openType, onCancel: () => setMode(null) })
          : openType ? h(Documents, { host, san, project, type: openType, typeRow, q: filtered, onOpen: (id) => setOpenDoc({ type: openType, id }) })
          : h(Types, { host, health, q: filtered, onOpen: (t) => { setOpenType(t); setMode(null); } }))
      : tab === 'insights' ? h(Insights, { host, insights, q: filtered, onOpen: openTheDoc })
      : tab === 'assets' ? h(Assets, { host, san, project, health, q: filtered, selected: openAsset, onSelect: setOpenAsset })
      : tab === 'groq' ? h(Groq, { host, san, project, health, seed: groqSeed, onOpenDoc: openTheDoc })
      : tab === 'studio' ? h(Studio, { host, san, project, current, health, q: filtered })
      : tab === 'ask' ? h(Ask, { host, api: API, project, health, onOpen: openTheDoc })
      : tab === 'projects' ? h(Projects, { host, api: API, projects, current: project, onChanged: loadProjects, onPick: (n) => setProject(n) })
      : h(Overview, { host, health, insights, q: filtered, onOpenDoc: openTheDoc, onOpenType: (t) => { setTab('content'); setOpenType(t); setMode(null); }, onAction: (a) => { if (a === 'insights') setTab('insights'); else if (a === 'assets') setTab('assets'); else if (a === 'ask') setTab('ask'); else if (a === 'groq') setTab('groq'); else if (a === 'studio') setTab('studio'); } }));

  const right = openDoc
    ? h(DocumentAside, { host, san, project, current, open: openDoc, doc, schema, onOpenDoc: openTheDoc, onGroq: runGroq })
    : tab === 'content' && openType ? h(TypeTools, { host, san, type: openType, typeRow, schema: schema.data, mode, setMode: (m) => { setSeed(null); setMode(m); }, onGroq: runGroq })
    : tab === 'content' ? h(ContentAside, { host, health, openType, onOpenType: (t) => { setOpenType(t); setMode(null); }, onOpenDoc: openTheDoc })
    : tab === 'insights' ? h(InsightsAside, { host, insights, onOpen: openTheDoc })
    : tab === 'assets' ? h(AssetsAside, { host, san, project, health, selected: openAsset, onOpenDoc: openTheDoc, onChanged: () => setOpenAsset(openAsset ? { ...openAsset, _bump: Date.now() } : null), onCleared: () => setOpenAsset(null) })
    : tab === 'groq' ? h(GroqAside, { host, health, onRun: (query) => setGroqSeed({ query, at: Date.now() }) })
    : tab === 'studio' ? h(StudioAside, { host, current, health })
    : tab === 'projects' ? h(ProjectsAside, { host })
    : h(OverviewAside, { host, health, insights, onOpenDoc: openTheDoc, onOpenType: (t) => { setTab('content'); setOpenType(t); } });

  return h(ui.Regions, { left, right, paneId: `san-${tab}`, paneLabel: openDoc ? 'This document' : tab === 'content' && openType ? 'This type' : tab === 'content' ? 'Types' : tab === 'insights' ? 'By type' : tab === 'assets' ? 'This asset' : tab === 'groq' ? 'Queries' : tab === 'studio' ? 'Repository' : tab === 'projects' ? 'How it works' : 'Attention' },
    h('div', { className: 'san-main', style: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 57px)' } }, h('div', { style: { padding: '32px 16px 0', flex: 'none' } }, header), main));
}

Sanity.cadenceComponent = true;
export default Sanity;
