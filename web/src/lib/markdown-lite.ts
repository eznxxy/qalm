/**
 * "markdown-lite" comment rendering (docs/PRD-plans-runs.md decision 4,
 * docs/api-runs.md § Validation). Result comments are stored as **plain text**
 * with line breaks; only http(s) URLs are auto-detected and turned into links.
 * There is deliberately no full markdown renderer — no bold, lists or HTML — so
 * a comment can never inject markup into the drawer.
 *
 * `parseMarkdownLite` is the pure, testable half; `components/runs/MarkdownLite`
 * renders the nodes as React elements (never `dangerouslySetInnerHTML`).
 */

export type MarkdownLiteNode =
  | { kind: "text"; text: string }
  | { kind: "link"; href: string; text: string }
  | { kind: "break" };

/** Any run of non-space characters after an http(s):// scheme. */
const URL_RE = /https?:\/\/[^\s]+/g;

/** Trailing punctuation that is almost always prose, not part of the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/** Splits one line, emitting text runs and link nodes into `out`. */
function splitLine(line: string, out: MarkdownLiteNode[]): void {
  URL_RE.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(line)) !== null) {
    const start = match.index;
    // `https://` on its own is not a link the user typed; leave it as text.
    const href = match[0].replace(TRAILING_PUNCTUATION, "");
    if (href.replace(/^https?:\/\//, "") === "") continue;
    if (start > last) out.push({ kind: "text", text: line.slice(last, start) });
    out.push({ kind: "link", href, text: href });
    // Anything trimmed off the end (e.g. the "." after a URL) stays in text.
    last = start + href.length;
  }
  if (last < line.length) out.push({ kind: "text", text: line.slice(last) });
}

/**
 * Parses plain text into text / link / linebreak nodes. Line breaks become
 * explicit `break` nodes so the renderer can emit <br> without splitting the
 * surrounding inline flow.
 */
export function parseMarkdownLite(input: string): MarkdownLiteNode[] {
  const out: MarkdownLiteNode[] = [];
  const lines = input.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) out.push({ kind: "break" });
    if (line) splitLine(line, out);
  });
  return out;
}

/** True when the text contains at least one auto-linked http(s) URL. */
export function hasLink(input: string): boolean {
  return parseMarkdownLite(input).some((node) => node.kind === "link");
}