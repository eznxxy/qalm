import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { SuiteFormDialog } from "@/components/suites/SuiteFormDialog";

/**
 * SuiteFormDialog (card 3.1): the create/rename surface for suites. Name and
 * description limits mirror docs/api-suites.md § Validation.
 */

describe("SuiteFormDialog", () => {
  it("does not flag the empty name while the dialog opens", () => {
    // StrictMode re-runs the mount effect once; its cleanup must not steal
    // focus from the auto-focused Name field and trip the blur validation.
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    render(
      <React.StrictMode>
        <SuiteFormDialog
          mode="create"
          onSubmit={jest.fn()}
          onCancel={jest.fn()}
        />
      </React.StrictMode>
    );

    expect(screen.queryByText("Name is required.")).toBeNull();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    trigger.remove();
  });

  it("requires a name before submitting", () => {
    const onSubmit = jest.fn();
    render(
      <SuiteFormDialog mode="create" onSubmit={onSubmit} onCancel={jest.fn()} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Create suite" }));

    expect(screen.getByText("Name is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits trimmed values", () => {
    const onSubmit = jest.fn();
    render(
      <SuiteFormDialog mode="create" onSubmit={onSubmit} onCancel={jest.fn()} />
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  Checkout  " },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "  Payment flows  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create suite" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Checkout",
      description: "Payment flows",
    });
  });

  it("says where a child suite will live", () => {
    render(
      <SuiteFormDialog
        mode="create"
        parentName="Checkout"
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(
      screen.getByText("This suite will be a child of Checkout.")
    ).toBeInTheDocument();
  });

  it("prefills in edit mode", () => {
    render(
      <SuiteFormDialog
        mode="edit"
        suite={{
          id: "s-1",
          project_id: "p-1",
          parent_id: null,
          name: "Checkout",
          description: "Payment flows",
          depth: 1,
          position: 1,
          case_count: 3,
          created_by: "u-1",
          created_at: "2026-10-25T09:00:00Z",
          updated_at: "2026-10-25T09:00:00Z",
          children: [],
        }}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Rename suite" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Checkout");
    expect(screen.getByLabelText("Description")).toHaveValue("Payment flows");
    expect(screen.getByRole("button", { name: "Save name" })).toBeInTheDocument();
  });

  it("shows server field errors and a form-level error", () => {
    render(
      <SuiteFormDialog
        mode="create"
        serverFieldErrors={{ name: "That name is already used here." }}
        formError="Could not save the suite."
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(
      screen.getByText("That name is already used here.")
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not save the suite."
    );
  });

  it("cancels on Esc, the close path for keyboard users", () => {
    const onCancel = jest.fn();
    render(
      <SuiteFormDialog mode="create" onSubmit={jest.fn()} onCancel={onCancel} />
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
