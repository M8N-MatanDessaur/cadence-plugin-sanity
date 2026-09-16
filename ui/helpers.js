/**
 * Small shared pieces: time, text, the orchestrator wait, Sanity's image CDN, and the two-way
 * conversion between Portable Text and HTML that lets a rich text field edit like a document.
 *
 * The conversion keeps what an editor touches - paragraphs, headings, quotes, lists, bold,
 * italic, underline, strike, code, links - and refuses (returns null) when a value holds
 * anything else, so a custom block is never silently flattened. The screen then shows JSON.
 */

export function stripHtml(text) {
  return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function ago(iso) {
  if (!iso) return 'at some point';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

export async function waitForTask(api, id, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const t = await api(`/api/orchestrator/task?id=${id}`).catch(() => null);
    if (!t) continue;
    if (t.state === 'completed') return t.result || '(finished with nothing to say)';
    if (['failed', 'cancelled', 'timeout'].includes(t.state)) return t.error || `The worker ${t.state}.`;
  }
  return 'It is taking too long; the answer will land in the orchestrator.';
}

/** The local model first, then a spawned CLI. Returns the text, stripped of the bootstrap tag. */
export async function askModel(api, { prompt, system, maxTokens = 900, from = 'sanity', timeout = 180000 }) {
  let text = '';
  try { text = String((await api('/api/notes/ai', { method: 'POST', body: JSON.stringify({ prompt, system, maxTokens }) })).text || '').trim(); } catch (_) {}
  if (!text) {
    const cfg = await api('/api/config').catch(() => ({}));
    const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from, timeout, prompt: `${system}\n\n${prompt}\n\nThis is a one-off answer: do not run any bootstrap, do not save anything to Mind or any memory, do not mention either. Reply with the answer only.` }) });
    text = String(result.handledLocally ? result.answer : result.id ? await waitForTask(api, result.id, timeout) : (result.error || '')).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim();
  }
  return text;
}

export const textOf = (v, depth = 0) => {
  if (v == null || depth > 6) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) { for (const x of v) { const t = textOf(x, depth + 1); if (t) return t; } return ''; }
  if (typeof v === 'object') {
    for (const k of ['en', 'en_US', 'en-US', 'fr', 'current', 'value', 'text', 'title', 'name']) { const t = textOf(v[k], depth + 1); if (t) return t; }
    for (const [k, x] of Object.entries(v)) { if (k.startsWith('_') || k === 'marks') continue; const t = textOf(x, depth + 1); if (t) return t; }
  }
  return '';
};
export const titleOf = (d) => (d && (textOf(d.title) || textOf(d.name) || textOf(d.heading) || textOf(d.headline) || textOf(d.label) || (d.slug && textOf(d.slug.current)) || d._id)) || '';
export const slugOf = (d) => (d && d.slug ? (typeof d.slug === 'string' ? d.slug : d.slug.current || '') : '');
export const newKey = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
export const bytes = (n) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** https://cdn.sanity.io/images/<project>/<dataset>/<hash>-<WxH>.<ext>, with optional width. */
export function imageUrl(cdn, ref, width) {
  if (!cdn || !ref) return '';
  const m = String(ref).match(/^image-([a-f0-9]+)-(\d+x\d+)-(\w+)$/);
  if (!m) return '';
  return `https://cdn.sanity.io/images/${cdn.projectId}/${cdn.dataset}/${m[1]}-${m[2]}.${m[3]}${width ? `?w=${width}&fit=max&auto=format` : ''}`;
}
export function fileUrl(cdn, ref) {
  if (!cdn || !ref) return '';
  const m = String(ref).match(/^file-([a-f0-9]+)-(\w+)$/);
  if (!m) return '';
  return `https://cdn.sanity.io/files/${cdn.projectId}/${cdn.dataset}/${m[1]}.${m[2]}`;
}
export const imageDims = (ref) => { const m = String(ref || '').match(/-(\d+)x(\d+)-/); return m ? { width: Number(m[1]), height: Number(m[2]) } : null; };

// -- Portable Text <-> HTML ---------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MARK_TAG = { strong: 'strong', em: 'em', underline: 'u', 'strike-through': 's', code: 'code' };

export const isPortableText = (v) => Array.isArray(v) && v.length > 0 && v.every((b) => b && b._type === 'block' && Array.isArray(b.children));
export const looksLikePortableText = (v) => Array.isArray(v) && v.some((b) => b && b._type === 'block');

/** Plain text of a Portable Text value, for previews and search. */
export function ptToText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map((b) => (b && b._type === 'block' && Array.isArray(b.children) ? b.children.map((c) => c.text || '').join('') : b && b._type ? `[${b._type}]` : '')).filter(Boolean).join('\n');
}

/** HTML for the editor. Returns null when a block cannot be represented, so nothing is lost. */
export function ptToHtml(blocks) {
  if (!Array.isArray(blocks)) return null;
  let html = '';
  let list = null; // { kind, level }
  const closeList = () => { if (list) { html += list.kind === 'number' ? '</ol>' : '</ul>'; list = null; } };
  for (const b of blocks) {
    if (!b || b._type !== 'block' || !Array.isArray(b.children)) return null;
    const defs = Object.fromEntries((b.markDefs || []).map((d) => [d._key, d]));
    let inner = '';
    for (const c of b.children) {
      if (!c || c._type !== 'span') return null;
      let t = esc(c.text || '').replace(/\n/g, '<br>');
      for (const m of (c.marks || []).slice().reverse()) {
        if (MARK_TAG[m]) t = `<${MARK_TAG[m]}>${t}</${MARK_TAG[m]}>`;
        else if (defs[m] && defs[m]._type === 'link') t = `<a href="${esc(defs[m].href || '')}"${defs[m].blank ? ' target="_blank"' : ''}>${t}</a>`;
        else return null;
      }
      inner += t;
    }
    if (b.listItem) {
      const kind = b.listItem === 'number' ? 'number' : 'bullet';
      if (!list || list.kind !== kind) { closeList(); html += kind === 'number' ? '<ol>' : '<ul>'; list = { kind }; }
      html += `<li>${inner || '<br>'}</li>`;
      continue;
    }
    closeList();
    const style = b.style || 'normal';
    const tag = /^h[1-6]$/.test(style) ? style : style === 'blockquote' ? 'blockquote' : 'p';
    html += `<${tag}>${inner || '<br>'}</${tag}>`;
  }
  closeList();
  return html;
}

/** Portable Text from the editor's HTML. Keys of untouched blocks are kept where positions match. */
export function htmlToPt(html, previous) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstChild;
  const blocks = [];
  const prev = Array.isArray(previous) ? previous : [];
  const block = (style, listItem) => ({ _type: 'block', _key: newKey(), style, markDefs: [], children: [], ...(listItem ? { listItem, level: 1 } : {}) });
  const walkInline = (node, marks, b) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.textContent) b.children.push({ _type: 'span', _key: newKey(), text: n.textContent, marks: marks.slice() }); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { b.children.push({ _type: 'span', _key: newKey(), text: '\n', marks: marks.slice() }); continue; }
      const markOf = { strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'underline', s: 'strike-through', strike: 'strike-through', del: 'strike-through', code: 'code' }[tag];
      if (markOf) { walkInline(n, [...marks, markOf], b); continue; }
      if (tag === 'a') { const key = newKey(); b.markDefs.push({ _key: key, _type: 'link', href: n.getAttribute('href') || '', ...(n.getAttribute('target') === '_blank' ? { blank: true } : {}) }); walkInline(n, [...marks, key], b); continue; }
      walkInline(n, marks, b);
    }
  };
  const finish = (b) => { if (!b.children.length) b.children.push({ _type: 'span', _key: newKey(), text: '', marks: [] }); if (b.children.length === 1 && b.children[0].text === '\n') b.children[0].text = ''; blocks.push(b); };
  const walkBlock = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.textContent.trim()) { const b = block('normal'); b.children.push({ _type: 'span', _key: newKey(), text: n.textContent, marks: [] }); finish(b); } continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') { for (const li of n.children) { const b = block('normal', tag === 'ol' ? 'number' : 'bullet'); walkInline(li, [], b); finish(b); } continue; }
      if (/^h[1-6]$/.test(tag) || tag === 'blockquote' || tag === 'p' || tag === 'pre') { const b = block(tag === 'pre' ? 'normal' : tag); walkInline(n, tag === 'pre' ? ['code'] : [], b); finish(b); continue; }
      if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'li') { if ([...n.children].some((c) => /^(p|h[1-6]|ul|ol|blockquote|div)$/i.test(c.tagName))) walkBlock(n); else { const b = block('normal'); walkInline(n, [], b); finish(b); } continue; }
      const b = block('normal'); walkInline(n, [], b); finish(b);
    }
  };
  walkBlock(root);
  // Same text at the same position: keep the previous key so Sanity sees an edit, not a rewrite.
  blocks.forEach((b, i) => { const p = prev[i]; if (p && p._type === 'block' && ptToText([p]) === ptToText([b])) b._key = p._key; });
  return blocks;
}
