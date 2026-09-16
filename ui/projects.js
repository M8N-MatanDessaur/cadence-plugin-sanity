/**
 * Projects: the Sanity projects this workspace knows. Each has a project id, a dataset, an API
 * token (typed once, never shown again), a repository (so the screen can follow the shell),
 * a Studio URL, and environments with the site's URL. Test reads the dataset with the token.
 */
import { Panel, Stat, List, ListRow } from './kit.js';

const blankEnv = () => ({ id: '', label: '', url: '', localPort: '' });

function ProjectForm({ host, api: API, initial, onDone, onCancel }) {
  const { h, ui, api, notify } = host;
  const { useState, useEffect } = host.react;
  const editing = !!initial;
  const [name, setName] = useState(initial ? initial.name : '');
  const [projectId, setProjectId] = useState(initial ? initial.projectId || '' : '');
  const [dataset, setDataset] = useState(initial ? initial.dataset || '' : 'production');
  const [datasets, setDatasets] = useState(null);
  const [apiToken, setApiToken] = useState('');
  const [repoPath, setRepoPath] = useState(initial ? initial.repoPath || '' : '');
  const [studioUrl, setStudioUrl] = useState(initial ? initial.studioUrl || '' : '');
  const [envs, setEnvs] = useState(initial && (initial.environments || []).length ? initial.environments.map((e) => ({ ...e })) : [{ ...blankEnv(), id: 'production', label: 'Production' }]);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);
  useEffect(() => { if (editing && initial.apiTokenSet) api(`${API}/datasets?project=${encodeURIComponent(initial.name)}`).then((d) => setDatasets(d.datasets || [])).catch(() => setDatasets([])); }, [editing && initial.name]);
  const setEnv = (i, patch) => setEnvs(envs.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const pickRepo = async () => { if (!host.pickTarget) return; const t = await host.pickTarget({ title: 'Which repository is this project for?', detail: 'The screen follows the shell that is on it.' }); if (t) { setRepoPath(t.path); if (!name) setName(t.repo); } };
  const save = async () => {
    if (!name.trim()) return notify('Give the project a name', 'rosin');
    if (!projectId.trim() || !dataset.trim()) return notify('Project id and dataset are required', 'rosin');
    if (!editing && !apiToken.trim()) return notify('An API token is required', 'rosin');
    setBusy(true);
    try {
      const body = { name: name.trim(), projectId: projectId.trim(), dataset: dataset.trim(), repoPath, studioUrl, environments: envs.filter((e) => e.label.trim()) };
      if (apiToken.trim()) body.apiToken = apiToken.trim();
      if (editing) await api(`${API}/projects/${encodeURIComponent(initial.name)}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api(`${API}/projects`, { method: 'POST', body: JSON.stringify(body) });
      notify(editing ? 'Project updated' : 'Project added', 'moss'); onDone(name.trim());
    } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(false); }
  };
  const runTest = async () => { if (!editing) return; setTest('...'); try { const r = await api(`${API}/test?project=${encodeURIComponent(initial.name)}`); setTest(r.ok ? `ok - ${r.documents} documents readable` : r.error || 'failed'); } catch (e) { setTest(e.message); } };
  return Panel(host, { title: editing ? `Edit ${initial.name}` : 'New project', wide: true, action: h('span', { className: 'mpanel__meta' }, 'the token stays on this machine') },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h('div', { className: 'san-row3' },
        h(ui.Field, { label: 'Name', hint: 'as you call it here' }, h(ui.Input, { value: name, placeholder: 'My site', onChange: (e) => setName(e.target.value) })),
        h(ui.Field, { label: 'Project id', hint: 'from sanity.io/manage' }, h(ui.Input, { value: projectId, placeholder: 'abc123xy', onChange: (e) => setProjectId(e.target.value) })),
        h(ui.Field, { label: 'Dataset' }, datasets && datasets.length ? h(ui.Select, { value: dataset, onChange: (e) => setDataset(e.target.value) }, [...new Set([dataset, ...datasets.map((d) => d.name)])].filter(Boolean).map((d) => h('option', { key: d, value: d }, d))) : h(ui.Input, { value: dataset, placeholder: 'production', onChange: (e) => setDataset(e.target.value) }))),
      h(ui.Field, { label: editing && initial.apiTokenSet ? 'API token (blank keeps the stored one)' : 'API token', hint: 'an Editor token from sanity.io/manage > API > Tokens; it reads drafts and writes' }, h(ui.Input, { type: 'password', value: apiToken, placeholder: 'sk...', onChange: (e) => setApiToken(e.target.value) })),
      h('div', { className: 'san-row2' },
        h(ui.Field, { label: 'Repository', hint: 'the local checkout with the Studio schema' }, h('div', { style: { display: 'flex', gap: 8 } }, h(ui.Input, { value: repoPath, placeholder: 'C:\\Code\\...', onChange: (e) => setRepoPath(e.target.value), style: { flex: 1 } }), host.pickTarget ? h(ui.Button, { onClick: pickRepo }, 'Choose...') : null)),
        h(ui.Field, { label: 'Studio URL', hint: 'to deep-link documents' }, h(ui.Input, { value: studioUrl, placeholder: 'https://my-site.com/studio', onChange: (e) => setStudioUrl(e.target.value) }))),
      h('div', { className: 'mpanel__meta' }, 'Environments (where the site runs, for previews)'),
      envs.map((e, i) => h('div', { key: i, style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, alignItems: 'end', padding: '8px 0', borderTop: '1px solid var(--sy-line)' } },
        h(ui.Field, { label: 'Label' }, h(ui.Input, { value: e.label, placeholder: 'Production', onChange: (ev) => setEnv(i, { label: ev.target.value, id: e.id || ev.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') }) })),
        h(ui.Field, { label: 'Site URL' }, h(ui.Input, { value: e.url, placeholder: 'https://www.example.com', onChange: (ev) => setEnv(i, { url: ev.target.value }) })),
        h(ui.Field, { label: 'Local port' }, h(ui.Input, { value: e.localPort, placeholder: '3000', onChange: (ev) => setEnv(i, { localPort: ev.target.value }) })),
        h('div', null, envs.length > 1 ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setEnvs(envs.filter((_, k) => k !== i)) }, 'Remove') : null))),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => setEnvs([...envs, blankEnv()]) }, 'Add an environment'),
        editing && initial.apiTokenSet ? h(ui.Button, { className: 'sy-btn--sm', onClick: runTest }, 'Test the token') : null,
        test ? h('span', { className: 'mpanel__meta', style: { color: /^ok/.test(test) ? 'var(--sy-moss)' : 'var(--sy-rosin)' } }, test) : null,
        h('span', { style: { flex: 1 } }),
        h(ui.Button, { onClick: onCancel }, 'Cancel'),
        h(ui.Button, { variant: 'primary', disabled: busy, onClick: save }, busy ? 'Saving...' : editing ? 'Save' : 'Add the project'))));
}

export function Projects({ host, api: API, projects, current, onChanged, onPick }) {
  const { h, ui, api, notify } = host;
  const { useState } = host.react;
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const list = projects || [];
  const remove = async (name) => { try { await api(`${API}/projects/${encodeURIComponent(name)}`, { method: 'DELETE' }); notify(`${name} forgotten`, 'moss'); setConfirm(null); onChanged(); } catch (e) { notify(e.message, 'rosin'); } };
  const complete = (p) => p.projectId && p.dataset && p.apiTokenSet;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Projects', value: projects === null ? '...' : list.length, tone: 'brass' }),
      Stat(host, { label: 'With a repository', value: projects === null ? '...' : list.filter((p) => p.repoPath).length, tone: 'muted', hint: 'follow the shell' }),
      Stat(host, { label: 'Environments', value: projects === null ? '...' : list.reduce((n, p) => n + (p.environments || []).length, 0), tone: 'muted' }),
      Stat(host, { label: 'Incomplete', value: projects === null ? '...' : list.filter((p) => !complete(p)).length, tone: list.some((p) => !complete(p)) ? 'rosin' : 'moss', hint: 'missing id, dataset or token' })),
    form !== null ? h(ProjectForm, { host, api: API, initial: form === 'new' ? null : form, onDone: (n) => { setForm(null); onChanged(); onPick(n); }, onCancel: () => setForm(null) })
      : Panel(host, { title: 'Projects', wide: true, action: h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', onClick: () => setForm('new') }, 'New project') },
        projects === null ? h(ui.Skeleton, { count: 3, height: 18 }) : list.length ? List(host, list.map((p) => ListRow(host, { key: p.name, lead: h('span', { className: 'mind-dot', style: { background: p.name === current ? 'var(--sy-brass)' : complete(p) ? 'var(--sy-text-3)' : 'var(--sy-rosin)' } }), label: p.name, sub: `${p.projectId || 'no id'} / ${p.dataset || 'no dataset'}${p.apiTokenSet ? '' : ' - no token'} - ${p.repoPath || 'no repository'} - ${(p.environments || []).map((e) => `${e.label}${e.url || e.localPort ? '' : ' (no URL)'}`).join(', ')}`, meta: h('span', { style: { display: 'flex', gap: 6 } }, p.name !== current ? h('button', { type: 'button', className: 'sy-btn sy-btn--sm', onClick: (e) => { e.stopPropagation(); onPick(p.name); } }, 'Use') : null, h('button', { type: 'button', className: 'sy-btn sy-btn--sm', onClick: (e) => { e.stopPropagation(); setForm(p); } }, 'Edit'), confirm === p.name ? h('button', { type: 'button', className: 'sy-btn sy-btn--sm', style: { color: 'var(--sy-rosin)' }, onClick: (e) => { e.stopPropagation(); remove(p.name); } }, 'Yes, forget it') : h('button', { type: 'button', className: 'sy-btn sy-btn--sm', onClick: (e) => { e.stopPropagation(); setConfirm(p.name); } }, 'Forget')), onClick: () => onPick(p.name) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No project yet. Add one with its token.')));
}

export function ProjectsAside({ host }) {
  const { h } = host;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'How projects work' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'A project is one Sanity project and dataset with an API token. Give it the repository that holds the Studio schema and every Sanity screen follows the shell that is on that repository, and reads the schema to draw documents field by field. Environments hold the site URL used for previews. The token is typed once and never shown again; forgetting a project only removes it from this machine.')),
    Panel(host, { title: 'The token' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'Create it at sanity.io/manage under API > Tokens. Editor lets this plugin read drafts, save, publish and delete. Viewer only reads published content. Deploy Studio or Deploy tokens will not do.')));
}
