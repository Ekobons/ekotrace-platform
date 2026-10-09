/**
 * User manual: chapters written in Markdown (src/manual/NN-name.md, shipped with each
 * release, so the manual always matches the version in use), with flow charts and
 * diagrams written as text (see ManualBlocks). Searchable and printable.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { marked } from 'marked';
import { Diagram, Flow, Layers } from '../components/ManualBlocks';
import { Icon } from '../components/Icon';

const files = import.meta.glob('../manual/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface Chapter { id: string; title: string; src: string; sections: { id: string; title: string }[] }
const CHAPTERS: Chapter[] = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, src]) => {
  const title = /^#\s+(.+)$/m.exec(src)?.[1] ?? path;
  const sections = [...src.replace(/```[\s\S]*?```/g, '').matchAll(/^##\s+(.+)$/gm)].map((m) => ({ id: slug(m[1]!), title: m[1]! }));
  return { id: slug(title), title, src, sections };
});

/** Markdown with ```flow / ```layers / ```diagram blocks turned into pictures. */
function Rendered({ src }: { src: string }) {
  const parts = useMemo(() => {
    const out: { kind: 'md' | 'flow' | 'layers' | 'diagram'; body: string }[] = [];
    const re = /```(flow|layers|diagram)([^\n]*)\n([\s\S]*?)```/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      out.push({ kind: 'md', body: src.slice(last, m.index) });
      out.push({ kind: m[1] as 'flow', body: m[1] === 'diagram' ? m[2]!.trim() : m[3]! });
      last = m.index + m[0].length;
    }
    out.push({ kind: 'md', body: src.slice(last) });
    return out;
  }, [src]);
  return <>{parts.map((p, i) => (
    <Fragment key={i}>
      {p.kind === 'md' && <div dangerouslySetInnerHTML={{ __html: (marked.parse(p.body, { async: false }) as string).replace(/<h([23])>(.*?)<\/h\1>/g, (_x, n, t) => `<h${n} id="${slug(t)}">${t}</h${n}>`) }} />}
      {p.kind === 'flow' && <Flow src={p.body} />}
      {p.kind === 'layers' && <Layers src={p.body} />}
      {p.kind === 'diagram' && <Diagram name={p.body} />}
    </Fragment>
  ))}</>;
}

export function Manual() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [printAll, setPrintAll] = useState(false);
  const current = CHAPTERS.find((c) => c.id === params.get('c')) ?? CHAPTERS[0]!;
  const idx = CHAPTERS.indexOf(current);
  const go = (id: string, section?: string) => {
    setParams({ c: id }, { replace: false });
    window.setTimeout(() => (section ? document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' }) : window.scrollTo({ top: 0 })), 30);
  };
  useEffect(() => { if (printAll) { const t = window.setTimeout(() => { window.print(); setPrintAll(false); }, 300); return () => window.clearTimeout(t); } }, [printAll]);

  const needle = q.trim().toLowerCase();
  const hits = needle ? CHAPTERS.flatMap((c) => {
    const parts = c.src.split(/^##\s+/m);
    return parts.slice(1).filter((p) => p.toLowerCase().includes(needle)).map((p) => ({ c, title: p.split('\n')[0]!, id: slug(p.split('\n')[0]!) }))
      .concat(parts[0]!.toLowerCase().includes(needle) ? [{ c, title: c.title, id: '' }] : []);
  }) : [];

  return (
    <div className="page manual">
      <div className="head no-print">
        <div><div className="eyebrow">Help</div><h1>User manual</h1><p className="sub">How Ekotrace works: data categories, entering data, meters, bills, factors, integrations and security. Updated with every release.</p></div>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => setPrintAll(true)}><Icon name="doc" />Print / save as PDF</button>
      </div>
      <div className="grid2">
        <nav className="card mtoc no-print">
          <input className="input" placeholder="Search the manual…" value={q} onChange={(e) => setQ(e.target.value)} />
          {needle ? (
            <div className="list">{hits.length ? hits.map((h, i) => (
              <button key={i} onClick={() => go(h.c.id, h.id || undefined)}><span>{h.title}<div className="muted small">{h.c.title}</div></span></button>
            )) : <div className="sub" style={{ padding: 8 }}>Nothing found.</div>}</div>
          ) : CHAPTERS.map((c, i) => (
            <div key={c.id}>
              <button className={`mtoc-ch ${c.id === current.id ? 'on' : ''}`} onClick={() => go(c.id)}><span className="n">{i + 1}</span>{c.title}</button>
              {c.id === current.id && <div className="mtoc-sec">{c.sections.map((s) => <button key={s.id} onClick={() => go(c.id, s.id)}>{s.title}</button>)}</div>}
            </div>
          ))}
        </nav>
        <article className="card mdoc">
          {(printAll ? CHAPTERS : [current]).map((c) => <section key={c.id} className="mchapter"><Rendered src={c.src} /></section>)}
          <div className="row no-print" style={{ justifyContent: 'space-between', marginTop: 24 }}>
            {idx > 0 ? <button className="btn" onClick={() => go(CHAPTERS[idx - 1]!.id)}>← {CHAPTERS[idx - 1]!.title}</button> : <span />}
            {idx < CHAPTERS.length - 1 && <button className="btn" onClick={() => go(CHAPTERS[idx + 1]!.id)}>{CHAPTERS[idx + 1]!.title} →</button>}
          </div>
        </article>
      </div>
    </div>
  );
}
