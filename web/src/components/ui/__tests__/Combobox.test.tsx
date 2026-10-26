import { fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui";

/**
 * Combobox — the searchable single-select behind the case editor's Suite
 * field. These tests pin the ARIA combobox pattern (closed field shows the
 * value; typing filters by name; Arrow/Enter/Escape move and commit) and the
 * keyboard/focus contract the surrounding drawer depends on.
 */

const OPTIONS: ComboboxOption[] = [
  { id: "s-1", label: "Checkout", depth: 1 },
  { id: "s-2", label: "Payments", depth: 2 },
  { id: "s-3", label: "Cards", depth: 3 },
  { id: "s-4", label: "Accounts", depth: 1 },
];

interface HarnessProps {
  initial?: string;
  onChange?: (id: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  emptyMessage?: string;
  invalid?: boolean;
  describedBy?: string;
}

/** Mirrors the controlled usage in CaseEditor. */
function Harness({
  initial = "s-1",
  onChange,
  onBlur,
  placeholder = "Search suites…",
  emptyMessage,
  invalid,
  describedBy,
}: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="suite">Suite</label>
      <Combobox
        id="suite"
        value={value}
        options={OPTIONS}
        placeholder={placeholder}
        emptyMessage={emptyMessage}
        invalid={invalid}
        describedBy={describedBy}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        onBlur={onBlur}
      />
    </>
  );
}

const field = () => screen.getByLabelText("Suite") as HTMLInputElement;

describe("Combobox", () => {
  it("shows the selected suite in the closed field", () => {
    render(<Harness />);

    expect(field()).toHaveValue("Checkout");
    expect(field()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens on focus with the tree in order and the selection marked", () => {
    render(<Harness initial="s-2" />);

    fireEvent.focus(field());

    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Checkout✓",
      "Payments✓",
      "Cards✓",
      "Accounts✓",
    ]);
    // Depth travels as data so CSS owns the indent.
    expect(options.map((option) => option.getAttribute("data-depth"))).toEqual([
      "1",
      "2",
      "3",
      "1",
    ]);
    expect(screen.getByRole("option", { name: "Payments" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(field()).toHaveAttribute("aria-expanded", "true");
    // The highlight starts on the current value.
    expect(field()).toHaveAttribute("aria-activedescendant", "suite-option-1");
  });

  it("filters by suite name as you type, ignoring the indent", () => {
    render(<Harness />);

    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "card" } });

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Cards✓",
    ]);

    // The old select indented with an em dash; that glyph is not a name.
    fireEvent.change(field(), { target: { value: "—" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("moves the highlight with the arrows and commits with Enter", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(field()).toHaveAttribute("aria-activedescendant", "suite-option-1");

    fireEvent.keyDown(field(), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("s-2");
    expect(field()).toHaveValue("Payments");
    expect(field()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("commits the only match when you type and press Enter", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "acc" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("s-4");
    expect(field()).toHaveValue("Accounts");
  });

  it("selects on click and keeps focus in the field", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.focus(field());
    fireEvent.mouseDown(screen.getByRole("option", { name: "Cards" }));
    fireEvent.click(screen.getByRole("option", { name: "Cards" }));

    expect(onChange).toHaveBeenCalledWith("s-3");
    expect(field()).toHaveValue("Cards");
    expect(document.activeElement).toBe(field());
  });

  it("Escape closes the list without changing the value or reaching the host", () => {
    const onChange = jest.fn();
    const host = jest.fn();
    document.addEventListener("keydown", host);
    render(<Harness onChange={onChange} />);

    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "pay" } });
    fireEvent.keyDown(field(), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(field()).toHaveValue("Checkout");
    expect(onChange).not.toHaveBeenCalled();
    // The drawer's Esc handler is a bubble-phase document listener; an open
    // list must consume the key before it gets there (Combobox listens in the
    // capture phase for exactly this reason).
    expect(host).not.toHaveBeenCalled();

    document.removeEventListener("keydown", host);
  });

  it("leaves Escape to the host once the list is closed", () => {
    const host = jest.fn();
    document.addEventListener("keydown", host);
    render(<Harness />);

    // Closed already: the drawer must still see the key.
    fireEvent.keyDown(field(), { key: "Escape" });

    expect(host).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", host);
  });

  it("closes on a click outside without changing the value", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.focus(field());
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(field()).toHaveValue("Checkout");
  });

  it("reports blur to the host so the field can be validated", () => {
    const onBlur = jest.fn();
    render(<Harness onBlur={onBlur} />);

    fireEvent.focus(field());
    fireEvent.blur(field());

    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("wires invalid and describedBy onto the input", () => {
    render(<Harness invalid describedBy="suite-error" />);

    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAttribute("aria-describedby", "suite-error");
  });

  it("shows a custom empty message and ignores Enter with no matches", () => {
    const onChange = jest.fn();
    render(
      <Harness onChange={onChange} emptyMessage="No suites match." />
    );

    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "zzz" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(screen.getByText("No suites match.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});