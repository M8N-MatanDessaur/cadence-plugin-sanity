/**
 * Sanity.io Plugin -- Server-side API Routes
 * Proxies the Sanity Content Lake API (GROQ queries + Mutations).
 * Supports multiple Sanity projects with an active-project selector.
 * Credentials stored in config.json alongside this file.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const configPath = path.join(__dirname, 'config.json');
const API_VERSION = '2024-01-01';
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.next', 'out', 'build', 'static', '.cache', '.vercel', '.netlify', '.turbo', '__pycache__', 'coverage', '.sanity']);

// -- Config helpers (multi-project) -------------------------------------------

function readAllCfg() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // Migrate legacy flat config (projectId at root) to multi-project format
    if (raw.projectId !== undefined && !raw.projects) {
      const legacy = {
        name: raw.projectId || 'My Project',
        projectId: raw.projectId || '',
        dataset: raw.dataset || '',
        apiToken: raw.apiToken || '',
      };
      const migrated = {
        projects: legacy.projectId ? [legacy] : [],
        activeProject: legacy.projectId ? legacy.name : '',
      };
      saveAllCfg(migrated);
      return migrated;
    }
    return {
      projects: Array.isArray(raw.projects) ? raw.projects : [],
      activeProject: raw.activeProject || '',
    };
  } catch (_) {
    return { projects: [], activeProject: '' };
  }
}

function saveAllCfg(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
}

function getActiveProject(all) {
  const a = all || readAllCfg();
  if (!a.projects.length) return null;
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

// Return the project's environments list, migrating legacy fields if needed.
// Each entry: { id, label, url, localPort }
function normalizeEnvironments(p) {
  if (Array.isArray(p.environments) && p.environments.length) {
    return p.environments.map(function (e) {
      var label = e.label || e.id || 'Env';
      return {
        id: e.id || slugifyEnvId(label),
        label: label,
        url: e.url || '',
        localPort: e.localPort || '',
      };
    });
  }
  // Legacy migration from prodUrl / stagingUrl / localPort
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
    out.push({
      id: id,
      label: label,
      url: e.url ? String(e.url).trim().replace(/\/+$/, '') : '',
      localPort: e.localPort ? String(e.localPort).trim() : '',
    });
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
  return {
    environments: envs,
    activeEnv: active ? active.id : '',
    previewUrl: resolveEnvUrl(active),
  };
}

function sanityUrl(cfg, endpoint) {
  return `https://${cfg.projectId}.api.sanity.io/v${API_VERSION}/${endpoint}`;
}

function sanityApiUrl(cfg, endpoint) {
  return `https://${cfg.projectId}.apicdn.sanity.io/v${API_VERSION}/${endpoint}`;
}

function httpsJson(urlStr, options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      port: url.port || 443,
      ...options,
    };
    const req = https.request(opts, (resp) => {
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, data: JSON.parse(data) }); }
        catch (_) { resolve({ status: resp.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function sanityQuery(cfg, groq, params) {
  const qs = new URLSearchParams({ query: groq });
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      qs.set('$' + k, JSON.stringify(v));
    }
  }
  return httpsJson(`${sanityUrl(cfg, 'data/query/' + cfg.dataset)}?${qs}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${cfg.apiToken}` },
  });
}

async function sanityMutate(cfg, mutations, opts = {}) {
  const body = { mutations };
  const qs = new URLSearchParams();
  if (opts.returnDocuments !== undefined) qs.set('returnDocuments', String(opts.returnDocuments));
  if (opts.returnIds !== undefined) qs.set('returnIds', String(opts.returnIds));
  if (opts.dryRun) qs.set('dryRun', 'true');
  const qstr = qs.toString();
  return httpsJson(`${sanityUrl(cfg, 'data/mutate/' + cfg.dataset)}${qstr ? '?' + qstr : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiToken}`,
    },
  }, body);
}

// -- Route Registration -------------------------------------------------------

module.exports = function ({ addPrefixRoute, json, readBody }) {

  addPrefixRoute(async (req, res, url, subpath) => {
    const method = req.method;

    try {
      // -- Config (legacy compat + active project info) -------------------------
      if (subpath === '/config' && method === 'GET') {
        const cfg = getPluginConfig();
        return json(res, {
          configured: isConfigured(cfg),
          projectId: cfg.projectId || '',
          dataset: cfg.dataset || '',
          apiTokenSet: !!cfg.apiToken,
          ...getEnvFields(cfg),
          repoPath: cfg.repoPath || '',
          studioUrl: cfg.studioUrl || '',
        });
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
        return json(res, {
          projects: all.projects.map(p => ({
            name: p.name,
            projectId: p.projectId,
            dataset: p.dataset,
            apiToken: p.apiToken || '',
            apiTokenSet: !!p.apiToken,
            ...getEnvFields(p),
            repoPath: p.repoPath || '',
            studioUrl: p.studioUrl || '',
          })),
          activeProject: all.activeProject || '',
        });
      }

      if (subpath === '/projects' && method === 'POST') {
        const body = await readBody(req);
        if (!body.name || !body.projectId || !body.dataset || !body.apiToken) {
          return json(res, { error: 'name, projectId, dataset, and apiToken are all required.' }, 400);
        }
        const all = readAllCfg();
        const name = String(body.name).trim();
        if (all.projects.find(p => p.name === name)) {
          return json(res, { error: 'A project with that name already exists.' }, 409);
        }
        const cleanEnvs = sanitizeEnvironments(body.environments);
        const envs = (cleanEnvs && cleanEnvs.length) ? cleanEnvs : [{
          id: 'production', label: 'Production',
          url: body.prodUrl ? String(body.prodUrl).trim().replace(/\/+$/, '') : '',
          localPort: body.localPort ? String(body.localPort).trim() : '',
        }];
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
        const proj = all.projects.find(p => p.name === body.name);
        if (!proj) return json(res, { error: 'Project not found.' }, 404);
        all.activeProject = body.name;
        saveAllCfg(all);
        return json(res, { ok: true, activeProject: body.name });
      }

      if (subpath.startsWith('/projects/') && subpath !== '/projects/active' && method === 'PUT') {
        const projName = decodeURIComponent(subpath.slice('/projects/'.length));
        const body = await readBody(req);
        const all = readAllCfg();
        const idx = all.projects.findIndex(p => p.name === projName);
        if (idx < 0) return json(res, { error: 'Project not found.' }, 404);
        if (body.name !== undefined) {
          const newName = String(body.name).trim();
          if (newName !== projName && all.projects.find(p => p.name === newName)) {
            return json(res, { error: 'A project with that name already exists.' }, 409);
          }
          if (all.activeProject === projName) all.activeProject = newName;
          all.projects[idx].name = newName;
        }
        if (body.projectId !== undefined) all.projects[idx].projectId = String(body.projectId).trim();
        if (body.dataset !== undefined) all.projects[idx].dataset = String(body.dataset).trim();
        if (body.apiToken !== undefined) all.projects[idx].apiToken = String(body.apiToken);
        if (body.environments !== undefined) {
          const clean = sanitizeEnvironments(body.environments);
          if (clean && clean.length) {
            all.projects[idx].environments = clean;
            // Drop legacy fields so normalizeEnvironments uses the new list exclusively.
            delete all.projects[idx].prodUrl;
            delete all.projects[idx].stagingUrl;
            delete all.projects[idx].localPort;
            delete all.projects[idx].previewUrl;
            if (!clean.find(function (e) { return e.id === all.projects[idx].activeEnv; })) {
              all.projects[idx].activeEnv = clean[0].id;
            }
          }
        }
        if (body.activeEnv !== undefined) all.projects[idx].activeEnv = String(body.activeEnv);
        if (body.repoPath !== undefined) all.projects[idx].repoPath = String(body.repoPath).trim().replace(/\/+$/, '');
        if (body.studioUrl !== undefined) all.projects[idx].studioUrl = String(body.studioUrl).trim().replace(/\/+$/, '');
        saveAllCfg(all);
        return json(res, { ok: true });
      }

      if (subpath.startsWith('/projects/') && subpath !== '/projects/active' && method === 'DELETE') {
        const projName = decodeURIComponent(subpath.slice('/projects/'.length));
        const all = readAllCfg();
        const idx = all.projects.findIndex(p => p.name === projName);
        if (idx < 0) return json(res, { error: 'Project not found.' }, 404);
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
        if (!envs.find(function (e) { return e.id === body.env; })) {
          return json(res, { error: 'Unknown env: ' + body.env }, 400);
        }
        all.projects[idx].activeEnv = body.env;
        saveAllCfg(all);
        return json(res, { ok: true, activeEnv: body.env, previewUrl: resolvePreviewUrl(all.projects[idx]) });
      }

      // -- Test connection ------------------------------------------------------
      if (subpath === '/test' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { ok: false, error: 'Not configured' });
        try {
          const r = await sanityQuery(cfg, '*[_type == "sanity.imageAsset"][0...1]{_id}');
          if (r.status >= 400) {
            const msg = r.data && r.data.message ? r.data.message : `HTTP ${r.status}`;
            return json(res, { ok: false, error: msg });
          }
          return json(res, { ok: true, projectId: cfg.projectId, dataset: cfg.dataset });
        } catch (e) {
          return json(res, { ok: false, error: e.message });
        }
      }

      // -- Document Types -------------------------------------------------------
      if (subpath === '/types' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const r = await sanityQuery(cfg, `
          *[!(_type match "system.*") && !(_type match "sanity.*") && defined(_type)] {
            _type
          } | order(_type asc)
        `);
        if (r.status >= 400) return json(res, { error: r.data.message || 'Query failed' }, r.status);

        // Deduplicate and count
        const counts = {};
        for (const doc of (r.data.result || [])) {
          counts[doc._type] = (counts[doc._type] || 0) + 1;
        }
        const types = Object.entries(counts).map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return json(res, types);
      }

      // -- Documents (GROQ) -----------------------------------------------------
      // GET /documents/:type -- list documents of a type
      const docsMatch = subpath.match(/^\/documents\/([^/]+)$/);
      const docIdMatch = subpath.match(/^\/documents\/([^/]+)\/([^/]+)$/);

      // GET /documents/:type/:id -- single document
      if (docIdMatch && method === 'GET') {
        const [, docType, docId] = docIdMatch;
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const r = await sanityQuery(cfg, `*[_type == $type && _id == $id][0]`, { type: docType, id: docId });
        if (r.status >= 400) return json(res, { error: r.data.message || 'Query failed' }, r.status);
        return json(res, r.data.result || null);
      }

      // PATCH /documents/:type/:id -- update document fields
      if (docIdMatch && method === 'PATCH') {
        const [, docType, docId] = docIdMatch;
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const body = await readBody(req);
        const mutations = [{ patch: { id: docId, set: body } }];
        const r = await sanityMutate(cfg, mutations, { returnDocuments: true });
        if (r.status >= 400) return json(res, { error: r.data.message || 'Mutation failed' }, r.status);
        return json(res, r.data);
      }

      // DELETE /documents/:type/:id -- delete document
      if (docIdMatch && method === 'DELETE') {
        const [, docType, docId] = docIdMatch;
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const mutations = [{ delete: { id: docId } }];
        const r = await sanityMutate(cfg, mutations);
        if (r.status >= 400) return json(res, { error: r.data.message || 'Mutation failed' }, r.status);
        return json(res, { ok: true });
      }

      // GET /documents/:type -- list
      if (docsMatch && method === 'GET') {
        const docType = docsMatch[1];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const limit = parseInt(url.searchParams.get('limit') || '100', 10);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const order = url.searchParams.get('order') || '_updatedAt desc';

        const r = await sanityQuery(cfg,
          `*[_type == $type] | order(${order}) [${offset}...${offset + limit}]`,
          { type: docType }
        );
        if (r.status >= 400) return json(res, { error: r.data.message || 'Query failed' }, r.status);
        return json(res, r.data.result || []);
      }

      // POST /documents/:type -- create document
      if (docsMatch && method === 'POST') {
        const docType = docsMatch[1];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const body = await readBody(req);
        body._type = docType;
        const mutations = [{ create: body }];
        const r = await sanityMutate(cfg, mutations, { returnDocuments: true });
        if (r.status >= 400) return json(res, { error: r.data.message || 'Mutation failed' }, r.status);
        return json(res, r.data);
      }

      // -- GROQ Query Endpoint --------------------------------------------------
      if (subpath === '/groq' && method === 'POST') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const body = await readBody(req);
        if (!body.query) return json(res, { error: 'query field required' }, 400);

        const r = await sanityQuery(cfg, body.query, body.params || {});
        if (r.status >= 400) return json(res, { error: r.data.message || 'Query failed' }, r.status);
        return json(res, r.data.result);
      }

      // -- Mutations Endpoint ---------------------------------------------------
      if (subpath === '/mutate' && method === 'POST') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const body = await readBody(req);
        if (!body.mutations || !Array.isArray(body.mutations)) {
          return json(res, { error: 'mutations array required' }, 400);
        }

        const r = await sanityMutate(cfg, body.mutations, {
          returnDocuments: body.returnDocuments,
          returnIds: body.returnIds,
          dryRun: body.dryRun,
        });
        if (r.status >= 400) return json(res, { error: r.data.message || 'Mutation failed' }, r.status);
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
          // Fetch all documents of this type (paginated)
          const allDocs = [];
          let offset = 0;
          let hasMore = true;
          while (hasMore) {
            const r = await sanityQuery(cfg,
              `*[_type == $type] | order(_updatedAt desc) [${offset}...${offset + 100}]`,
              { type: docType }
            );
            const batch = (r.data && r.data.result) || [];
            allDocs.push(...batch);
            hasMore = batch.length >= 100;
            offset += 100;
          }
          return json(res, allDocs);
        }

        if (action === 'import') {
          const body = await readBody(req);
          if (!body.documents || !Array.isArray(body.documents)) {
            return json(res, { error: 'documents array required' }, 400);
          }
          const mutations = body.documents.map(doc => {
            doc._type = docType;
            return { createOrReplace: doc };
          });
          const r = await sanityMutate(cfg, mutations, { returnIds: true });
          if (r.status >= 400) return json(res, { error: r.data.message || 'Import failed' }, r.status);
          return json(res, { total: body.documents.length, results: r.data });
        }

        if (action === 'bulk-update') {
          const body = await readBody(req);
          if (!body.patches || !Array.isArray(body.patches)) {
            return json(res, { error: 'patches array required' }, 400);
          }
          const mutations = body.patches.map(p => ({
            patch: { id: p.id, set: p.set || {}, unset: p.unset || [] },
          }));
          const r = await sanityMutate(cfg, mutations, { returnDocuments: true });
          if (r.status >= 400) return json(res, { error: r.data.message || 'Bulk update failed' }, r.status);
          return json(res, { total: body.patches.length, results: r.data });
        }
      }

      // -- AI-Friendly Summary Endpoints ----------------------------------------

      // GET /summary -- overview of the entire Sanity project
      if (subpath === '/summary' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        // Get all document types and counts
        const r = await sanityQuery(cfg, `
          *[!(_type match "system.*") && !(_type match "sanity.*") && defined(_type)] {
            _type
          }
        `);
        if (r.status >= 400) return json(res, { error: r.data.message || 'Query failed' }, r.status);

        const counts = {};
        for (const doc of (r.data.result || [])) {
          counts[doc._type] = (counts[doc._type] || 0) + 1;
        }
        const types = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
        const totalDocs = types.reduce((sum, [, c]) => sum + c, 0);

        const lines = [
          'Sanity Project Summary',
          '======================',
          '',
          `Project: ${cfg.projectId}`,
          `Dataset: ${cfg.dataset}`,
          `Document Types: ${types.length} | Total Documents: ${totalDocs}`,
          '',
        ];

        for (const [typeName, count] of types) {
          lines.push(`  ${typeName}: ${count} documents`);
        }
        lines.push('');

        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(lines.join('\n'));
      }

      // GET /summary/:type -- summary of a specific document type
      const summaryMatch = subpath.match(/^\/summary\/([^/]+)$/);
      if (summaryMatch && method === 'GET') {
        const docType = summaryMatch[1];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        // Fetch documents of this type (max 50 for summary)
        const r = await sanityQuery(cfg,
          `*[_type == $type] | order(_updatedAt desc) [0...50]`,
          { type: docType }
        );
        if (r.status >= 400) return json(res, { error: r.data.message || 'Query failed' }, r.status);

        const docs = r.data.result || [];

        // Count total (may be more than 50)
        const countR = await sanityQuery(cfg, `count(*[_type == $type])`, { type: docType });
        const totalCount = (countR.data && countR.data.result) || docs.length;

        // Discover fields from the documents
        const fieldSet = new Set();
        for (const doc of docs) {
          for (const key of Object.keys(doc)) {
            fieldSet.add(key);
          }
        }
        const fields = [...fieldSet].sort();

        const lines = [
          `Document Type: ${docType}`,
          `Total Documents: ${totalCount}`,
          `Fields discovered: ${fields.join(', ')}`,
          '',
          `Documents (showing ${docs.length} of ${totalCount}):`,
          '---',
        ];

        for (const doc of docs) {
          const updated = doc._updatedAt ? doc._updatedAt.split('T')[0] : 'unknown';
          const title = doc.title || doc.name || doc.heading || doc._id;
          lines.push(`"${title}" (id: ${doc._id}) -- updated: ${updated}`);

          // Show a preview of data fields (skip internal _ fields)
          const dataKeys = Object.keys(doc).filter(k => !k.startsWith('_')).slice(0, 8);
          for (const k of dataKeys) {
            let val = doc[k];
            if (val === null || val === undefined) val = '(empty)';
            else if (typeof val === 'object') {
              val = JSON.stringify(val).substring(0, 80);
              if (JSON.stringify(doc[k]).length > 80) val += '...';
            } else {
              val = String(val).substring(0, 80);
              if (String(doc[k]).length > 80) val += '...';
            }
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
        const [, docType, docId] = refsMatch;
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        // Incoming: documents that reference this one
        const inR = await sanityQuery(cfg,
          `*[references($id)][0...50]{_id, _type, title, name, heading, _updatedAt}`,
          { id: docId }
        );
        const incoming = (inR.data && inR.data.result) || [];

        // Outgoing: references from this document's fields
        const docR = await sanityQuery(cfg, `*[_id == $id][0]`, { id: docId });
        const doc = (docR.data && docR.data.result) || {};
        const outgoing = [];
        function extractRefs(obj, path) {
          if (!obj || typeof obj !== 'object') return;
          if (obj._ref) {
            outgoing.push({ _ref: obj._ref, _type: obj._type || 'reference', _path: path });
            return;
          }
          if (Array.isArray(obj)) {
            obj.forEach((item, i) => extractRefs(item, path + '[' + i + ']'));
          } else {
            for (const [k, v] of Object.entries(obj)) {
              if (!k.startsWith('_')) extractRefs(v, path ? path + '.' + k : k);
            }
          }
        }
        extractRefs(doc, '');

        // Resolve outgoing refs to get titles
        if (outgoing.length > 0) {
          const refIds = [...new Set(outgoing.map(r => r._ref))];
          const resolveR = await sanityQuery(cfg,
            `*[_id in $ids]{_id, _type, title, name, heading}`,
            { ids: refIds }
          );
          const resolved = {};
          ((resolveR.data && resolveR.data.result) || []).forEach(d => { resolved[d._id] = d; });
          outgoing.forEach(r => {
            const rd = resolved[r._ref];
            if (rd) {
              r.title = rd.title || rd.name || rd.heading || r._ref;
              r.resolvedType = rd._type;
            }
          });
        }

        return json(res, { incoming, outgoing });
      }

      // -- Assets Endpoint -------------------------------------------------------
      if (subpath === '/assets' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const assetType = url.searchParams.get('type') || 'all'; // all, image, file
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);

        let typeFilter = '(_type == "sanity.imageAsset" || _type == "sanity.fileAsset")';
        if (assetType === 'image') typeFilter = '_type == "sanity.imageAsset"';
        else if (assetType === 'file') typeFilter = '_type == "sanity.fileAsset"';

        const r = await sanityQuery(cfg,
          `*[${typeFilter}] | order(_updatedAt desc) [${offset}...${offset + limit}]{
            _id, _type, originalFilename, url, path, size, mimeType,
            metadata { dimensions { width, height } },
            _createdAt, _updatedAt
          }`
        );
        if (r.status >= 400) return json(res, { error: r.data.message || 'Query failed' }, r.status);

        // Count total
        const countR = await sanityQuery(cfg, `count(*[${typeFilter}])`);
        const total = (countR.data && countR.data.result) || 0;

        return json(res, { assets: r.data.result || [], total });
      }

      // GET /assets/:id/usage -- find documents using this asset
      const assetUsageMatch = subpath.match(/^\/assets\/([^/]+)\/usage$/);
      if (assetUsageMatch && method === 'GET') {
        const assetId = assetUsageMatch[1];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const r = await sanityQuery(cfg,
          `*[references($id)][0...50]{_id, _type, title, name, heading, _updatedAt}`,
          { id: assetId }
        );
        if (r.status >= 400) return json(res, { error: r.data.message || 'Query failed' }, r.status);
        return json(res, r.data.result || []);
      }

      // -- Drafts Endpoint -------------------------------------------------------
      if (subpath === '/drafts' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const r = await sanityQuery(cfg,
          `*[_id in path("drafts.**") && !(_type match "system.*") && !(_type match "sanity.*") && !(_id match "drafts._.*")] | order(_updatedAt desc) [0...${limit}]{
            _id, _type, title, name, heading, _createdAt, _updatedAt
          }`
        );
        if (r.status >= 400) return json(res, { error: r.data.message || 'Query failed' }, r.status);
        return json(res, r.data.result || []);
      }

      // POST /drafts/:id/publish -- publish a draft (copy draft to non-draft ID)
      const draftPubMatch = subpath.match(/^\/drafts\/([^/]+)\/publish$/);
      if (draftPubMatch && method === 'POST') {
        const draftId = draftPubMatch[1];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        // Fetch the draft document
        const fullDraftId = draftId.startsWith('drafts.') ? draftId : 'drafts.' + draftId;
        const dr = await sanityQuery(cfg, `*[_id == $id][0]`, { id: fullDraftId });
        if (dr.status >= 400 || !dr.data.result) {
          return json(res, { error: 'Draft not found' }, 404);
        }
        const doc = dr.data.result;
        const publishedId = fullDraftId.replace(/^drafts\./, '');

        // Create/replace the published version and delete the draft
        const mutations = [
          { createOrReplace: { ...doc, _id: publishedId } },
          { delete: { id: fullDraftId } },
        ];
        const r = await sanityMutate(cfg, mutations, { returnIds: true });
        if (r.status >= 400) return json(res, { error: r.data.message || 'Publish failed' }, r.status);
        return json(res, { ok: true, publishedId });
      }

      // POST /drafts/:id/discard -- delete a draft without publishing
      const draftDiscardMatch = subpath.match(/^\/drafts\/([^/]+)\/discard$/);
      if (draftDiscardMatch && method === 'POST') {
        const draftId = draftDiscardMatch[1];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        const fullDraftId = draftId.startsWith('drafts.') ? draftId : 'drafts.' + draftId;
        const r = await sanityMutate(cfg, [{ delete: { id: fullDraftId } }]);
        if (r.status >= 400) return json(res, { error: r.data.message || 'Discard failed' }, r.status);
        return json(res, { ok: true });
      }

      // -- Health Check Endpoint -------------------------------------------------
      if (subpath === '/health' && method === 'GET') {
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        // Run multiple health queries in parallel
        const [typesR, draftsR, recentR, assetsR] = await Promise.all([
          sanityQuery(cfg, `*[!(_type match "system.*") && !(_type match "sanity.*") && defined(_type)]{_type}`),
          sanityQuery(cfg, `count(*[_id in path("drafts.**") && !(_type match "system.*") && !(_type match "sanity.*") && !(_id match "drafts._.*")])`),
          sanityQuery(cfg, `*[!(_type match "system.*") && !(_type match "sanity.*")] | order(_updatedAt desc) [0...10]{_id, _type, title, name, heading, _updatedAt, _createdAt}`),
          sanityQuery(cfg, `{"images": count(*[_type == "sanity.imageAsset"]), "files": count(*[_type == "sanity.fileAsset"])}`),
        ]);

        // Count types
        const typeCounts = {};
        for (const doc of ((typesR.data && typesR.data.result) || [])) {
          typeCounts[doc._type] = (typeCounts[doc._type] || 0) + 1;
        }
        const types = Object.entries(typeCounts).map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const totalDocs = types.reduce((sum, t) => sum + t.count, 0);

        const draftsCount = (draftsR.data && draftsR.data.result) || 0;
        const recent = (recentR.data && recentR.data.result) || [];
        const assetCounts = (assetsR.data && assetsR.data.result) || {};

        // Build issues list
        const issues = [];
        if (draftsCount > 20) {
          issues.push({ level: 'warn', message: draftsCount + ' unpublished drafts -- consider reviewing and publishing or discarding old drafts.' });
        }
        const emptyTypes = types.filter(t => t.count === 0);
        if (emptyTypes.length > 0) {
          issues.push({ level: 'info', message: emptyTypes.length + ' empty document type(s): ' + emptyTypes.map(t => t.name).join(', ') });
        }

        return json(res, {
          projectId: cfg.projectId,
          dataset: cfg.dataset,
          ...getEnvFields(cfg),
          repoPath: cfg.repoPath || '',
          studioUrl: cfg.studioUrl || '',
          types,
          totalDocuments: totalDocs,
          totalTypes: types.length,
          draftsCount,
          assets: assetCounts,
          recent,
          issues,
        });
      }

      // -- Content Audit (find issues in a specific type) -----------------------
      const auditMatch = subpath.match(/^\/audit\/([^/]+)$/);
      if (auditMatch && method === 'GET') {
        const docType = auditMatch[1];
        const cfg = getPluginConfig();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);

        // Fetch all docs of this type (up to 200)
        const r = await sanityQuery(cfg,
          `*[_type == $type] | order(_updatedAt desc) [0...200]`,
          { type: docType }
        );
        if (r.status >= 400) return json(res, { error: r.data.message || 'Query failed' }, r.status);
        const docs = r.data.result || [];

        const issues = [];
        const now = Date.now();
        const staleThreshold = 90 * 24 * 60 * 60 * 1000; // 90 days

        for (const doc of docs) {
          const title = doc.title || doc.name || doc.heading || doc._id;
          // Check for missing title/name
          if (!doc.title && !doc.name && !doc.heading) {
            issues.push({ docId: doc._id, title: doc._id, level: 'warn', issue: 'Missing title/name/heading field' });
          }
          // Check for stale content
          if (doc._updatedAt && (now - new Date(doc._updatedAt).getTime()) > staleThreshold) {
            const days = Math.floor((now - new Date(doc._updatedAt).getTime()) / (24 * 60 * 60 * 1000));
            issues.push({ docId: doc._id, title, level: 'info', issue: 'Not updated in ' + days + ' days' });
          }
          // Check for draft status
          if (doc._id.startsWith('drafts.')) {
            issues.push({ docId: doc._id, title, level: 'info', issue: 'Unpublished draft' });
          }
        }

        return json(res, { type: docType, totalDocuments: docs.length, issues });
      }

      // -- Repo Endpoints (local codebase access) --------------------------------

      // GET /repo/info -- basic info about the configured local repo
      if (subpath === '/repo/info' && method === 'GET') {
        const cfg = getPluginConfig();
        const repoPath = cfg.repoPath || '';
        if (!repoPath) return json(res, { error: 'No local repo path configured. Add it in Settings > Plugins > Sanity.' }, 400);
        if (!fs.existsSync(repoPath)) return json(res, { error: 'Repo path does not exist: ' + repoPath }, 404);

        // Detect project structure
        const info = { repoPath, exists: true, hasPackageJson: false, hasSanityConfig: false, studioPath: '', framework: 'unknown' };
        if (fs.existsSync(path.join(repoPath, 'package.json'))) {
          info.hasPackageJson = true;
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
            if (pkg.dependencies && pkg.dependencies.next) info.framework = 'next';
            else if (pkg.dependencies && pkg.dependencies.gatsby) info.framework = 'gatsby';
            else if (pkg.dependencies && pkg.dependencies.react) info.framework = 'react';
            else if (pkg.dependencies && pkg.dependencies.nuxt) info.framework = 'nuxt';
            else if (pkg.dependencies && pkg.dependencies.svelte) info.framework = 'svelte';
          } catch (_) {}
        }
        // Detect Sanity config
        const sanityConfigs = ['sanity.config.ts', 'sanity.config.js', 'sanity.config.mjs'];
        for (const sc of sanityConfigs) {
          if (fs.existsSync(path.join(repoPath, sc))) { info.hasSanityConfig = true; break; }
        }
        // Detect studio subdirectory
        const studioDirs = ['studio', 'sanity', 'cms', 'sanity-studio'];
        for (const sd of studioDirs) {
          const sp = path.join(repoPath, sd);
          if (fs.existsSync(sp) && sanityConfigs.some(sc => fs.existsSync(path.join(sp, sc)))) {
            info.studioPath = sp;
            break;
          }
        }
        return json(res, info);
      }

      // GET /repo/schemas -- find and return Sanity schema files from the local repo
      if (subpath === '/repo/schemas' && method === 'GET') {
        const cfg = getPluginConfig();
        const repoPath = cfg.repoPath || '';
        if (!repoPath || !fs.existsSync(repoPath)) return json(res, { error: 'Repo path not configured or does not exist' }, 400);

        // Search common schema locations
        const schemaFiles = [];
        const searchDirs = [
          repoPath,
          path.join(repoPath, 'schemas'),
          path.join(repoPath, 'src', 'schemas'),
          path.join(repoPath, 'sanity', 'schemas'),
          path.join(repoPath, 'sanity', 'schema'),
          path.join(repoPath, 'studio', 'schemas'),
          path.join(repoPath, 'studio', 'schema'),
          path.join(repoPath, 'cms', 'schemas'),
        ];
        function findSchemaFiles(dir, depth) {
          if (depth > 3 || !fs.existsSync(dir)) return;
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
              const full = path.join(dir, e.name);
              if (e.isDirectory()) {
                findSchemaFiles(full, depth + 1);
              } else if (/\.(ts|js|tsx|jsx)$/.test(e.name)) {
                // Check if file looks like a Sanity schema
                try {
                  const content = fs.readFileSync(full, 'utf8');
                  if (content.includes('defineType') || content.includes('defineField') ||
                      (content.includes('type:') && content.includes('name:') && content.includes('fields:'))) {
                    schemaFiles.push({
                      path: full.replace(/\\/g, '/'),
                      relativePath: path.relative(repoPath, full).replace(/\\/g, '/'),
                      name: e.name,
                      size: content.length,
                    });
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
        for (const dir of searchDirs) findSchemaFiles(dir, 0);
        // Deduplicate by path
        const seen = new Set();
        const unique = schemaFiles.filter(f => { if (seen.has(f.path)) return false; seen.add(f.path); return true; });
        return json(res, unique);
      }

      // GET /repo/schema/:filename -- read a specific schema file's content
      const schemaFileMatch = subpath.match(/^\/repo\/schema\/(.+)$/);
      if (schemaFileMatch && method === 'GET') {
        const cfg = getPluginConfig();
        const repoPath = cfg.repoPath || '';
        if (!repoPath) return json(res, { error: 'Repo path not configured' }, 400);
        const relPath = decodeURIComponent(schemaFileMatch[1]);
        const fullPath = path.resolve(repoPath, relPath);
        // Security: ensure the resolved path is inside the repo
        if (!fullPath.startsWith(path.resolve(repoPath))) return json(res, { error: 'Path outside repo' }, 403);
        if (!fs.existsSync(fullPath)) return json(res, { error: 'File not found' }, 404);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          return json(res, { path: fullPath.replace(/\\/g, '/'), content });
        } catch (e) {
          return json(res, { error: e.message }, 500);
        }
      }

      // GET /repo/components -- find frontend components in the local repo
      if (subpath === '/repo/components' && method === 'GET') {
        const cfg = getPluginConfig();
        const repoPath = cfg.repoPath || '';
        if (!repoPath || !fs.existsSync(repoPath)) return json(res, { error: 'Repo path not configured or does not exist' }, 400);

        const componentFiles = [];
        const searchDirs = [
          path.join(repoPath, 'components'),
          path.join(repoPath, 'src', 'components'),
          path.join(repoPath, 'app', 'components'),
          path.join(repoPath, 'src', 'app', 'components'),
        ];
        function findComponents(dir, depth) {
          if (depth > 4 || !fs.existsSync(dir)) return;
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
              const full = path.join(dir, e.name);
              if (e.isDirectory()) {
                findComponents(full, depth + 1);
              } else if (/\.(tsx|jsx|ts|js)$/.test(e.name) && !e.name.endsWith('.test.ts') && !e.name.endsWith('.test.tsx') && !e.name.endsWith('.spec.ts')) {
                componentFiles.push({
                  path: full.replace(/\\/g, '/'),
                  relativePath: path.relative(repoPath, full).replace(/\\/g, '/'),
                  name: e.name,
                });
              }
            }
          } catch (_) {}
        }
        for (const dir of searchDirs) findComponents(dir, 0);
        return json(res, componentFiles);
      }

      // GET /repo/file/:filepath -- read any file from the repo (for AI analysis)
      const repoFileMatch = subpath.match(/^\/repo\/file\/(.+)$/);
      if (repoFileMatch && method === 'GET') {
        const cfg = getPluginConfig();
        const repoPath = cfg.repoPath || '';
        if (!repoPath) return json(res, { error: 'Repo path not configured' }, 400);
        const relPath = decodeURIComponent(repoFileMatch[1]);
        const fullPath = path.resolve(repoPath, relPath);
        if (!fullPath.startsWith(path.resolve(repoPath))) return json(res, { error: 'Path outside repo' }, 403);
        if (!fs.existsSync(fullPath)) return json(res, { error: 'File not found' }, 404);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          return json(res, { path: fullPath.replace(/\\/g, '/'), content });
        } catch (e) {
          return json(res, { error: e.message }, 500);
        }
      }

      // GET /repo/tree -- directory listing of the repo (shallow)
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
        } catch (e) {
          return json(res, { error: e.message }, 500);
        }
      }

      // -- Preview Check (HEAD) -------------------------------------------------
      // Quick server-side check whether a URL is reachable (2xx/3xx).
      // Used by the tab to decide whether to show the preview panel.
      if (subpath === '/preview-check' && method === 'GET') {
        const target = url.searchParams.get('url');
        if (!target) return json(res, { ok: false, error: 'url parameter required' });
        try {
          const status = await new Promise((resolve, reject) => {
            let urlObj;
            try { urlObj = new URL(target); }
            catch (e) { return reject(e); }
            const lib = urlObj.protocol === 'http:' ? http : https;
            const rq = lib.request({
              hostname: urlObj.hostname,
              port: urlObj.port || (urlObj.protocol === 'http:' ? 80 : 443),
              path: urlObj.pathname + urlObj.search,
              method: 'HEAD',
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
              timeout: 8000,
            }, (resp) => {
              resp.resume();
              resolve(resp.statusCode);
            });
            rq.on('error', reject);
            rq.on('timeout', () => { rq.destroy(); reject(new Error('timeout')); });
            rq.end();
          });
          return json(res, { ok: status >= 200 && status < 400, status });
        } catch (e) {
          return json(res, { ok: false, error: e.message });
        }
      }

      // -- Preview Proxy ------------------------------------------------------
      // Fetches the live page server-side and returns the HTML with a
      // <base> tag so relative assets resolve. Strips X-Frame-Options and
      // CSP headers so the iframe can render any site.
      if (subpath === '/preview' && method === 'GET') {
        const target = url.searchParams.get('url');
        if (!target) return json(res, { error: 'url parameter required' }, 400);
        try {
          const html = await new Promise((resolve, reject) => {
            let urlObj;
            try { urlObj = new URL(target); }
            catch (e) { return reject(new Error('Invalid URL: ' + target)); }
            const lib = urlObj.protocol === 'http:' ? http : https;
            const opts = {
              hostname: urlObj.hostname,
              port: urlObj.port || (urlObj.protocol === 'http:' ? 80 : 443),
              path: urlObj.pathname + urlObj.search,
              method: 'GET',
              headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Encoding': 'identity',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
              },
            };
            const rq = lib.request(opts, (resp) => {
              // Follow one level of redirect
              if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
                const next = new URL(resp.headers.location, target).toString();
                lib.get(next, { headers: opts.headers }, (r2) => {
                  const cks = [];
                  r2.on('data', c => cks.push(c));
                  r2.on('end', () => resolve(Buffer.concat(cks).toString('utf8')));
                }).on('error', reject);
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
          // Determine the origin of the target site for URL rewriting
          const targetObj = new URL(target);
          const origin = targetObj.origin; // e.g. https://siteexample05.netlify.app
          // Strip CSP meta tags
          out = out.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
          // Strip X-Frame-Options meta
          out = out.replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');
          // Rewrite relative URLs to absolute so assets load from the real site.
          // This avoids <base> which breaks Next.js/React hydration.
          // Handles: href="/...", src="/...", content="/...", action="/..."
          out = out.replace(/((?:href|src|action|content)\s*=\s*["'])(\/[^"']*)/gi, (m, attr, path) => {
            // Skip anchor-only refs and data: URIs
            if (path.startsWith('//')) return m;
            return attr + origin + path;
          });
          // Rewrite url() in inline styles
          out = out.replace(/url\(\s*["']?(\/[^)"'\s]+)/gi, (m, path) => {
            return 'url(' + origin + path;
          });
          // Rewrite srcset values
          out = out.replace(/srcset\s*=\s*["']([^"']+)/gi, (m, srcset) => {
            const rewritten = srcset.replace(/(^|,\s*)(\/[^\s,]+)/g, (sm, pre, path) => {
              return pre + origin + path;
            });
            return 'srcset="' + rewritten;
          });
          // Prevent top navigation inside iframe and block client-side errors
          const guard = '<style>html,body{margin:0}</style><script>'
            + 'document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a");if(a){e.preventDefault();}},true);'
            + 'window.onerror=function(){return true};'
            + 'window.onunhandledrejection=function(e){e.preventDefault()};'
            + '</script>';
          if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, guard + '</head>');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Frame-Options': 'SAMEORIGIN',
          });
          return res.end(out);
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end('<html><body style="font:12px sans-serif;color:#888;padding:20px">Preview failed: ' + String(e.message || e).replace(/</g, '&lt;') + '</body></html>');
        }
      }

      // Unknown route
      return false;

    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  });
};
