/**
 * Ask, as a bento: a question about the content, answered by the AI from the dataset.
 */
import { waitForTask } from './helpers.js';
import { Panel, Health, List, ListRow, FILL } from './kit.js';

const RECENT_KEY = 'sy.san.ask.recent';
const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 20))); } catch {} };
const when = (at) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const short = (s, n = 64) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);

function prepare({ health, project }) {
  const d = health.data;
  if (!d) return [];
  const out = [];
  if (d.draftsCount) out.push({ q: 'Which unpublished documents look ready to publish, and which are abandoned?', why: `${d.draftsCount} unpublished` });
  const pages = (d.types || []).filter((t) => /page|post|article|press/i.test(t.name));
  if (pages.length) out.push({ q: `List every ${pages.map((t) => t.name).join(' and ')} document with its slug and say which ones look thin or outdated.`, why: `${pages.reduce((n, t) => n + t.total, 0)} pages` });
  if (d.totalStale) out.push({ q: 'Which published documents have not been touched in 90 days, and do they still make sense?', why: 'stale content' });
  out.push({ q: 'Which images are used without alt text, and what alt text would you give them?', why: 'accessibility' });
  out.push({ q: 'What changed in the last two weeks, and in which types?', why: 'recent activity' });
  out.push({ q: 'Which types in the schema have no documents, and which documents have no schema?', why: 'schema hygiene' });
  out.push({ q: 'Summarise the site: what it is about, its main pages, and its tone.', why: 'orientation' });
  return out.slice(0, 7);
}

export function Ask({ host, api: API, project, health, onOpen }) {
  const { h, ui, api, react, icons } = host;
  const { useState, useEffect, useMemo } = react;
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [recent, setRecent] = useState(readRecent);
  useEffect(() => { if (!asking) { setElapsed(0); return undefined; } const started = Date.now(); const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000); return () => clearInterval(t); }, [asking]);
  const suggestions = useMemo(() => prepare({ health, project }), [health.data, project]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const ask = async (text) => {
    const asked = (text || question).trim();
    if (!asked || asking) return;
    setQuestion(asked); setAsking(true); setAnswer(null);
    const started = Date.now();
    try {
      const cfg = await api('/api/config').catch(() => ({}));
      const base = window.location.origin;
      const sp = `project=${encodeURIComponent(project)}`;
      const prompt = [
        `Answer a question about the content of the Sanity project "${project}". Today is ${new Date().toISOString().slice(0, 10)}.`,
        'Read from these READ-ONLY routes on the local Cadence server (plain GET with curl). Never call POST, PATCH, PUT or DELETE; never publish, edit or delete anything.',
        `  ${base}${API}/health?${sp}                                   types with counts, drafts, stale, issues, recent documents`,
        `  ${base}${API}/summary?${sp}                                  plain-text overview of every type`,
        `  ${base}${API}/summary/<type>?${sp}                           one type: its fields and every document with a data preview`,
        `  ${base}${API}/entries?type=<type>&q=&status=&${sp}           documents of a type, one row each, with slug and status`,
        `  ${base}${API}/document?id=<id>&${sp}                         one document in full, both versions, with its references`,
        `  ${base}${API}/insights?${sp}                                 every document with a problem (unpublished, stale, missing title or slug, alt text, broken references, empty required fields)`,
        `  ${base}${API}/schema?${sp}                                   the schema read from the repository`,
        '', `Question: ${asked}`, '',
        'Answer in Markdown from what you read only: a short lead, then bold labels, bullets or a table. Name documents as "<type>: <title>" and give their id so they can be opened. Say plainly if the data does not cover it.',
        'This is a one-off answer, not a session: do not run any bootstrap, do not save to Mind or any memory, do not mention either. Reply with the answer only.',
      ].join('\n');
      const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'sanity-ask', timeout: 300000, prompt }) });
      const text = result.handledLocally ? (result.answer || '(no answer)') : result.id ? await waitForTask(api, result.id, 300000) : (result.error || 'No answer came back.');
      const entry = { question: asked, answer: String(text).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim(), at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000) };
      setAnswer(entry); const next = [entry, ...recent.filter((e) => e.question !== asked)]; writeRecent(next); setRecent(next);
    } catch (e) { setAnswer({ question: asked, answer: e.message, at: new Date().toISOString(), seconds: 0 }); } finally { setAsking(false); }
  };
  const d = health.data;
  const answerPanel = asking
    ? Panel(host, { title: 'Reading the dataset', action: meta(`${elapsed}s`), ...FILL }, h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, 'The AI is reading the types and documents, then writing the answer.'), h(ui.Skeleton, { count: 5, height: 16 }))
    : !answer
      ? Panel(host, { title: 'Answer', action: meta('nothing asked yet'), ...FILL },
        h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, 'The AI reads the dataset through this plugin for whatever the question needs and answers from what it read. It never publishes or edits.'),
        h('div', { className: 'mhealth' }, Health(host, { label: 'types', value: d ? `${d.totalTypes}` : '...', tone: 'brass' }), Health(host, { label: 'documents', value: d ? `${d.totalDocuments}` : '...' }), Health(host, { label: 'unpublished', value: d ? `${d.draftsCount}` : '...' })))
      : Panel(host, { title: 'Answer', ...FILL, action: meta(`${when(answer.at)} - ${answer.seconds}s`) }, h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, answer.question), h(ui.Markdown, { source: answer.answer }));
  const column = (...children) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0, minHeight: 0 } }, ...children);
  return h('div', { className: 'san-ask', style: { flex: 1, minHeight: 0 } },
    column(
      Panel(host, { title: 'Ask about the content', action: meta(project || 'no project') },
        h('div', { style: { display: 'flex', gap: 8 } },
          h(ui.Input, { placeholder: '"which pages mention pricing?" or "what is still unpublished?"', value: question, disabled: asking, onChange: (e) => setQuestion(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') ask(); }, 'aria-label': 'Question' }),
          h(ui.Button, { variant: 'primary', disabled: asking || !question.trim(), onClick: () => ask() }, asking ? `Asking... ${elapsed}s` : 'Ask'))),
      answerPanel),
    column(
      Panel(host, { title: 'Worth asking', action: meta('from the dataset') },
        suggestions.length ? List(host, suggestions.map((s) => ListRow(host, { key: s.q, lead: h(icons.search, { size: 13, style: { opacity: 0.6, flex: 'none' } }), label: s.q, sub: s.why, onClick: asking ? undefined : () => ask(s.q) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Reading the dataset...')),
      Panel(host, { title: 'Recently asked', ...FILL, action: recent.length ? h('button', { type: 'button', className: 'mpanel__meta', style: { background: 'none', border: 0, cursor: 'pointer', padding: 0 }, onClick: () => { writeRecent([]); setRecent([]); } }, 'forget all') : meta('kept in the app') },
        recent.length ? List(host, recent.map((e) => ListRow(host, { key: e.at, lead: h(icons.history, { size: 13, style: { opacity: 0.6, flex: 'none' } }), label: short(e.question), sub: `${when(e.at)} - ${e.seconds}s`, onClick: () => { setQuestion(e.question); setAnswer(e); } }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing asked yet. Every answer is kept here and comes back in one click.'))));
}
