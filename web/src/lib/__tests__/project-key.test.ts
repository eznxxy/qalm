import {
  isValidProjectKey,
  normalizeProjectKey,
  PROJECT_KEY_PATTERN,
  suggestProjectKey,
} from "@/lib/project-key";

describe("normalizeProjectKey", () => {
  it.each([
    ["pay", "PAY"],
    [" Pay2 ", "PAY2"],
    ["a1b2", "A1B2"],
    ["PAY", "PAY"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeProjectKey(input)).toBe(expected);
  });
});

describe("isValidProjectKey (contract: 2-10 chars, ^[A-Z][A-Z0-9]*$)", () => {
  it("uses the contract regex", () => {
    expect(PROJECT_KEY_PATTERN.source).toBe("^[A-Z][A-Z0-9]*$");
  });

  it.each(["PAY", "A1", "AB12CD", "A".repeat(10)])("accepts %j", (key) => {
    expect(isValidProjectKey(key)).toBe(true);
  });

  it.each([
    ["A"], // too short (1 char)
    ["A".repeat(11)], // too long (11 chars)
    ["1AB"], // must start with a letter
    ["PAY-1"], // hyphen not allowed
    ["PAY X"], // space not allowed
    ["pay"], // lowercase (validate AFTER normalization)
    ["PÀY"], // non-ASCII
    [""], // empty
  ])("rejects %j", (key) => {
    expect(isValidProjectKey(key)).toBe(false);
  });

  it("accepts lowercase input once normalized (server parity)", () => {
    expect(isValidProjectKey(normalizeProjectKey("pay"))).toBe(true);
  });
});

describe("suggestProjectKey (PRD: first letters of the words, uppercased)", () => {
  it.each([
    ["Payments", "PAYMENTS"], // single word: falls back to leading alphanumerics
    ["Checkout and billing flows", "CABF"],
    ["payments core", "PC"],
    ["  Web   App  ", "WA"],
    ["Qalm 2e", "Q2"],
    ["hyperdriver", "HYPERDRIVE"], // clamped to 10 chars max
  ])("suggests %j from name %j", (name, expected) => {
    expect(suggestProjectKey(name)).toBe(expected);
  });

  it("keeps word-initial suggestions and clamps them to the 10-char maximum", () => {
    const suggested = suggestProjectKey(
      "Internationalization Platform Core Systems And Tools"
    );
    expect(suggested).toBe("IPCSAT");
    expect(suggested).toMatch(PROJECT_KEY_PATTERN);
    expect(suggested.length).toBeLessThanOrEqual(10);
  });

  it("returns '' for names without letters or digits", () => {
    expect(suggestProjectKey("   ")).toBe("");
    expect(suggestProjectKey("--- !!!")).toBe("");
  });

  it("produces a valid key whenever it returns anything", () => {
    for (const name of ["Payments", "foo bar baz qux", "e-commerce", "Ünicode Test"]) {
      const key = suggestProjectKey(name);
      if (key) expect(isValidProjectKey(key)).toBe(true);
    }
  });
});
