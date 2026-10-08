import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import React from "react";
import {
  isTypingTarget,
  resolveShortcut,
  useGlobalShortcuts,
  type ShortcutDefinition,
} from "@/lib/keymap";

/**
 * Unit tests for the §7 keymap primitives (card t_6ce021c1): typing-target
 * guarding, modifier discipline, scope filtering, and the hook's dispatch
 * lifecycle. The shell integration lives in app-shell.test.tsx.
 */

function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
}

function targetEvent(key: string, target: EventTarget | null, init: KeyboardEventInit = {}) {
  const event = keyEvent(key, init);
  Object.defineProperty(event, "target", { value: target });
  return event;
}

const noop = () => {};

describe("isTypingTarget", () => {
  it("treats input, textarea, select and contentEditable as typing targets", () => {
    const editable = document.createElement("div");
    // Attribute form: jest's jsdom does not implement the IDL mapping.
    editable.setAttribute("contenteditable", "true");
    expect(
      [document.createElement("input"), document.createElement("textarea"), document.createElement("select"), editable].map(
        isTypingTarget
      )
    ).toEqual([true, true, true, true]);
  });

  it("does not treat buttons, plain elements or null as typing targets", () => {
    expect(
      [document.createElement("button"), document.createElement("div")].map(isTypingTarget)
    ).toEqual([false, false]);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("resolveShortcut", () => {
  it("returns the handler for the matching key", () => {
    const handler = jest.fn();
    expect(resolveShortcut(keyEvent("?"), [{ key: "?", handler }])).toBe(handler);
  });

  it("returns null when no definition matches the key", () => {
    expect(resolveShortcut(keyEvent("x"), [{ key: "?", handler: noop }])).toBeNull();
    expect(resolveShortcut(keyEvent("?"), [])).toBeNull();
  });

  it("ignores plain keys while a form field has focus", () => {
    const input = document.createElement("input");
    expect(resolveShortcut(targetEvent("g", input), [{ key: "g", handler: noop }])).toBeNull();
  });

  it("fires allowInInputs definitions inside form fields (the / search focus)", () => {
    const input = document.createElement("input");
    const handler = jest.fn();
    expect(
      resolveShortcut(targetEvent("/", input), [{ key: "/", handler, allowInInputs: true }])
    ).toBe(handler);
  });

  it("an opted-in definition does not unlock the rest of the map", () => {
    const input = document.createElement("input");
    expect(
      resolveShortcut(
        targetEvent("g", input),
        [
          { key: "/", handler: noop, allowInInputs: true },
          { key: "g", handler: noop },
        ]
      )
    ).toBeNull();
  });

  it.each(["textarea", "select"])("guards typed keys in %s too", (tag) => {
    const el = document.createElement(tag);
    expect(resolveShortcut(targetEvent("n", el), [{ key: "n", handler: noop }])).toBeNull();
  });

  it("guards contentEditable targets", () => {
    // jest's jsdom does not implement the contentEditable IDL mapping
    // (isContentEditable is undefined, the setter does not reflect), so the
    // tests exercise the attribute — which the util reads directly and real
    // browsers set from the same markup.
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    expect(resolveShortcut(targetEvent("n", el), [{ key: "n", handler: noop }])).toBeNull();
  });

  it("never fires plain definitions under Ctrl/Cmd (browser chords win)", () => {
    expect(
      resolveShortcut(keyEvent("n", { ctrlKey: true }), [{ key: "n", handler: noop }])
    ).toBeNull();
    expect(
      resolveShortcut(keyEvent("n", { metaKey: true }), [{ key: "n", handler: noop }])
    ).toBeNull();
  });

  it("mod definitions require Ctrl or Cmd", () => {
    const handler = jest.fn();
    const def: ShortcutDefinition = { key: "Enter", handler, mod: true };
    expect(resolveShortcut(keyEvent("Enter", { ctrlKey: true }), [def])).toBe(handler);
    expect(resolveShortcut(keyEvent("Enter", { metaKey: true }), [def])).toBe(handler);
    expect(resolveShortcut(keyEvent("Enter"), [def])).toBeNull();
  });

  it("Alt always blocks (dead keys and IME chords)", () => {
    expect(
      resolveShortcut(keyEvent("n", { altKey: true }), [{ key: "n", handler: noop }])
    ).toBeNull();
  });

  it("scoped definitions fire only inside their data-shortcut-scope subtree", () => {
    document.body.innerHTML = `<div data-shortcut-scope="result-form"><p id="inside"></p></div><button id="outside"></button>`;
    const inside = document.getElementById("inside") as HTMLElement;
    const outside = document.getElementById("outside") as HTMLElement;
    const handler = jest.fn();
    const def: ShortcutDefinition = { key: "p", handler, scope: "result-form" };
    expect(resolveShortcut(targetEvent("p", inside), [def])).toBe(handler);
    expect(resolveShortcut(targetEvent("p", outside), [def])).toBeNull();
    document.body.innerHTML = "";
  });

  it("an unscoped definition does not fire inside a scoped subtree", () => {
    document.body.innerHTML = `<div data-shortcut-scope="shell"><input id="q" /></div>`;
    const box = document.getElementById("q") as HTMLElement;
    expect(resolveShortcut(targetEvent("n", box), [{ key: "n", handler: noop }])).toBeNull();
    document.body.innerHTML = "";
  });

  it("the innermost scope wins when scopes nest", () => {
    document.body.innerHTML = `<div data-shortcut-scope="shell"><div data-shortcut-scope="form"><p id="q"></p></div></div>`;
    const el = document.getElementById("q") as HTMLElement;
    expect(
      resolveShortcut(targetEvent("p", el), [{ key: "p", handler: noop, scope: "form" }])
    ).not.toBeNull();
    expect(
      resolveShortcut(targetEvent("p", el), [{ key: "p", handler: noop, scope: "shell" }])
    ).toBeNull();
    document.body.innerHTML = "";
  });
});

describe("useGlobalShortcuts", () => {
  it("dispatches matching keys to the current handler", () => {
    const handler = jest.fn();
    renderHook(() => useGlobalShortcuts([{ key: "?", handler }]));
    fireEvent.keyDown(window, { key: "?" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("prevents default on handled shortcuts so the browser acts once", () => {
    renderHook(() => useGlobalShortcuts([{ key: "/", handler: noop }]));
    const event = keyEvent("/");
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves unmatched keys alone", () => {
    const handler = jest.fn();
    renderHook(() => useGlobalShortcuts([{ key: "?", handler }]));
    const event = keyEvent("x");
    window.dispatchEvent(event);
    expect(handler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("picks up definition changes between renders (fresh handlers per subscription)", () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(
      ({ defs }) => useGlobalShortcuts(defs),
      { initialProps: { defs: [{ key: "n", handler: first }] as ShortcutDefinition[] } }
    );
    fireEvent.keyDown(window, { key: "n" });
    rerender({ defs: [{ key: "n", handler: second }] });
    fireEvent.keyDown(window, { key: "n" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes its listener on unmount", () => {
    const handler = jest.fn();
    const { unmount } = renderHook(() => useGlobalShortcuts([{ key: "n", handler }]));
    unmount();
    fireEvent.keyDown(window, { key: "n" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("honours the typing guard at the window level, with the input opt-in", () => {
    render(<input aria-label="box" />);
    const box = screen.getByLabelText("box");
    box.focus();
    const typed = jest.fn();
    const search = jest.fn();
    renderHook(() =>
      useGlobalShortcuts([
        { key: "/", handler: search, allowInInputs: true },
        { key: "g", handler: typed },
      ])
    );
    fireEvent.keyDown(box, { key: "/" });
    fireEvent.keyDown(box, { key: "g" });
    expect(search).toHaveBeenCalledTimes(1);
    expect(typed).not.toHaveBeenCalled();
  });
});
