// Tiny Markdown subset for the legal templates, rendered as React elements (never as HTML, so a
// template cannot inject markup): # / ## / ### headings, paragraphs, "- " lists, **bold**,
// [text](url) links and [[placeholders]] (highlighted: to be filled in by the operator).
// Unlike standard Markdown, a line break inside a paragraph is kept (addresses).
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; items: string[] };

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', lines: paragraph });
    if (list) blocks.push({ kind: 'list', items: list });
    paragraph = [];
    list = null;
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!,
      });
    } else if (line.startsWith('- ')) {
      if (paragraph.length) flush();
      (list ??= []).push(line.slice(2));
    } else if (list) {
      // Continuation of the last list item.
      list[list.length - 1] += ` ${line}`;
    } else paragraph.push(line);
  }
  flush();
  return blocks;
}

const INLINE = /\*\*(.+?)\*\*|\[\[(.+?)\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = m.index;
    if (m[1] !== undefined) out.push(<strong key={key}>{renderInline(m[1])}</strong>);
    else if (m[2] !== undefined)
      out.push(
        <mark key={key} className="rounded bg-amber-100 px-1 text-amber-950">
          [{m[2]}]
        </mark>,
      );
    else {
      const [label, href] = [m[3]!, m[4]!];
      out.push(
        href.startsWith('/') ? (
          <Link key={key} to={href} className="font-semibold text-brand-900 underline">
            {label}
          </Link>
        ) : /^(https:|mailto:|tel:)/.test(href) ? (
          <a
            key={key}
            href={href}
            className="font-semibold text-brand-900 underline"
            rel="noopener noreferrer"
          >
            {label}
          </a>
        ) : (
          label
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HEADING_CLASS = {
  1: 'text-2xl font-bold',
  2: 'mt-4 text-xl font-semibold',
  3: 'mt-2 text-lg font-semibold',
} as const;

export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseBlocks(source).map((b, i) => {
        if (b.kind === 'heading') {
          const H = `h${b.level}` as const;
          return (
            <H key={i} className={HEADING_CLASS[b.level]}>
              {renderInline(b.text)}
            </H>
          );
        }
        if (b.kind === 'list')
          return (
            <ul key={i} className="list-disc ps-6">
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
