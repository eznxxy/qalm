import { render, screen } from "@testing-library/react";
import React from "react";
import { DisabledHint } from "@/components/ui";

/**
 * DisabledHint — a disabled control cannot surface its own native `title`
 * (the wrapper owns the hover), so the primitive puts the tooltip on a span
 * and makes the disabled child pointer-transparent (DisabledHint.css).
 */

describe("DisabledHint", () => {
  it("renders children untouched when there is no hint", () => {
    const { container } = render(
      <DisabledHint>
        <button type="button" disabled>
          Save
        </button>
      </DisabledHint>
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(container.querySelector(".disabled-hint")).toBeNull();
  });

  it("wraps a disabled control and exposes the hint as a title", () => {
    const { container } = render(
      <DisabledHint hint="Pick a destination first">
        <button type="button" disabled>
          Move
        </button>
      </DisabledHint>
    );

    const wrap = container.querySelector(".disabled-hint");
    expect(wrap).not.toBeNull();
    expect(wrap).toHaveAttribute("title", "Pick a destination first");
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
  });

  it("leaves an enabled child operable inside the wrapper", () => {
    const onClick = jest.fn();
    render(
      <DisabledHint hint="Delete the selected case">
        <button type="button" onClick={onClick}>
          Delete
        </button>
      </DisabledHint>
    );

    screen.getByRole("button", { name: "Delete" }).click();
    expect(onClick).toHaveBeenCalled();
  });
});