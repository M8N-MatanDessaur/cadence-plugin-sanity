/**
 * Reads Sanity schema definitions out of a repository without running them.
 *
 * Studio schemas are TypeScript objects: defineType({ name, type: 'document', fields: [...] })
 * or plain literals with the same shape. A small tolerant parser walks the object literals,
 * keeps what it can read (names, titles, types, fields, of, to, options.list, initialValue,
 * whether validation calls required()) and marks what it cannot (spreads, computed values)
 * as raw. The result is what the editor needs to draw a document field by field, and what
 * the AI needs to write one that fits.
 */
const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.next', 'out', 'build', 'static', '.cache', '.vercel', '.netlify', '.turbo', '__pycache__', 'coverage', '.sanity', '.git']);
const BUILTIN = new Set(['string', 'text', 'number', 'boolean', 'slug', 'image', 'file', 'reference', 'array', 'object', 'datetime', 'date', 'url', 'geopoint', 'block', 'email', 'crossDatasetReference', 'globalDocumentReference', 'document', 'span']);
const DEFINERS = new Set(['defineType', 'defineField', 'defineArrayMember']);

// -- A tolerant reader of object literals ------------------------------------

function skipWs(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    return i;
  }
}

function readString(src, i) {
  const q = src[i];
  let j = i + 1;
  let out = '';
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') { out += src[j + 1]; j += 2; continue; }
    out += src[j]; j++;
  }
  return { value: out, end: j + 1 };
}

/** Consumes a balanced expression up to a delimiter at depth 0; returns its raw text. */
function readRaw(src, i) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = readString(src, j).end; continue; }
    if (src.startsWith('//', j)) { while (j < src.length && src[j] !== '\n') j++; continue; }
    if (src.startsWith('/*', j)) { const e = src.indexOf('*/', j + 2); j = e < 0 ? src.length : e + 2; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
    else if (c === ',' && depth === 0) break;
    j++;
  }
  return { raw: src.slice(i, j).trim(), end: j };
}

function readValue(src, i) {
  i = skipWs(src, i);
  const c = src[i];
  if (c === '{') return readObject(src, i);
  if (c === '[') return readArray(src, i);
  if (c === '"' || c === "'" || c === '`') { const s = readString(src, i); return { value: s.value, end: s.end }; }
  const m = /^(-?\d+(?:\.\d+)?|true|false|null)(?![\w$])/.exec(src.slice(i, i + 40));
  if (m) return { value: m[1] === 'true' ? true : m[1] === 'false' ? false : m[1] === 'null' ? null : Number(m[1]), end: i + m[1].length };
  const id = /^([A-Za-z_$][\w$]*)\s*\(/.exec(src.slice(i, i + 60));
  if (id && DEFINERS.has(id[1])) {
    const open = i + id[0].length;
    const inner = readValue(src, open);
    let j = skipWs(src, inner.end);
    // skip anything else passed to the definer, up to its closing paren
    if (src[j] !== ')') { const r = readRaw(src, j); j = r.end; while (src[j] === ',') { const r2 = readRaw(src, j + 1); j = r2.end; } }
    return { value: inner.value, end: j + 1 };
  }
  const r = readRaw(src, i);
  return { value: { __raw: r.raw }, end: r.end };
}

function readArray(src, i) {
  const out = [];
  let j = i + 1;
  for (;;) {
    j = skipWs(src, j);
    if (j >= src.length) break;
    if (src[j] === ']') { j++; break; }
    if (src[j] === ',') { j++; continue; }
    if (src.startsWith('...', j)) { const r = readRaw(src, j + 3); out.push({ __spread: r.raw }); j = r.end; continue; }
    const v = readValue(src, j);
    out.push(v.value);
    j = v.end;
  }
  return { value: out, end: j };
}

function readObject(src, i) {
  const out = {};
  let j = i + 1;
  for (;;) {
    j = skipWs(src, j);
    if (j >= src.length) break;
    if (src[j] === '}') { j++; break; }
    if (src[j] === ',' || src[j] === ';') { j++; continue; }
    if (src.startsWith('...', j)) { const r = readRaw(src, j + 3); (out.__spreads = out.__spreads || []).push(r.raw); j = r.end; continue; }
    let key;
    if (src[j] === '"' || src[j] === "'") { const s = readString(src, j); key = s.value; j = s.end; }
    else if (src[j] === '[') { const r = readRaw(src, j + 1); key = `[${r.raw}]`; j = r.end + 1; }
    else { const m = /^(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)/.exec(src.slice(j, j + 80)); if (!m) { j++; continue; } key = m[1]; j += m[0].length; }
    j = skipWs(src, j);
    if (src[j] === '(') { const r = readRaw(src, j); j = r.end; j = skipWs(src, j); if (src[j] === '{') { const b = readRaw(src, j + 1); j = b.end + 1; } out[key] = { __raw: 'method' }; continue; }
    if (src[j] === ':') { const v = readValue(src, j + 1); out[key] = v.value; j = v.end; continue; }
    out[key] = { __raw: key };
  }
  return { value: out, end: j };
}

// -- From literals to what the editor wants ----------------------------------

const isRaw = (v) => v && typeof v === 'object' && !Array.isArray(v) && ('__raw' in v || '__spread' in v);
const str = (v) => (typeof v === 'string' ? v : undefined);

function normalizeField(f, seen) {
  if (!f || typeof f !== 'object' || Array.isArray(f) || isRaw(f)) return null;
  const type = str(f.type);
  if (!str(f.name) && !type) return null;
  const out = { name: str(f.name) || '', title: str(f.title) || '', type: type || 'object' };
  if (str(f.description)) out.description = f.description;
  if (f.validation && f.validation.__raw && /\.required\(\)/.test(f.validation.__raw)) out.required = true;
  if (f.hidden === true) out.hidden = true;
  if (f.readOnly === true) out.readOnly = true;
  if (f.initialValue !== undefined && !isRaw(f.initialValue)) out.initialValue = f.initialValue;
  if (typeof f.rows === 'number') out.rows = f.rows;
  if (f.options && typeof f.options === 'object' && !isRaw(f.options)) {
    const o = {};
    if (Array.isArray(f.options.list)) o.list = f.options.list.map((x) => (typeof x === 'string' ? { title: x, value: x } : x && !isRaw(x) ? { title: str(x.title) || String(x.value), value: x.value } : null)).filter(Boolean);
    if (f.options.hotspot === true) o.hotspot = true;
    if (str(f.options.source)) o.source = f.options.source;
    if (str(f.options.layout)) o.layout = f.options.layout;
    if (Object.keys(o).length) out.options = o;
  }
  if (Array.isArray(f.fields)) out.fields = f.fields.map((x) => normalizeField(x, seen)).filter(Boolean);
  if (f.fields && f.fields.__spreads) out.partial = true;
  if (Array.isArray(f.of)) out.of = f.of.map((x) => (isRaw(x) ? { type: '?', raw: x.__raw || x.__spread } : normalizeField(x, seen) || { type: str(x.type) || '?' })).filter(Boolean);
  if (Array.isArray(f.to)) out.to = f.to.map((x) => (x && !isRaw(x) ? str(x.type) : null)).filter(Boolean);
  if (Array.isArray(f.styles)) out.styles = f.styles.map((x) => (x && !isRaw(x) ? { title: str(x.title), value: str(x.value) } : null)).filter(Boolean);
  return out;
}

function walk(dir, depth, out) {
  if (depth > 7 || out.length > 600) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, depth + 1, out);
    else if (/\.(ts|js|tsx|jsx|mjs|cjs)$/.test(e.name) && !/\.(test|spec|d)\.[tj]sx?$/.test(e.name)) out.push(full);
  }
}

/** Every literal in a file that looks like a schema type (has name + type, and fields or a schema type). */
function typesInFile(src) {
  const found = [];
  const ranges = [];
  const inside = (i) => ranges.some(([a, b]) => i > a && i < b);
  const re = /\{\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(?:name|title|type)\s*:/g;
  let m;
  while ((m = re.exec(src))) {
    const at = m.index;
    if (inside(at)) continue;
    let parsed;
    try { parsed = readObject(src, at); } catch (_) { continue; }
    const v = parsed.value;
    const type = str(v.type);
    if (!str(v.name) || !type) continue;
    const isType = type === 'document' || type === 'object' || Array.isArray(v.fields) || (type === 'array' && Array.isArray(v.of)) || v.__fromDefine;
    if (!isType && !(type === 'document' || type === 'object')) continue;
    ranges.push([at, parsed.end]);
    const norm = normalizeField(v, new Set());
    if (norm) found.push(norm);
    re.lastIndex = parsed.end;
  }
  return found;
}

/**
 * Reads the whole repository. Returns
 * { documents: [type], objects: {name: type}, files: [{relativePath, types}], count }.
 * Every type carries `file`.
 */
function readSchema(repoPath) {
  const files = [];
  walk(repoPath, 0, files);
  const documents = [];
  const objects = {};
  const byFile = [];
  for (const full of files) {
    let src;
    try { src = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
    if (src.length > 400000) continue;
    if (!/defineType\(|defineField\(|type\s*:\s*['"](document|object)['"]/.test(src)) continue;
    const rel = path.relative(repoPath, full).replace(/\\/g, '/');
    const types = typesInFile(src);
    if (!types.length) continue;
    byFile.push({ relativePath: rel, types: types.map((t) => t.name) });
    for (const t of types) {
      t.file = rel;
      if (t.type === 'document') { if (!documents.some((d) => d.name === t.name)) documents.push(t); }
      else if (!objects[t.name]) objects[t.name] = t;
    }
  }
  return { documents, objects, files: byFile, count: documents.length + Object.keys(objects).length };
}

/** Expands custom object types into their fields so the editor can draw them, a few levels deep. */
function resolveField(f, objects, depth) {
  const out = { ...f };
  if (depth > 4) return out;
  if (!BUILTIN.has(f.type) && objects[f.type]) {
    const o = objects[f.type];
    out.objectType = f.type;
    if (!out.title) out.title = o.title || '';
    if (o.type === 'array' && o.of) out.type = 'array';
    else if (o.type === 'image' || o.type === 'file' || o.type === 'reference' || o.type === 'slug' || o.type === 'string' || o.type === 'text') { out.type = o.type; if (o.to) out.to = o.to; if (o.options) out.options = o.options; }
    else out.type = 'object';
    if (o.fields && !out.fields) out.fields = o.fields;
    if (o.of && !out.of) out.of = o.of;
    if (o.to && !out.to) out.to = o.to;
  }
  if (out.fields) out.fields = out.fields.map((x) => resolveField(x, objects, depth + 1));
  if (out.of) {
    // A spread or a helper call in `of` means the members are defined elsewhere: any object type fits.
    if (out.of.some((x) => x.type === '?')) out.anyObject = true;
    out.of = out.of.filter((x) => x.type !== '?').map((x) => resolveField(x, objects, depth + 1));
  }
  return out;
}

function resolveType(t, objects) {
  return { ...t, fields: (t.fields || []).map((f) => resolveField(f, objects, 0)) };
}

module.exports = { readSchema, resolveType, resolveField, typesInFile, BUILTIN };
