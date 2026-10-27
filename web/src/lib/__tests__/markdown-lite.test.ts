import { hasLink, parseMarkdownLite } from "@/lib/markdown-lite";

/**
 * markdown-lite (card 3.2, PRD decision 4): comments are plain text with line
 * breaks; only http(s) URLs become links. These tests pin the parse so the
 * renderer never has to guess — and so a comment can never inject markup.
 */

describe("parseMarkdownLite", () => {
  it("returns nothing for an empty string", () => {
    expect(parseMarkdownLite("")).toEqual([]);
  });

  it("keeps plain text as a single node", () => {
    expect(parseMarkdownLite("Card declined")).toEqual([
      { kind: "text", text: "Card declined" },
    ]);
  });

  it("turns a line break into an explicit break node", () => {
    expect(parseMarkdownLite("first\nsecond")).toEqual([
      { kind: "text", text: "first" },
      { kind: "break" },
      { kind: "text", text: "second" },
    ]);
  });

  it("emits a break for a blank line but no empty text node", () => {
    expect(parseMarkdownLite("a\n\nb")).toEqual([
      { kind: "text", text: "a" },
      { kind: "break" },
      { kind: "break" },
      { kind: "text", text: "b" },
    ]);
  });

  it("auto-links an http(s) URL in the middle of prose", () => {
    expect(parseMarkdownLite("see https://example.com/run for details")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", href: "https://example.com/run", text: "https://example.com/run" },
      { kind: "text", text: " for details" },
    ]);
  });

  it("trims trailing punctuation off the link and keeps it as text", () => {
    expect(parseMarkdownLite("failed at https://example.com/x.")).toEqual([
      { kind: "text", text: "failed at " },
      { kind: "link", href: "https://example.com/x", text: "https://example.com/x" },
      { kind: "text", text: "." },
    ]);
  });

  it("does not treat bare markdown as formatting", () => {
    // No bold/list rendering — the asterisks are literal text.
    expect(parseMarkdownLite("**bold**")).toEqual([
      { kind: "text", text: "**bold**" },
    ]);
  });

  it("does not link a scheme with no host", () => {
    // "https://" alone is prose the user typed, not a URL.
    expect(parseMarkdownLite("see https:// here")).toEqual([
      { kind: "text", text: "see https:// here" },
    ]);
  });

  it("links two URLs on one line", () => {
    const nodes = parseMarkdownLite("http://a.test and https://b.test");
    expect(nodes.filter((node) => node.kind === "link")).toHaveLength(2);
  });
});

describe("hasLink", () => {
  it("is true only when a URL is present", () => {
    expect(hasLink("plain text")).toBe(false);
    expect(hasLink("a https://example.com b")).toBe(true);
  });
});