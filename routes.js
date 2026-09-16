/**
 * Sanity.io Plugin -- Server-side API Routes
 *
 * Proxies the Sanity Content Lake (GROQ queries, mutations, history) and reads the Studio's
 * schema out of the repository, so a document can be shown field by field, edited as a
 * draft, published, and audited without opening the Studio.
 *
 * Supports several projects. Every request may name the project it wants with
 * ?project=<name> or ?repo=<path>; without either, the stored active project answers.
 * API tokens live in config.json beside this file and never reach the browser.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const schemaParser = require('./schema-parser.js');

const configPath = path.join(__dirname, 'config.json');
const API_VERSION = '2024-01-01';
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.next', 'out', 'build', 'static', '.cache', '.vercel', '.netlify', '.turbo', '__pycache__', 'coverage', '.sanity']);
const SYSTEM = '!(_type match "system.*") && !(_type match "sanity.*")';
const STALE_DAYS = 90;

// -- Config helpers (multi-project) -------------------------------------------

function readAllCfg() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (raw.projectId !== undefined && !raw.projects) {
      const legacy = { name: raw.projectId || 'My Project', projectId: raw.projectId || '', dataset: raw.dataset || '', apiToken: raw.apiToken || '' };
      const migrated = { projects: legacy.projectId ? [legacy] : [], activeProject: legacy.projectId ? legacy.name : '' };
      saveAllCfg(migrated);
      return migrated;
    }
    return { projects: Array.isArray(raw.projects) ? raw.projects : [], activeProject: raw.activeProject || '' };
  } catch (_) {
    return { projects: [], activeProject: '' };
  }
}

function saveAllCfg(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
}

// The project a request asked for, by name or by repository path; set at the top of the
// request handler and read synchronously by getPluginConfig() before the first await.
let requestProject = null;
const normPath = (v) => String(v || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
function projectForRepo(all, repoPath) {
  const want = normPath(repoPath);
  if (!want) return null;
  return all.projects.find(p => p.repoPath && normPath(p.repoPath) === want)
    || all.projects.find(p => p.repoPath && (want.startsWith(normPath(p.repoPath) + '/') || normPath(p.repoPath).startsWith(want + '/')))
    || null;
}

function getActiveProject(all) {
  const a = all || readAllCfg();
  if (!a.projects.length) return null;
  if (requestProject) {
    const byName = a.projects.find(p => p.name === requestProject.name);
    if (byName) return byName;
    const byRepo = projectForRepo(a, requestProject.repo);
    if (byRepo) return byRepo;
  }
  const active = a.projects.find(p => p.name === a.activeProject);
  return active || a.projects[0] || null;
}

function getPluginConfig() {
  const proj = getActiveProject();
  return proj || { projectId: '', dataset: '', apiToken: '' };
}

function isConfigured(cfg) {
  return !!(cfg.projectId && cfg.dataset && cfg.apiToken);
}

function slugifyEnvId(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'env';
}

function normalizeEnvironments(p) {
  if (Array.isArray(p.environments) && p.environments.length) {
    return p.environments.map(function (e) {
      var label = e.label || e.id || 'Env';
      return { id: e.id || slugifyEnvId(label), label: label, url: e.url || '', localPort: e.localPort || '' };
    });
  }
  var out = [];
  var prodUrl = p.prodUrl || p.previewUrl || '';
  if (prodUrl) out.push({ id: 'production', label: 'Production', url: prodUrl, localPort: '' });
  if (p.stagingUrl) out.push({ id: 'staging', label: 'Staging', url: p.stagingUrl, localPort: '' });
  if (p.localPort) out.push({ id: 'local', label: 'Local', url: '', localPort: p.localPort });
  if (!out.length) out.push({ id: 'production', label: 'Production', url: '', localPort: '' });
  return out;
}

function sanitizeEnvironments(raw) {
  if (!Array.isArray(raw)) return null;
  var seen = {};
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var e = raw[i] || {};
    var label = String(e.label || '').trim();
    if (!label) continue;
    var id = String(e.id || '').trim() || slugifyEnvId(label);
    var base = id, n = 2;
    while (seen[id]) { id = base + '-' + n++; }
    seen[id] = true;
    out.push({ id: id, label: label, url: e.url ? String(e.url).trim().replace(/\/+$/, '') : '', localPort: e.localPort ? String(e.localPort).trim() : '' });
  }
  return out;
}

function getActiveEnv(p) {
  var envs = normalizeEnvironments(p);
  return envs.find(function (e) { return e.id === p.activeEnv; }) || envs[0];
}

function resolveEnvUrl(env) {
  if (!env) return '';
  if (env.localPort) return 'http://localhost:' + env.localPort;
  return env.url || '';
}

function resolvePreviewUrl(cfg) {
  return resolveEnvUrl(getActiveEnv(cfg));
}

function getEnvFields(p) {
  var envs = normalizeEnvironments(p);
  var active = envs.find(function (e) { return e.id === p.activeEnv; }) || envs[0];
  return { environments: envs, activeEnv: active ? active.id : '', previewUrl: resolveEnvUrl(active) };
}

/** What a project looks like from outside: everything but the token. */
function publicProject(p) {
  return {
    name: p.name,
    projectId: p.projectId,
    dataset: p.dataset,
    apiTokenSet: !!p.apiToken,
    ...getEnvFields(p),
    repoPath: p.repoPath || '',
    studioUrl: p.studioUrl || '',
  };
}

// -- Sanity HTTP --------------------------------------------------------------

function sanityUrl(cfg, endpoint) {
  return `https://${cfg.projectId}.api.sanity.io/v${API_VERSION}/${endpoint}`;
}

function httpsJson(urlStr, options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts = { hostname: url.hostname, path: url.pathname + url.search, port: url.port || 443, ...options };
    const req = https.request(opts, (resp) => {
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, data: JSON.parse(data) }); }
        catch (_) { resolve({ status: resp.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('Sanity did not answer in 60s')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function sanityQuery(cfg, groq, params) {
  const qs = new URLSearchParams({ query: groq });
  if (params) for (const [k, v] of Object.entries(params)) qs.set('$' + k, JSON.stringify(v));
  const q = qs.toString();
  // Long queries go as POST so the URL never overflows.
  if (q.length > 6000) {
    return httpsJson(sanityUrl(cfg, 'data/query/' + cfg.dataset), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiToken}` } }, { query: groq, params: params || {} });
  }
  return httpsJson(`${sanityUrl(cfg, 'data/query/' + cfg.dataset)}?${q}`, { method: 'GET', headers: { 'Authorization': `Bearer ${cfg.apiToken}` } });
}

async function sanityMutate(cfg, mutations, opts = {}) {
  const qs = new URLSearchParams();
  if (opts.returnDocuments !== undefined) qs.set('returnDocuments', String(opts.returnDocuments));
  if (opts.returnIds !== undefined) qs.set('returnIds', String(opts.returnIds));
  if (opts.dryRun) qs.set('dryRun', 'true');
  const qstr = qs.toString();
  return httpsJson(`${sanityUrl(cfg, 'data/mutate/' + cfg.dataset)}${qstr ? '?' + qstr : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiToken}` },
  }, { mutations });
}

const errOf = (r, fallback) => (r.data && (r.data.message || (r.data.error && (r.data.error.description || r.data.error.message)) || r.data.error)) || fallback;
const result = (r) => (r.data && r.data.result !== undefined ? r.data.result : null);

/** Every document of a filter, page by page, up to a cap. */
async function fetchAll(cfg, filter, projection, cap, params) {
  const all = [];
  let offset = 0;
  const page = 200;
  while (all.length < cap) {
    const r = await sanityQuery(cfg, `*[${filter}] | order(_updatedAt desc) [${offset}...${offset + page}]${projection || ''}`, params);
    if (r.status >= 400) throw new Error(errOf(r, 'Query failed'));
    const batch = result(r) || [];
    all.push(...batch);
    if (batch.length < page) break;
    offset += page;
  }
  return all.slice(0, cap);
}

// -- Document helpers ---------------------------------------------------------

const baseId = (id) => String(id || '').replace(/^drafts\./, '');
const draftId = (id) => 'drafts.' + baseId(id);
const titleOf = (d) => (d && (d.title || d.name || d.heading || d.headline || d.label || (d.seo && d.seo.title) || (d.slug && d.slug.current) || d._id)) || '';
const slugOf = (d) => (d && d.slug ? (typeof d.slug === 'string' ? d.slug : d.slug.current || '') : '');
const newKey = () => crypto.randomBytes(6).toString('hex');
const newId = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

/** Groups published and draft versions into one row per document. */
function groupVersions(docs) {
  const map = new Map();
  for (const d of docs) {
    const id = baseId(d._id);
    const row = map.get(id) || { id, type: d._type, published: null, draft: null };
    if (d._id.startsWith('drafts.')) row.draft = d; else row.published = d;
    map.set(id, row);
  }
  const rows = [];
  for (const row of map.values()) {
    const doc = row.draft || row.published;
    const status = row.draft && row.published ? 'changed' : row.draft ? 'draft' : 'published';
    rows.push({
      id: row.id,
      type: doc._type,
      title: titleOf(doc),
      slug: slugOf(doc),
      status,
      hasDraft: !!row.draft,
      hasPublished: !!row.published,
      updatedAt: doc._updatedAt,
      createdAt: (row.published || row.draft)._createdAt,
      publishedAt: row.published ? row.published._updatedAt : null,
    });
  }
  rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return rows;
}

function collectRefs(obj, out, pathStr) {
  if (!obj || typeof obj !== 'object') return;
  if (obj._ref) { out.push({ ref: obj._ref, path: pathStr }); return; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => collectRefs(v, out, `${pathStr}[${i}]`)); return; }
  for (const [k, v] of Object.entries(obj)) if (k !== '_system') collectRefs(v, out, pathStr ? `${pathStr}.${k}` : k);
}

/** Images inside a document that carry an asset but no alt text next to it. */
function imagesMissingAlt(obj, out, pathStr) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach((v, i) => imagesMissingAlt(v, out, `${pathStr}[${i}]`)); return; }
  if (obj.asset && obj.asset._ref && /^image-/.test(obj.asset._ref)) {
    const alt = obj.alt || obj.altText || obj.alternativeText || obj.caption;
    if (!alt || !String(alt).trim()) out.push({ path: pathStr, ref: obj.asset._ref });
  }
  for (const [k, v] of Object.entries(obj)) if (k !== 'asset' && k !== '_system') imagesMissingAlt(v, out, pathStr ? `${pathStr}.${k}` : k);
}

/** A field's type guessed from a value, for types the repository does not declare. */
function inferType(v) {
  if (v === null || v === undefined) return 'string';
  if (typeof v === 'string') return v.length > 140 ? 'text' : /^\d{4}-\d{2}-\d{2}T/.test(v) ? 'datetime' : /^\d{4}-\d{2}-\d{2}$/.test(v) ? 'date' : 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (Array.isArray(v)) return 'array';
  if (v._type === 'slug') return 'slug';
  if (v._type === 'image' || (v.asset && v.asset._ref && /^image-/.test(v.asset._ref))) return 'image';
  if (v._type === 'file' || (v.asset && v.asset._ref && /^file-/.test(v.asset._ref))) return 'file';
  if (v._type === 'reference' || v._ref) return 'reference';
  if (v._type === 'geopoint') return 'geopoint';
  return 'object';
}

function inferFields(docs) {
  const fields = new Map();
  for (const d of docs) {
    for (const [k, v] of Object.entries(d)) {
      if (k.startsWith('_')) continue;
      const f = fields.get(k) || { name: k, title: '', type: inferType(v), inferred: true, seen: 0 };
      f.seen++;
      if (f.type === 'string' && (v !== null && v !== undefined)) f.type = inferType(v);
      if (f.type === 'array' && Array.isArray(v) && v.length && !f.of) {
        const kinds = [...new Set(v.map((x) => (x && typeof x === 'object' ? (x._type === 'block' ? 'block' : x._type || inferType(x)) : typeof x === 'string' ? 'string' : inferType(x))))];
        f.of = kinds.map((t) => ({ type: t }));
      }
      if (f.type === 'object' && v && typeof v === 'object' && !f.fields) f.fields = inferFields([v]);
      fields.set(k, f);
    }
  }
  return [...fields.values()];
}

// -- Schema (from the repository, cached a minute) ---------------------------

const schemaCache = new Map();
function readRepoSchema(cfg, refresh) {
  const repoPath = cfg.repoPath || '';
  if (!repoPath || !fs.existsSync(repoPath)) return { documents: [], objects: {}, files: [], count: 0, repoPath: '' };
  const key = normPath(repoPath);
  const cached = schemaCache.get(key);
  if (!refresh && cached && Date.now() - cached.ts < 60000) return cached.data;
  const data = schemaParser.readSchema(repoPath);
  data.repoPath = repoPath;
  schemaCache.set(key, { ts: Date.now(), data });
  return data;
}

/** One type, fields from the code first, then anything the documents hold that the code does not name. */
async function typeSchema(cfg, typeName, refresh) {
  const repo = readRepoSchema(cfg, refresh);
  const coded = repo.documents.find((d) => d.name === typeName);
  let fields = coded ? schemaParser.resolveType(coded, repo.objects).fields : [];
  let sample = [];
  try { sample = await fetchAll(cfg, `_type == $type`, '', 25, { type: typeName }); } catch (_) {}
  const inferred = inferFields(sample);
  const known = new Set(fields.map((f) => f.name));
  const extra = inferred.filter((f) => !known.has(f.name));
  fields = fields.filter((f) => !f.hidden).concat(extra);
  const objects = {};
  for (const [name, o] of Object.entries(repo.objects)) objects[name] = schemaParser.resolveType(o, repo.objects);
  return { name: typeName, title: coded ? coded.title || typeName : typeName, source: coded ? 'code' : sample.length ? 'documents' : 'none', file: coded ? coded.file : '', fields, objects, sampleSize: sample.length };
}

// -- Health (cached a minute per project) -------------------------------------

const healthCache = new Map();
async function buildHealth(cfg, refresh) {
  const key = `${cfg.projectId}|${cfg.dataset}`;
  const cached = healthCache.get(key);
  if (!refresh && cached && Date.now() - cached.ts < 60000) return cached.data;
  const [typesR, draftsR, recentR, assetsR] = await Promise.all([
    sanityQuery(cfg, `*[${SYSTEM} && defined(_type)]{_id, _type, _updatedAt}`),
    sanityQuery(cfg, `*[_id in path("drafts.**") && ${SYSTEM}]{_id, _type, _updatedAt}`),
    sanityQuery(cfg, `*[${SYSTEM}] | order(_updatedAt desc) [0...12]{_id, _type, title, name, heading, headline, slug, _updatedAt, _createdAt}`),
    sanityQuery(cfg, `{"images": count(*[_type == "sanity.imageAsset"]), "files": count(*[_type == "sanity.fileAsset"])}`),
  ]);
  if (typesR.status >= 400) throw new Error(errOf(typesR, 'Query failed'));
  const all = result(typesR) || [];
  const drafts = result(draftsR) || [];
  const staleAt = Date.now() - STALE_DAYS * 86400000;
  const perType = {};
  const draftIds = new Set(drafts.map((d) => baseId(d._id)));
  for (const d of all) {
    const t = perType[d._type] || (perType[d._type] = { name: d._type, total: 0, published: 0, drafts: 0, changed: 0, stale: 0, lastUpdated: null });
    if (d._id.startsWith('drafts.')) continue;
    t.total++; t.published++;
    if (draftIds.has(d._id)) t.changed++;
    else if (d._updatedAt && new Date(d._updatedAt).getTime() < staleAt) t.stale++;
    if (!t.lastUpdated || d._updatedAt > t.lastUpdated) t.lastUpdated = d._updatedAt;
  }
  const publishedIds = new Set(all.filter((d) => !d._id.startsWith('drafts.')).map((d) => d._id));
  for (const d of drafts) {
    const t = perType[d._type] || (perType[d._type] = { name: d._type, total: 0, published: 0, drafts: 0, changed: 0, stale: 0, lastUpdated: null });
    if (!publishedIds.has(baseId(d._id))) { t.total++; t.drafts++; }
    if (!t.lastUpdated || d._updatedAt > t.lastUpdated) t.lastUpdated = d._updatedAt;
  }
  const repo = readRepoSchema(cfg, refresh);
  const codedTypes = new Set(repo.documents.map((d) => d.name));
  for (const d of repo.documents) if (!perType[d.name]) perType[d.name] = { name: d.name, total: 0, published: 0, drafts: 0, changed: 0, stale: 0, lastUpdated: null };
  const types = Object.values(perType).map((t) => {
    const coded = repo.documents.find((d) => d.name === t.name);
    return { ...t, title: coded ? coded.title || t.name : t.name, inCode: codedTypes.has(t.name), fieldCount: coded ? (coded.fields || []).length : 0, singleton: t.total === 1 && !slugOf(all.find((d) => d._type === t.name) || {}) && /^(header|footer|siteSettings|settings|navigation|nav|home|homepage)$/i.test(t.name) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const totalDocs = types.reduce((n, t) => n + t.total, 0);
  const totalDrafts = types.reduce((n, t) => n + t.drafts, 0);
  const totalChanged = types.reduce((n, t) => n + t.changed, 0);
  const totalStale = types.reduce((n, t) => n + t.stale, 0);
  const recent = groupVersions(result(recentR) || []).slice(0, 10);
  const assets = result(assetsR) || {};
  const issues = [];
  if (totalDrafts) issues.push({ level: 'info', issue: 'draft', message: `${totalDrafts} document${totalDrafts === 1 ? ' is' : 's are'} unpublished.` });
  if (totalChanged) issues.push({ level: 'warn', issue: 'changed', message: `${totalChanged} published document${totalChanged === 1 ? ' has' : 's have'} unpublished changes.` });
  if (totalStale) issues.push({ level: 'warn', issue: 'stale', message: `${totalStale} published document${totalStale === 1 ? '' : 's'} not touched in ${STALE_DAYS} days.` });
  const emptyTypes = types.filter((t) => !t.total);
  if (emptyTypes.length) issues.push({ level: 'info', issue: 'empty', message: `${emptyTypes.length} type${emptyTypes.length === 1 ? '' : 's'} in the code with no document: ${emptyTypes.map((t) => t.name).join(', ')}` });
  const notInCode = types.filter((t) => !t.inCode && repo.documents.length);
  if (notInCode.length) issues.push({ level: 'info', issue: 'orphan', message: `${notInCode.length} type${notInCode.length === 1 ? '' : 's'} with documents but no schema in the repository: ${notInCode.map((t) => t.name).join(', ')}` });
  const data = {
    name: cfg.name || '',
    projectId: cfg.projectId,
    dataset: cfg.dataset,
    ...getEnvFields(cfg),
    repoPath: cfg.repoPath || '',
    studioUrl: cfg.studioUrl || '',
    types,
    totalDocuments: totalDocs,
    totalTypes: types.length,
    totalDrafts,
    totalChanged,
    totalStale,
    draftsCount: totalDrafts + totalChanged,
    assets,
    recent,
    issues,
    schema: { documents: repo.documents.length, objects: Object.keys(repo.objects).length, files: repo.files.length, repoPath: repo.repoPath },
  };
  healthCache.set(key, { ts: Date.now(), data });
  return data;
}

// -- Route Registration -------------------------------------------------------


// ---- Attention: what the Plugins home shows on this app's tile. Reads the plugin's own
// routes over loopback (they carry their caches), never writes, answers within a minute.
const __attention = { value: null, until: 0 };
function __selfGet(req, path, timeoutMs) {
  return new Promise((resolve) => {
    const host = req.headers.host || `127.0.0.1:${process.env.CADENCE_PORT || 3801}`;
    const lib = require('http');
    const r = lib.get({ host: host.split(':')[0], port: Number(host.split(':')[1] || 80), path, headers: { 'x-cadence-internal': '1' } }, (resp) => { let d = ''; resp.on('data', (c) => { d += c; }); resp.on('end', () => { try { resolve(resp.statusCode < 400 ? JSON.parse(d) : null); } catch (_) { resolve(null); } }); });
    r.on('error', () => resolve(null));
    r.setTimeout(timeoutMs || 45000, () => { r.destroy(); resolve(null); });
  });
}
function __attentionOut(items) {
  const rank = { error: 3, warn: 2, warning: 2, info: 1 };
  const list = (items || []).filter((i) => i && i.text).map((i) => ({ level: i.level === 'warning' ? 'warn' : (i.level || 'info'), text: String(i.text) }));
  const level = list.reduce((top, i) => (rank[i.level] > rank[top] ? i.level : top), list.length ? 'info' : 'ok');
  return { count: list.length, level, items: list, readAt: new Date().toISOString() };
}
async function __attentionHandler(req, res, url, compute, json) {
  if (__attention.value && __attention.until > Date.now() && url.searchParams.get('refresh') !== '1') return json(res, __attention.value);
  let out;
  try { out = __attentionOut(await compute(req)); } catch (e) { out = { count: 0, level: 'ok', items: [], error: e.message, readAt: new Date().toISOString() }; }
  __attention.value = out; __attention.until = Date.now() + 60000;
  return json(res, out);
}

module.exports = function ({ addRoute, addPrefixRoute, json, readBody, shell }) {
  addRoute('GET', '/attention', (req, res, url) => __attentionHandler(req, res, url, async (req) => { const h = await __selfGet(req, '/api/plugins/sanity/health'); return (h && h.issues || []).map((i) => ({ level: i.level, text: i.message })); }, json));
  const permGate = shell && typeof shell.permGate === 'function' ? shell.permGate : null;
  const gate = async (res, route, label) => (permGate ? permGate(res, 'api', route, label) : true);

  addPrefixRoute(async (req, res, url, subpath) => {
    const method = req.method;
    requestProject = (url.searchParams.get('project') || url.searchParams.get('repo')) ? { name: url.searchParams.get('project') || '', repo: url.searchParams.get('repo') || '' } : null;

    try {
      // -- The @sanity handle's search --------------------------------------------
      // "@sanity pricing page" in the palette, or an Ask Cadence question about something,
      // arrives here and is answered in the shape every handle shares: a GROQ match on the
      // words across every non-system type, drafts folded onto their published document.
      if (subpath === '/search' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { items: [] });
        const q = String(url.searchParams.get('q') || '').trim();
        const limit = Math.max(1, Math.min(25, Number(url.searchParams.get('limit')) || 8));
        if (!q) return json(res, { items: [] });
        const words = q.split(/\s+/).filter(Boolean).map((w) => `${w.replace(/["*]/g, '')}*`);
        // A title is often a localised object; the common locale keys are matched alongside the plain fields, and the type name too.
        const match = words.map((w, i) => `(_type match $w${i} || title match $w${i} || title.en match $w${i} || title.fr match $w${i} || name match $w${i} || heading match $w${i} || headline match $w${i} || slug.current match $w${i} || _id == $q)`).join(' && ');
        const params = { q };
        words.forEach((w, i) => { params[`w${i}`] = w; });
        const docs = await sanityQuery(cfg, `*[${SYSTEM} && ${match}][0...${limit * 3}]{_id, _type, _updatedAt, title, name, heading, headline, slug}`, params);
        const found = result(docs);
        const rows = groupVersions(Array.isArray(found) ? found : []);
        const items = rows.slice(0, limit).map((r) => ({
          kind: r.type, id: r.id,
          label: r.title || r.id,
          detail: [cfg.name, r.type, r.status].filter(Boolean).join(' - '),
          open: { surface: 'sanity', target: { type: r.type, id: r.id, project: cfg.name } },
          score: 0.7,
        }));
        return json(res, { items });
      }

      // -- Config (legacy compat + active project info) -------------------------
      if (subpath === '/config' && method === 'GET') {
        const cfg = getPluginConfig();
        return json(res, { configured: isConfigured(cfg), name: cfg.name || '', projectId: cfg.projectId || '', dataset: cfg.dataset || '', apiTokenSet: !!cfg.apiToken, ...getEnvFields(cfg), repoPath: cfg.repoPath || '', studioUrl: cfg.studioUrl || '' });
      }

      if (subpath === '/config' && method === 'POST') {
        const body = await readBody(req);
        const all = readAllCfg();
        const proj = getActiveProject(all);
        if (!proj) return json(res, { error: 'No active project' }, 400);
        if (body.projectId !== undefined) proj.projectId = body.projectId;
        if (body.dataset !== undefined) proj.dataset = body.dataset;
        if (body.apiToken !== undefined) proj.apiToken = body.apiToken;
        const idx = all.projects.findIndex(p => p.name === proj.name);
        if (idx >= 0) all.projects[idx] = proj;
        saveAllCfg(all);
        return json(res, { ok: true });
      }

      // -- Projects (multi-project management) --------------------------------
      if (subpath === '/projects' && method === 'GET') {
        const all = readAllCfg();
        return json(res, { projects: all.projects.map(publicProject), activeProject: all.activeProject || '' });
      }

      if (subpath === '/projects' && method === 'POST') {
        const body = await readBody(req);
        if (!body.name || !body.projectId || !body.dataset || !body.apiToken) {
          return json(res, { error: 'name, projectId, dataset, and apiToken are all required.' }, 400);
        }
        const all = readAllCfg();
        const name = String(body.name).trim();
        if (all.projects.find(p => p.name === name)) return json(res, { error: 'A project with that name already exists.' }, 409);
        const cleanEnvs = sanitizeEnvironments(body.environments);
        const envs = (cleanEnvs && cleanEnvs.length) ? cleanEnvs : [{ id: 'production', label: 'Production', url: body.prodUrl ? String(body.prodUrl).trim().replace(/\/+$/, '') : '', localPort: body.localPort ? String(body.localPort).trim() : '' }];
        all.projects.push({
          name,
          projectId: String(body.projectId).trim(),
          dataset: String(body.dataset).trim(),
          apiToken: String(body.apiToken),
          environments: envs,
          activeEnv: envs[0].id,
          repoPath: body.repoPath ? String(body.repoPath).trim().replace(/\/+$/, '') : '',
          studioUrl: body.studioUrl ? String(body.studioUrl).trim().replace(/\/+$/, '') : '',
        });
        if (!all.activeProject) all.activeProject = name;
        saveAllCfg(all);
        return json(res, { ok: true });
      }

      if (subpath === '/projects/active' && method === 'POST') {
        const body = await readBody(req);
        if (!body.name) return json(res, { error: 'name is required.' }, 400);
        const all = readAllCfg();
        if (!all.projects.find(p => p.name === body.name)) return json(res, { error: 'Project not found.' }, 404);
        all.activeProject = body.name;
        saveAllCfg(all);
        return json(res, { ok: true, activeProject: body.name });
      }

      if (subpath.startsWith('/projects/') && subpath !== '/projects/active' && (method === 'PUT' || method === 'PATCH')) {
        const projName = decodeURIComponent(subpath.slice('/projects/'.length));
        const body = await readBody(req);
        const all = readAllCfg();
        const idx = all.projects.findIndex(p => p.name === projName);
        if (idx < 0) return json(res, { error: 'Project not found.' }, 404);
        if (body.name !== undefined) {
          const newName = String(body.name).trim();
          if (newName !== projName && all.projects.find(p => p.name === newName)) return json(res, { error: 'A project with that name already exists.' }, 409);
          if (all.activeProject === projName) all.activeProject = newName;
          all.projects[idx].name = newName;
        }
        if (body.projectId !== undefined) all.projects[idx].projectId = String(body.projectId).trim();
        if (body.dataset !== undefined) all.projects[idx].dataset = String(body.dataset).trim();
        // A blank token keeps the stored one; the form never has to show it.
        if (body.apiToken !== undefined && String(body.apiToken)) all.projects[idx].apiToken = String(body.apiToken);
        if (body.environments !== undefined) {
          const clean = sanitizeEnvironments(body.environments);
          if (clean && clean.length) {
            all.projects[idx].environments = clean;
            delete all.projects[idx].prodUrl; delete all.projects[idx].stagingUrl; delete all.projects[idx].localPort; delete all.projects[idx].previewUrl;
            if (!clean.find(function (e) { return e.id === all.projects[idx].activeEnv; })) all.projects[idx].activeEnv = clean[0].id;
          }
        }
        if (body.activeEnv !== undefined) all.projects[idx].activeEnv = String(body.activeEnv);
        if (body.repoPath !== undefined) all.projects[idx].repoPath = String(body.repoPath).trim().replace(/\/+$/, '');
        if (body.studioUrl !== undefined) all.projects[idx].studioUrl = String(body.studioUrl).trim().replace(/\/+$/, '');
        saveAllCfg(all);
        healthCache.clear();
        return json(res, { ok: true });
      }

      if (subpath.startsWith('/projects/') && subpath !== '/projects/active' && method === 'DELETE') {
        const projName = decodeURIComponent(subpath.slice('/projects/'.length));
        const all = readAllCfg();
        const idx = all.projects.findIndex(p => p.name === projName);
        if (idx < 0) return json(res, { error: 'Project not found.' }, 404);
        if (!(await gate(res, 'DELETE /api/plugins/sanity/projects', `Forget the Sanity project ${projName}`))) return;
        all.projects.splice(idx, 1);
        if (all.activeProject === projName) all.activeProject = all.projects.length ? all.projects[0].name : '';
        saveAllCfg(all);
        return json(res, { ok: true, activeProject: all.activeProject });
      }

      // -- Environment Switch ---------------------------------------------------
      if (subpath === '/env' && method === 'POST') {
        const body = await readBody(req);
        if (!body.env) return json(res, { error: 'env is required' }, 400);
        const all = readAllCfg();
        const proj = getActiveProject(all);
        if (!proj) return json(res, { error: 'No active project' }, 400);
        const idx = all.projects.findIndex(p => p.name === proj.name);
        const envs = normalizeEnvironments(all.projects[idx]);
        if (!envs.find(function (e) { return e.id === body.env; })) return json(res, { error: 'Unknown env: ' + body.env }, 400);
        all.projects[idx].activeEnv = body.env;
        saveAllCfg(all);
        healthCache.clear();
        return json(res, { ok: true, activeEnv: body.env, previewUrl: resolvePreviewUrl(all.projects[idx]) });
      }

      // -- Test connection ------------------------------------------------------
      if (subpath === '/test' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { ok: false, error: 'Not configured' });
        try {
          const r = await sanityQuery(cfg, `count(*[${SYSTEM}])`);
          if (r.status >= 400) return json(res, { ok: false, error: errOf(r, `HTTP ${r.status}`) });
          return json(res, { ok: true, projectId: cfg.projectId, dataset: cfg.dataset, documents: result(r) });
        } catch (e) { return json(res, { ok: false, error: e.message }); }
      }

      // -- Project management API (datasets, project info) ----------------------
      if (subpath === '/datasets' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!cfg.projectId || !cfg.apiToken) return json(res, { error: 'Not configured' }, 401);
        const r = await httpsJson(`https://api.sanity.io/v2021-06-07/projects/${cfg.projectId}/datasets`, { method: 'GET', headers: { 'Authorization': `Bearer ${cfg.apiToken}` } });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Could not list datasets (the token may lack project access)') }, r.status);
        return json(res, { datasets: (Array.isArray(r.data) ? r.data : []).map((d) => ({ name: d.name, aclMode: d.aclMode, createdAt: d.createdAt })) });
      }

      if (subpath === '/project-info' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!cfg.projectId || !cfg.apiToken) return json(res, { error: 'Not configured' }, 401);
        const r = await httpsJson(`https://api.sanity.io/v2021-06-07/projects/${cfg.projectId}`, { method: 'GET', headers: { 'Authorization': `Bearer ${cfg.apiToken}` } });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Could not read the project') }, r.status);
        const d = r.data || {};
        return json(res, { id: d.id, displayName: d.displayName, studioHost: d.studioHost || '', organizationId: d.organizationId || '', members: (d.members || []).length, createdAt: d.createdAt, metadata: d.metadata || {} });
      }

      // -- Document Types -------------------------------------------------------
      if (subpath === '/types' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const r = await sanityQuery(cfg, `*[${SYSTEM} && defined(_type) && !(_id in path("drafts.**"))]{_type}`);
        if (r.status >= 400) return json(res, { error: errOf(r, 'Query failed') }, r.status);
        const counts = {};
        for (const doc of (result(r) || [])) counts[doc._type] = (counts[doc._type] || 0) + 1;
        return json(res, Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)));
      }

      // -- Schema (from the repository) ---------------------------------------
      if (subpath === '/schema' && method === 'GET') {
        const cfg = getPluginConfig();
        const refresh = url.searchParams.get('refresh') === '1';
        const typeName = url.searchParams.get('type');
        if (typeName) {
          if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
          return json(res, await typeSchema(cfg, typeName, refresh));
        }
        const repo = readRepoSchema(cfg, refresh);
        return json(res, {
          repoPath: repo.repoPath,
          documents: repo.documents.map((d) => schemaParser.resolveType(d, repo.objects)),
          objects: Object.fromEntries(Object.entries(repo.objects).map(([k, o]) => [k, schemaParser.resolveType(o, repo.objects)])),
          files: repo.files,
        });
      }

      // -- Entries: one row per document, draft and published folded together --
      if (subpath === '/entries' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const typeName = url.searchParams.get('type') || '';
        const q = (url.searchParams.get('q') || '').toLowerCase().trim();
        const status = url.searchParams.get('status') || '';
        const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '50', 10));
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const filter = typeName ? `_type == $type` : SYSTEM;
        const docs = await fetchAll(cfg, filter, '{_id, _type, _updatedAt, _createdAt, title, name, heading, headline, label, slug, seo}', 3000, typeName ? { type: typeName } : undefined);
        let rows = groupVersions(docs);
        const total = rows.length;
        const published = rows.filter((r) => r.hasPublished).length;
        const drafts = rows.filter((r) => r.status === 'draft').length;
        const changed = rows.filter((r) => r.status === 'changed').length;
        if (status === 'published') rows = rows.filter((r) => r.status === 'published');
        else if (status === 'draft') rows = rows.filter((r) => r.status === 'draft');
        else if (status === 'changed') rows = rows.filter((r) => r.status === 'changed');
        else if (status === 'unpublished') rows = rows.filter((r) => r.hasDraft);
        if (q) rows = rows.filter((r) => `${r.title} ${r.slug} ${r.id} ${r.type}`.toLowerCase().includes(q));
        return json(res, { type: typeName, total, published, drafts, changed, matched: rows.length, entries: rows.slice(offset, offset + limit) });
      }

      // -- One document, both versions, references both ways -------------------
      if (subpath === '/document' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const id = baseId(url.searchParams.get('id') || '');
        if (!id) return json(res, { error: 'id required' }, 400);
        const r = await sanityQuery(cfg, `*[_id in [$id, $draft]]`, { id, draft: draftId(id) });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Query failed') }, r.status);
        const docs = result(r) || [];
        const published = docs.find((d) => d._id === id) || null;
        const draft = docs.find((d) => d._id === draftId(id)) || null;
        if (!published && !draft) return json(res, { error: 'Document not found' }, 404);
        const doc = draft || published;
        const refs = [];
        collectRefs(doc, refs, '');
        const refIds = [...new Set(refs.map((x) => x.ref))];
        let resolved = {};
        if (refIds.length) {
          const rr = await sanityQuery(cfg, `*[_id in $ids]{_id, _type, title, name, heading, headline, originalFilename, url, "slug": slug.current, metadata{dimensions{width, height}}}`, { ids: refIds });
          for (const d of (result(rr) || [])) resolved[d._id] = { _id: d._id, _type: d._type, title: titleOf(d) || d.originalFilename || d._id, url: d.url, slug: d.slug, width: d.metadata && d.metadata.dimensions ? d.metadata.dimensions.width : undefined, height: d.metadata && d.metadata.dimensions ? d.metadata.dimensions.height : undefined };
        }
        const inR = await sanityQuery(cfg, `*[references($id) && ${SYSTEM}][0...50]{_id, _type, title, name, heading, headline, _updatedAt}`, { id });
        const incoming = groupVersions(result(inR) || []);
        const missingRefs = refIds.filter((x) => !resolved[x]);
        return json(res, {
          id, type: doc._type, status: draft && published ? 'changed' : draft ? 'draft' : 'published',
          published, draft, doc,
          refs: resolved, incoming, missingRefs,
          previewUrl: slugOf(doc) && resolvePreviewUrl(cfg) ? `${resolvePreviewUrl(cfg)}/${slugOf(doc).replace(/^\/+/, '')}` : '',
          // The site decides where a type lives; these are the usual places, checked in order by the screen.
          previewCandidates: slugOf(doc) && resolvePreviewUrl(cfg) ? [...new Set([`/${slugOf(doc).replace(/^\/+/, '')}`, `/${doc._type}/${slugOf(doc).replace(/^\/+/, '')}`, `/${doc._type}s/${slugOf(doc).replace(/^\/+/, '')}`, `/${doc._type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}/${slugOf(doc).replace(/^\/+/, '')}`])].map((p) => `${resolvePreviewUrl(cfg)}${p}`) : (doc._id === doc._type || /^(home|homepage|index)$/i.test(slugOf(doc) || doc._id)) && resolvePreviewUrl(cfg) ? [resolvePreviewUrl(cfg)] : [],
          studioUrl: cfg.studioUrl ? `${cfg.studioUrl}/intent/edit/id=${encodeURIComponent(id)};type=${encodeURIComponent(doc._type)}` : '',
          cdn: { projectId: cfg.projectId, dataset: cfg.dataset },
        });
      }

      // -- Save: writes the draft, as the Studio does -------------------------
      if (subpath === '/save' && method === 'POST') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const body = await readBody(req);
        const doc = body.doc;
        if (!doc || typeof doc !== 'object' || !doc._type) return json(res, { error: 'doc with _type required' }, 400);
        const id = baseId(body.id || doc._id || '');
        if (!id) return json(res, { error: 'id required' }, 400);
        const clean = { ...doc, _id: body.publish ? id : draftId(id) };
        delete clean._rev; delete clean._updatedAt; delete clean._createdAt; delete clean._system;
        const mutations = [{ createOrReplace: clean }];
        if (body.publish) mutations.push({ delete: { id: draftId(id) } });
        const r = await sanityMutate(cfg, mutations, { returnIds: true });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Save failed') }, r.status);
        healthCache.clear();
        return json(res, { ok: true, id, draftId: body.publish ? null : draftId(id), published: !!body.publish, transactionId: r.data && r.data.transactionId });
      }

      // -- Duplicate: a new draft with the same content -------------------------
      if (subpath === '/duplicate' && method === 'POST') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const body = await readBody(req);
        const id = baseId(body.id || '');
        if (!id) return json(res, { error: 'id required' }, 400);
        const r = await sanityQuery(cfg, `*[_id in [$id, $draft]]`, { id, draft: draftId(id) });
        const docs = result(r) || [];
        const src = docs.find((d) => d._id === draftId(id)) || docs.find((d) => d._id === id);
        if (!src) return json(res, { error: 'Document not found' }, 404);
        const copy = { ...src, _id: draftId(newId()) };
        delete copy._rev; delete copy._updatedAt; delete copy._createdAt; delete copy._system;
        if (body.title && typeof copy.title === 'string') copy.title = body.title; else if (typeof copy.title === 'string') copy.title = `${copy.title} (copy)`;
        if (copy.slug && typeof copy.slug === 'object' && copy.slug.current) copy.slug = { ...copy.slug, current: `${copy.slug.current}-copy` };
        const m = await sanityMutate(cfg, [{ create: copy }], { returnIds: true });
        if (m.status >= 400) return json(res, { error: errOf(m, 'Duplicate failed') }, m.status);
        healthCache.clear();
        return json(res, { ok: true, id: baseId(copy._id), draftId: copy._id });
      }

      // -- Documents (GROQ) -----------------------------------------------------
      const docsMatch = subpath.match(/^\/documents\/([^/]+)$/);
      const docIdMatch = subpath.match(/^\/documents\/([^/]+)\/([^/]+)$/);
      const docActionMatch = subpath.match(/^\/documents\/([^/]+)\/([^/]+)\/(publish|unpublish|discard)$/);

      if (docActionMatch && method === 'POST') {
        const [, , rawId, action] = docActionMatch;
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const id = baseId(rawId);
        if (action === 'publish') {
          const dr = await sanityQuery(cfg, `*[_id == $id][0]`, { id: draftId(id) });
          const doc = result(dr);
          if (!doc) return json(res, { error: 'No draft to publish' }, 404);
          const r = await sanityMutate(cfg, [{ createOrReplace: { ...doc, _id: id } }, { delete: { id: draftId(id) } }], { returnIds: true });
          if (r.status >= 400) return json(res, { error: errOf(r, 'Publish failed') }, r.status);
          healthCache.clear();
          return json(res, { ok: true, publishedId: id });
        }
        if (action === 'unpublish') {
          const pr = await sanityQuery(cfg, `*[_id == $id][0]`, { id });
          const doc = result(pr);
          if (!doc) return json(res, { error: 'Nothing published under that id' }, 404);
          const dr = await sanityQuery(cfg, `*[_id == $id][0]{_id}`, { id: draftId(id) });
          const mutations = [];
          if (!result(dr)) mutations.push({ createOrReplace: { ...doc, _id: draftId(id) } });
          mutations.push({ delete: { id } });
          const r = await sanityMutate(cfg, mutations, { returnIds: true });
          if (r.status >= 400) return json(res, { error: errOf(r, 'Unpublish failed (another document may reference it)') }, r.status);
          healthCache.clear();
          return json(res, { ok: true, draftId: draftId(id) });
        }
        if (action === 'discard') {
          const r = await sanityMutate(cfg, [{ delete: { id: draftId(id) } }]);
          if (r.status >= 400) return json(res, { error: errOf(r, 'Discard failed') }, r.status);
          healthCache.clear();
          return json(res, { ok: true });
        }
      }

      if (docIdMatch && method === 'GET') {
        const [, docType, docId] = docIdMatch;
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const r = await sanityQuery(cfg, `*[_type == $type && _id == $id][0]`, { type: docType, id: docId });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Query failed') }, r.status);
        return json(res, result(r) || null);
      }

      if (docIdMatch && method === 'PATCH') {
        const [, , docId] = docIdMatch;
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const body = await readBody(req);
        const patch = { id: docId };
        if (body && (body.set || body.unset)) { if (body.set) patch.set = body.set; if (body.unset) patch.unset = body.unset; }
        else patch.set = body;
        const r = await sanityMutate(cfg, [{ patch }], { returnDocuments: true });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Mutation failed') }, r.status);
        healthCache.clear();
        return json(res, r.data);
      }

      if (docIdMatch && method === 'DELETE') {
        const [, , docId] = docIdMatch;
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        if (!(await gate(res, 'DELETE /api/plugins/sanity/documents', `Delete the Sanity document ${baseId(docId)}`))) return;
        const id = baseId(docId);
        const r = await sanityMutate(cfg, [{ delete: { id } }, { delete: { id: draftId(id) } }]);
        if (r.status >= 400) return json(res, { error: errOf(r, 'Delete failed (another document may still reference it)') }, r.status);
        healthCache.clear();
        return json(res, { ok: true });
      }

      if (docsMatch && method === 'GET') {
        const docType = docsMatch[1];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const limit = parseInt(url.searchParams.get('limit') || '100', 10);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const order = (url.searchParams.get('order') || '_updatedAt desc').replace(/[^\w\s,.]/g, '');
        const r = await sanityQuery(cfg, `*[_type == $type] | order(${order}) [${offset}...${offset + limit}]`, { type: docType });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Query failed') }, r.status);
        return json(res, result(r) || []);
      }

      if (docsMatch && method === 'POST') {
        const docType = docsMatch[1];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const body = await readBody(req);
        body._type = docType;
        const asDraft = url.searchParams.get('draft') === '1' || body._draft === true;
        delete body._draft;
        if (asDraft) body._id = draftId(body._id || newId());
        const r = await sanityMutate(cfg, [{ create: body }], { returnDocuments: true });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Mutation failed') }, r.status);
        healthCache.clear();
        const made = r.data && r.data.results && r.data.results[0] ? (r.data.results[0].document || {})._id || r.data.results[0].id : null;
        return json(res, { ok: !!made, id: made ? baseId(made) : null, draftId: made && made.startsWith('drafts.') ? made : null, document: made ? r.data.results[0].document : null, transactionId: r.data && r.data.transactionId, results: r.data && r.data.results });
      }

      // -- GROQ Query Endpoint --------------------------------------------------
      if (subpath === '/groq' && method === 'POST') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const body = await readBody(req);
        if (!body.query) return json(res, { error: 'query field required' }, 400);
        const started = Date.now();
        const r = await sanityQuery(cfg, body.query, body.params || {});
        if (r.status >= 400) return json(res, { error: errOf(r, 'Query failed') }, r.status);
        if (body.meta) return json(res, { result: result(r), ms: r.data.ms, took: Date.now() - started, count: Array.isArray(result(r)) ? result(r).length : null });
        return json(res, result(r));
      }

      // -- Mutations Endpoint ---------------------------------------------------
      if (subpath === '/mutate' && method === 'POST') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const body = await readBody(req);
        if (!body.mutations || !Array.isArray(body.mutations)) return json(res, { error: 'mutations array required' }, 400);
        if (body.mutations.some((m) => m.delete) && !(await gate(res, 'POST /api/plugins/sanity/mutate', 'Run Sanity mutations that delete documents'))) return;
        const r = await sanityMutate(cfg, body.mutations, { returnDocuments: body.returnDocuments, returnIds: body.returnIds, dryRun: body.dryRun });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Mutation failed') }, r.status);
        healthCache.clear();
        return json(res, r.data);
      }

      // -- Bulk Operations ------------------------------------------------------
      const bulkMatch = subpath.match(/^\/documents\/([^/]+)\/(export|import|bulk-update)$/);
      if (bulkMatch && method === 'POST') {
        const docType = bulkMatch[1];
        const action = bulkMatch[2];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        if (action === 'export') {
          return json(res, await fetchAll(cfg, `_type == $type`, '', 5000, { type: docType }));
        }
        if (action === 'import') {
          const body = await readBody(req);
          if (!body.documents || !Array.isArray(body.documents)) return json(res, { error: 'documents array required' }, 400);
          const mutations = body.documents.map(doc => { doc._type = docType; if (!doc._id) doc._id = body.asDrafts ? draftId(newId()) : newId(); return { createOrReplace: doc }; });
          const r = await sanityMutate(cfg, mutations, { returnIds: true });
          if (r.status >= 400) return json(res, { error: errOf(r, 'Import failed') }, r.status);
          healthCache.clear();
          return json(res, { total: body.documents.length, results: r.data });
        }
        if (action === 'bulk-update') {
          const body = await readBody(req);
          if (!body.patches || !Array.isArray(body.patches)) return json(res, { error: 'patches array required' }, 400);
          const mutations = body.patches.map(p => ({ patch: { id: p.id, set: p.set || {}, unset: p.unset || [] } }));
          const r = await sanityMutate(cfg, mutations, { returnIds: true });
          if (r.status >= 400) return json(res, { error: errOf(r, 'Bulk update failed') }, r.status);
          healthCache.clear();
          return json(res, { total: body.patches.length, results: r.data });
        }
      }

      // -- AI-Friendly Summary Endpoints ----------------------------------------
      if (subpath === '/summary' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const health = await buildHealth(cfg, false);
        const lines = ['Sanity Project Summary', '======================', '', `Project: ${cfg.projectId} (${cfg.name || 'unnamed'})`, `Dataset: ${cfg.dataset}`, `Document Types: ${health.totalTypes} | Documents: ${health.totalDocuments} | Drafts: ${health.totalDrafts} | Published with unpublished changes: ${health.totalChanged}`, `Schema in code: ${health.schema.documents} document types, ${health.schema.objects} object types${health.schema.repoPath ? ` (${health.schema.repoPath})` : ''}`, ''];
        for (const t of health.types) lines.push(`  ${t.name}${t.title && t.title !== t.name ? ` "${t.title}"` : ''}: ${t.total} documents${t.drafts ? `, ${t.drafts} drafts` : ''}${t.changed ? `, ${t.changed} changed` : ''}${t.stale ? `, ${t.stale} stale` : ''}${t.inCode ? ` - ${t.fieldCount} fields in code` : ' - no schema in the repository'}`);
        lines.push('');
        if (health.issues.length) { lines.push('Issues:'); for (const i of health.issues) lines.push(`  [${i.level}] ${i.message}`); lines.push(''); }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(lines.join('\n'));
      }

      const summaryMatch = subpath.match(/^\/summary\/([^/]+)$/);
      if (summaryMatch && method === 'GET') {
        const docType = summaryMatch[1];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const r = await sanityQuery(cfg, `*[_type == $type] | order(_updatedAt desc) [0...50]`, { type: docType });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Query failed') }, r.status);
        const docs = result(r) || [];
        const countR = await sanityQuery(cfg, `count(*[_type == $type])`, { type: docType });
        const totalCount = result(countR) || docs.length;
        const schema = await typeSchema(cfg, docType, false);
        const lines = [`Document Type: ${docType}${schema.title && schema.title !== docType ? ` "${schema.title}"` : ''}`, `Total Documents: ${totalCount}`, `Schema: ${schema.source === 'code' ? `from ${schema.file}` : schema.source === 'documents' ? 'inferred from the documents' : 'unknown'}`, 'Fields:'];
        const describe = (f, indent) => {
          lines.push(`${indent}${f.name} (${f.type}${f.objectType ? `:${f.objectType}` : ''}${f.required ? ', required' : ''}${f.of ? `, of ${f.of.map((o) => o.type).join('|')}${f.anyObject ? '|any object type' : ''}` : ''}${f.to ? `, to ${f.to.join('|')}` : ''}${f.options && f.options.list ? `, one of ${f.options.list.map((o) => o.value).join('|')}` : ''}${f.inferred ? ', inferred' : ''})${f.description ? ` - ${f.description}` : ''}`);
          if (f.fields && indent.length < 8) for (const sf of f.fields) describe(sf, indent + '  ');
        };
        for (const f of schema.fields) describe(f, '  ');
        lines.push('', `Documents (showing ${docs.length} of ${totalCount}):`, '---');
        for (const doc of docs) {
          const updated = doc._updatedAt ? doc._updatedAt.split('T')[0] : 'unknown';
          lines.push(`"${titleOf(doc)}" (id: ${doc._id}) -- updated: ${updated}${doc._id.startsWith('drafts.') ? ' [draft]' : ''}`);
          const dataKeys = Object.keys(doc).filter(k => !k.startsWith('_')).slice(0, 10);
          for (const k of dataKeys) {
            let val = doc[k];
            if (val === null || val === undefined) val = '(empty)';
            else if (typeof val === 'object') { const s = JSON.stringify(val); val = s.substring(0, 100) + (s.length > 100 ? '...' : ''); }
            else { const s = String(val); val = s.substring(0, 100) + (s.length > 100 ? '...' : ''); }
            lines.push(`    ${k}: ${val}`);
          }
          const remaining = Object.keys(doc).filter(k => !k.startsWith('_')).length - dataKeys.length;
          if (remaining > 0) lines.push(`    ... +${remaining} more fields`);
          lines.push('');
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(lines.join('\n'));
      }

      // -- References Endpoint ---------------------------------------------------
      const refsMatch = subpath.match(/^\/documents\/([^/]+)\/([^/]+)\/references$/);
      if (refsMatch && method === 'GET') {
        const [, , docId] = refsMatch;
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const inR = await sanityQuery(cfg, `*[references($id)][0...50]{_id, _type, title, name, heading, _updatedAt}`, { id: baseId(docId) });
        const incoming = (result(inR) || []).map((d) => ({ ...d, title: titleOf(d) }));
        const docR = await sanityQuery(cfg, `*[_id == $id][0]`, { id: docId });
        const doc = result(docR) || {};
        const outgoing = [];
        collectRefs(doc, outgoing, '');
        const out = outgoing.map((x) => ({ _ref: x.ref, _path: x.path }));
        if (out.length) {
          const resolveR = await sanityQuery(cfg, `*[_id in $ids]{_id, _type, title, name, heading, originalFilename}`, { ids: [...new Set(out.map(r => r._ref))] });
          const resolved = {};
          (result(resolveR) || []).forEach(d => { resolved[d._id] = d; });
          out.forEach(r => { const rd = resolved[r._ref]; if (rd) { r.title = titleOf(rd) || rd.originalFilename || r._ref; r.resolvedType = rd._type; } else r.missing = true; });
        }
        return json(res, { incoming, outgoing: out });
      }

      // -- Assets --------------------------------------------------------------
      if (subpath === '/assets' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const assetType = url.searchParams.get('type') || 'all';
        const q = (url.searchParams.get('q') || '').trim();
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        let typeFilter = '(_type == "sanity.imageAsset" || _type == "sanity.fileAsset")';
        if (assetType === 'image') typeFilter = '_type == "sanity.imageAsset"';
        else if (assetType === 'file') typeFilter = '_type == "sanity.fileAsset"';
        const search = q ? ` && (originalFilename match $q || title match $q || altText match $q)` : '';
        const params = q ? { q: `*${q}*` } : undefined;
        const r = await sanityQuery(cfg, `*[${typeFilter}${search}] | order(_updatedAt desc) [${offset}...${offset + limit}]{ _id, _type, originalFilename, url, path, size, mimeType, extension, altText, title, description, metadata { dimensions { width, height }, lqip }, _createdAt, _updatedAt }`, params);
        if (r.status >= 400) return json(res, { error: errOf(r, 'Query failed') }, r.status);
        const countR = await sanityQuery(cfg, `count(*[${typeFilter}${search}])`, params);
        return json(res, { assets: result(r) || [], total: result(countR) || 0 });
      }

      const assetUsageMatch = subpath.match(/^\/assets\/([^/]+)\/usage$/);
      if (assetUsageMatch && method === 'GET') {
        const assetId = decodeURIComponent(assetUsageMatch[1]);
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const r = await sanityQuery(cfg, `*[references($id) && ${SYSTEM}][0...50]{_id, _type, title, name, heading, headline, _updatedAt}`, { id: assetId });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Query failed') }, r.status);
        return json(res, groupVersions(result(r) || []));
      }

      const assetIdMatch = subpath.match(/^\/assets\/([^/]+)$/);
      if (assetIdMatch && method === 'PATCH') {
        const assetId = decodeURIComponent(assetIdMatch[1]);
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const body = await readBody(req);
        const set = {};
        for (const k of ['altText', 'title', 'description']) if (body[k] !== undefined) set[k] = String(body[k]);
        if (!Object.keys(set).length) return json(res, { error: 'altText, title or description required' }, 400);
        const r = await sanityMutate(cfg, [{ patch: { id: assetId, set } }], { returnIds: true });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Update failed') }, r.status);
        return json(res, { ok: true, set });
      }

      if (assetIdMatch && method === 'DELETE') {
        const assetId = decodeURIComponent(assetIdMatch[1]);
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        if (!(await gate(res, 'DELETE /api/plugins/sanity/assets', `Delete the Sanity asset ${assetId}`))) return;
        const r = await sanityMutate(cfg, [{ delete: { id: assetId } }]);
        if (r.status >= 400) return json(res, { error: errOf(r, 'Delete failed (a document still uses it)') }, r.status);
        return json(res, { ok: true });
      }

      // -- Drafts (legacy list + publish/discard) -------------------------------
      if (subpath === '/drafts' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const r = await sanityQuery(cfg, `*[_id in path("drafts.**") && ${SYSTEM}] | order(_updatedAt desc) [0...${limit}]{ _id, _type, title, name, heading, headline, _createdAt, _updatedAt }`);
        if (r.status >= 400) return json(res, { error: errOf(r, 'Query failed') }, r.status);
        return json(res, (result(r) || []).map((d) => ({ ...d, title: titleOf(d) })));
      }

      const draftPubMatch = subpath.match(/^\/drafts\/([^/]+)\/publish$/);
      if (draftPubMatch && method === 'POST') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const id = baseId(decodeURIComponent(draftPubMatch[1]));
        const dr = await sanityQuery(cfg, `*[_id == $id][0]`, { id: draftId(id) });
        const doc = result(dr);
        if (dr.status >= 400 || !doc) return json(res, { error: 'Draft not found' }, 404);
        const r = await sanityMutate(cfg, [{ createOrReplace: { ...doc, _id: id } }, { delete: { id: draftId(id) } }], { returnIds: true });
        if (r.status >= 400) return json(res, { error: errOf(r, 'Publish failed') }, r.status);
        healthCache.clear();
        return json(res, { ok: true, publishedId: id });
      }

      const draftDiscardMatch = subpath.match(/^\/drafts\/([^/]+)\/discard$/);
      if (draftDiscardMatch && method === 'POST') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const r = await sanityMutate(cfg, [{ delete: { id: draftId(decodeURIComponent(draftDiscardMatch[1])) } }]);
        if (r.status >= 400) return json(res, { error: errOf(r, 'Discard failed') }, r.status);
        healthCache.clear();
        return json(res, { ok: true });
      }

      // -- History: who changed a document, and when ----------------------------
      if (subpath === '/history' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const id = baseId(url.searchParams.get('id') || '');
        if (!id) return json(res, { error: 'id required' }, 400);
        const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '30', 10));
        const r = await httpsJson(`${sanityUrl(cfg, `data/history/${cfg.dataset}/transactions/${encodeURIComponent(id)},${encodeURIComponent(draftId(id))}`)}?excludeContent=true&limit=${limit}`, { method: 'GET', headers: { 'Authorization': `Bearer ${cfg.apiToken}` } });
        if (r.status >= 400) return json(res, { error: errOf(r, 'History is not available (the token may need a higher role)') }, r.status);
        const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
        const transactions = text.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch (_) { return null; } }).filter(Boolean)
          .map((t) => ({ id: t.id, at: t.timestamp, author: t.author, documentIds: t.documentIDs || [], effects: Object.keys(t.effects || {}), mutations: (t.mutations || []).length }))
          .sort((a, b) => String(b.at).localeCompare(String(a.at)));
        return json(res, { id, transactions });
      }

      // -- Health Check Endpoint -------------------------------------------------
      if (subpath === '/health' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        return json(res, await buildHealth(cfg, url.searchParams.get('refresh') === '1'));
      }

      // -- Insights: every document with something to look at --------------------
      if (subpath === '/insights' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const docs = await fetchAll(cfg, SYSTEM, '', 2500);
        const repo = readRepoSchema(cfg, false);
        const requiredByType = {};
        const slugTypes = new Set();
        for (const d of repo.documents) {
          requiredByType[d.name] = (d.fields || []).filter((f) => f.required && !f.hidden).map((f) => f.name);
          if ((d.fields || []).some((f) => f.type === 'slug')) slugTypes.add(d.name);
        }
        // Types whose documents mostly carry a slug are page-like even without a schema.
        const slugCount = {}; const typeCount = {};
        for (const d of docs) { typeCount[d._type] = (typeCount[d._type] || 0) + 1; if (slugOf(d)) slugCount[d._type] = (slugCount[d._type] || 0) + 1; }
        for (const t of Object.keys(typeCount)) if (slugCount[t] && slugCount[t] >= typeCount[t] / 2) slugTypes.add(t);
        const ids = new Set(docs.map((d) => d._id));
        const allRefs = new Set();
        for (const d of docs) { const refs = []; collectRefs(d, refs, ''); refs.forEach((x) => allRefs.add(x.ref)); }
        const unknown = [...allRefs].filter((x) => !ids.has(x));
        const existing = new Set();
        for (let i = 0; i < unknown.length; i += 200) {
          const rr = await sanityQuery(cfg, `*[_id in $ids]{_id}`, { ids: unknown.slice(i, i + 200) });
          (result(rr) || []).forEach((d) => existing.add(d._id));
        }
        const exists = (ref) => ids.has(ref) || existing.has(ref);
        const rows = groupVersions(docs);
        const byId = new Map(); for (const d of docs) byId.set(d._id, d);
        const staleAt = Date.now() - STALE_DAYS * 86400000;
        const slugSeen = {};
        const entries = [];
        const counts = { total: rows.length, draft: 0, changed: 0, stale: 0, missingTitle: 0, missingSlug: 0, duplicateSlug: 0, missingAlt: 0, imagesMissingAlt: 0, brokenRef: 0, missingRequired: 0 };
        for (const row of rows) {
          const doc = byId.get(draftId(row.id)) || byId.get(row.id);
          const issues = [];
          const detail = {};
          if (row.status === 'draft') { issues.push('draft'); counts.draft++; }
          if (row.status === 'changed') { issues.push('changed'); counts.changed++; }
          if (row.status === 'published' && row.updatedAt && new Date(row.updatedAt).getTime() < staleAt) { issues.push('stale'); counts.stale++; }
          // A singleton (id equals its type: header, footer, settings) has nothing to title.
          if ((!titleOf(doc) || titleOf(doc) === doc._id) && doc._id !== doc._type) { issues.push('missing-title'); counts.missingTitle++; }
          const slug = slugOf(doc);
          if (slugTypes.has(doc._type) && !slug) { issues.push('missing-slug'); counts.missingSlug++; }
          if (slug) { const k = `${doc._type}:${slug}`; if (slugSeen[k]) { issues.push('duplicate-slug'); counts.duplicateSlug++; detail.duplicateOf = slugSeen[k]; } else slugSeen[k] = row.id; }
          const imgs = []; imagesMissingAlt(doc, imgs, '');
          if (imgs.length) { issues.push('missing-alt'); counts.missingAlt++; counts.imagesMissingAlt += imgs.length; detail.images = imgs.slice(0, 20); }
          const refs = []; collectRefs(doc, refs, '');
          const broken = refs.filter((x) => !exists(x.ref));
          if (broken.length) { issues.push('broken-ref'); counts.brokenRef++; detail.brokenRefs = broken.slice(0, 20); }
          const req = requiredByType[doc._type] || [];
          const missing = req.filter((f) => doc[f] === undefined || doc[f] === null || doc[f] === '' || (Array.isArray(doc[f]) && !doc[f].length) || (doc[f] && typeof doc[f] === 'object' && !Array.isArray(doc[f]) && doc[f]._type === 'slug' && !doc[f].current));
          if (missing.length) { issues.push(...missing.map((f) => `missing-required:${f}`)); counts.missingRequired++; }
          entries.push({ id: row.id, type: doc._type, title: titleOf(doc), slug, status: row.status, updatedAt: row.updatedAt, issues, ...detail });
        }
        const types = Object.entries(typeCount).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
        counts.emptyTypes = repo.documents.map((d) => d.name).filter((n) => !typeCount[n]);
        return json(res, { counts, types, entries: entries.filter((e) => e.issues.length).sort((a, b) => b.issues.length - a.issues.length), read: docs.length, staleDays: STALE_DAYS });
      }

      // -- Content Audit (legacy, one type) -------------------------------------
      const auditMatch = subpath.match(/^\/audit\/([^/]+)$/);
      if (auditMatch && method === 'GET') {
        const docType = auditMatch[1];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const docs = await fetchAll(cfg, `_type == $type`, '', 500, { type: docType });
        const issues = [];
        const now = Date.now();
        for (const doc of docs) {
          const title = titleOf(doc);
          if (!doc.title && !doc.name && !doc.heading) issues.push({ docId: doc._id, title: doc._id, level: 'warn', issue: 'Missing title/name/heading field' });
          if (doc._updatedAt && (now - new Date(doc._updatedAt).getTime()) > STALE_DAYS * 86400000) issues.push({ docId: doc._id, title, level: 'info', issue: 'Not updated in ' + Math.floor((now - new Date(doc._updatedAt).getTime()) / 86400000) + ' days' });
          if (doc._id.startsWith('drafts.')) issues.push({ docId: doc._id, title, level: 'info', issue: 'Unpublished draft' });
          const imgs = []; imagesMissingAlt(doc, imgs, '');
          if (imgs.length) issues.push({ docId: doc._id, title, level: 'warn', issue: `${imgs.length} image${imgs.length === 1 ? '' : 's'} without alt text` });
        }
        return json(res, { type: docType, totalDocuments: docs.length, issues });
      }

      // -- Repo Endpoints (local codebase access) --------------------------------
      if (subpath === '/repo/info' && method === 'GET') {
        const cfg = getPluginConfig();
        const repoPath = cfg.repoPath || '';
        if (!repoPath) return json(res, { error: 'No local repo path configured. Give the project a repository under Projects.' }, 400);
        if (!fs.existsSync(repoPath)) return json(res, { error: 'Repo path does not exist: ' + repoPath }, 404);
        const info = { repoPath, exists: true, hasPackageJson: false, hasSanityConfig: false, studioPath: '', framework: 'unknown', sanityVersion: '', nextSanity: false };
        if (fs.existsSync(path.join(repoPath, 'package.json'))) {
          info.hasPackageJson = true;
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            if (deps.next) info.framework = 'next'; else if (deps.gatsby) info.framework = 'gatsby'; else if (deps.nuxt) info.framework = 'nuxt'; else if (deps.astro) info.framework = 'astro'; else if (deps['@sveltejs/kit'] || deps.svelte) info.framework = 'svelte'; else if (deps.remix || deps['@remix-run/react']) info.framework = 'remix'; else if (deps.react) info.framework = 'react';
            info.sanityVersion = deps.sanity || '';
            info.nextSanity = !!deps['next-sanity'];
            info.scripts = Object.keys(pkg.scripts || {});
          } catch (_) {}
        }
        const sanityConfigs = ['sanity.config.ts', 'sanity.config.js', 'sanity.config.mjs', 'sanity.config.tsx'];
        for (const sc of sanityConfigs) if (fs.existsSync(path.join(repoPath, sc))) { info.hasSanityConfig = true; info.sanityConfig = sc; break; }
        for (const sd of ['studio', 'sanity', 'cms', 'sanity-studio', 'apps/studio']) {
          const sp = path.join(repoPath, sd);
          if (fs.existsSync(sp) && sanityConfigs.some(sc => fs.existsSync(path.join(sp, sc)))) { info.studioPath = sp.replace(/\\/g, '/'); break; }
        }
        const repo = readRepoSchema(cfg, false);
        info.schema = { documents: repo.documents.map((d) => d.name), objects: Object.keys(repo.objects), files: repo.files.length };
        return json(res, info);
      }

      if (subpath === '/repo/schemas' && method === 'GET') {
        const cfg = getPluginConfig();
        const repoPath = cfg.repoPath || '';
        if (!repoPath || !fs.existsSync(repoPath)) return json(res, { error: 'Repo path not configured or does not exist' }, 400);
        const repo = readRepoSchema(cfg, url.searchParams.get('refresh') === '1');
        return json(res, repo.files.map((f) => ({ path: path.join(repoPath, f.relativePath).replace(/\\/g, '/'), relativePath: f.relativePath, name: path.basename(f.relativePath), types: f.types, size: (() => { try { return fs.statSync(path.join(repoPath, f.relativePath)).size; } catch (_) { return 0; } })() })));
      }

      const schemaFileMatch = subpath.match(/^\/repo\/schema\/(.+)$/);
      const repoFileMatch = subpath.match(/^\/repo\/file\/(.+)$/);
      if ((schemaFileMatch || repoFileMatch) && method === 'GET') {
        const cfg = getPluginConfig();
        const repoPath = cfg.repoPath || '';
        if (!repoPath) return json(res, { error: 'Repo path not configured' }, 400);
        const relPath = decodeURIComponent((schemaFileMatch || repoFileMatch)[1]);
        const fullPath = path.resolve(repoPath, relPath);
        if (!fullPath.startsWith(path.resolve(repoPath))) return json(res, { error: 'Path outside repo' }, 403);
        if (!fs.existsSync(fullPath)) return json(res, { error: 'File not found' }, 404);
        try { return json(res, { path: fullPath.replace(/\\/g, '/'), relativePath: relPath, content: fs.readFileSync(fullPath, 'utf8') }); }
        catch (e) { return json(res, { error: e.message }, 500); }
      }

      if (subpath === '/repo/components' && method === 'GET') {
        const cfg = getPluginConfig();
        const repoPath = cfg.repoPath || '';
        if (!repoPath || !fs.existsSync(repoPath)) return json(res, { error: 'Repo path not configured or does not exist' }, 400);
        const componentFiles = [];
        const searchDirs = [path.join(repoPath, 'components'), path.join(repoPath, 'src', 'components'), path.join(repoPath, 'app', 'components'), path.join(repoPath, 'src', 'app', 'components')];
        function findComponents(dir, depth) {
          if (depth > 4 || !fs.existsSync(dir)) return;
          try {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
              if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
              const full = path.join(dir, e.name);
              if (e.isDirectory()) findComponents(full, depth + 1);
              else if (/\.(tsx|jsx|ts|js|vue|svelte|astro)$/.test(e.name) && !/\.(test|spec)\.[tj]sx?$/.test(e.name)) {
                let kind = 'component';
                if (/\.schema\.[tj]s$/.test(e.name)) kind = 'schema';
                componentFiles.push({ path: full.replace(/\\/g, '/'), relativePath: path.relative(repoPath, full).replace(/\\/g, '/'), name: e.name, kind });
              }
            }
          } catch (_) {}
        }
        for (const dir of searchDirs) findComponents(dir, 0);
        return json(res, componentFiles);
      }

      if (subpath === '/repo/tree' && method === 'GET') {
        const cfg = getPluginConfig();
        const repoPath = cfg.repoPath || '';
        if (!repoPath || !fs.existsSync(repoPath)) return json(res, { error: 'Repo path not configured or does not exist' }, 400);
        const subDir = url.searchParams.get('path') || '';
        const targetDir = subDir ? path.resolve(repoPath, subDir) : repoPath;
        if (!targetDir.startsWith(path.resolve(repoPath))) return json(res, { error: 'Path outside repo' }, 403);
        if (!fs.existsSync(targetDir)) return json(res, { error: 'Directory not found' }, 404);
        try {
          const entries = fs.readdirSync(targetDir, { withFileTypes: true })
            .filter(e => !e.name.startsWith('.') && !IGNORE_DIRS.has(e.name))
            .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
            .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
          return json(res, { path: targetDir.replace(/\\/g, '/'), entries });
        } catch (e) { return json(res, { error: e.message }, 500); }
      }

      // -- Preview Check (HEAD) -------------------------------------------------
      if (subpath === '/preview-check' && method === 'GET') {
        const target = url.searchParams.get('url');
        if (!target) return json(res, { ok: false, error: 'url parameter required' });
        try {
          const status = await new Promise((resolve, reject) => {
            let urlObj;
            try { urlObj = new URL(target); } catch (e) { return reject(e); }
            const lib = urlObj.protocol === 'http:' ? http : https;
            const rq = lib.request({ hostname: urlObj.hostname, port: urlObj.port || (urlObj.protocol === 'http:' ? 80 : 443), path: urlObj.pathname + urlObj.search, method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 8000 }, (resp) => { resp.resume(); resolve(resp.statusCode); });
            rq.on('error', reject);
            rq.on('timeout', () => { rq.destroy(); reject(new Error('timeout')); });
            rq.end();
          });
          return json(res, { ok: status >= 200 && status < 400, status });
        } catch (e) { return json(res, { ok: false, error: e.message }); }
      }

      // -- Preview Proxy ------------------------------------------------------
      if (subpath === '/preview' && method === 'GET') {
        const target = url.searchParams.get('url');
        if (!target) return json(res, { error: 'url parameter required' }, 400);
        try {
          const html = await new Promise((resolve, reject) => {
            let urlObj;
            try { urlObj = new URL(target); } catch (e) { return reject(new Error('Invalid URL: ' + target)); }
            const lib = urlObj.protocol === 'http:' ? http : https;
            const opts = { hostname: urlObj.hostname, port: urlObj.port || (urlObj.protocol === 'http:' ? 80 : 443), path: urlObj.pathname + urlObj.search, method: 'GET', headers: { 'Accept': 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' } };
            const rq = lib.request(opts, (resp) => {
              if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
                const next = new URL(resp.headers.location, target).toString();
                lib.get(next, { headers: opts.headers }, (r2) => { const cks = []; r2.on('data', c => cks.push(c)); r2.on('end', () => resolve(Buffer.concat(cks).toString('utf8'))); }).on('error', reject);
                return;
              }
              const chunks = [];
              resp.on('data', c => chunks.push(c));
              resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            });
            rq.on('error', reject);
            rq.end();
          });
          let out = html || '';
          const origin = new URL(target).origin;
          out = out.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
          out = out.replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');
          out = out.replace(/((?:href|src|action|content)\s*=\s*["'])(\/[^"']*)/gi, (m, attr, p) => (p.startsWith('//') ? m : attr + origin + p));
          out = out.replace(/url\(\s*["']?(\/[^)"'\s]+)/gi, (m, p) => 'url(' + origin + p);
          out = out.replace(/srcset\s*=\s*["']([^"']+)/gi, (m, srcset) => 'srcset="' + srcset.replace(/(^|,\s*)(\/[^\s,]+)/g, (sm, pre, p) => pre + origin + p));
          const guard = '<style>html,body{margin:0}</style><script>document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a");if(a){e.preventDefault();}},true);window.onerror=function(){return true};window.onunhandledrejection=function(e){e.preventDefault()};</script>';
          if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, guard + '</head>');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN' });
          return res.end(out);
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end('<html><body style="font:12px sans-serif;color:#888;padding:20px">Preview failed: ' + String(e.message || e).replace(/</g, '&lt;') + '</body></html>');
        }
      }

      return false;
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  });
};
