import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { CaseDetail, SuiteNode } from "@/lib/api-types";

/**
 * CaseEditor (card 3.3): inline validation, the reorderable step list and the
 * Ctrl+Enter save path. The rules themselves live in lib/case-form and are
 * unit-tested there; this file checks the DOM wiring.
 */

const mockApi = {
  createCase: jest.fn(),
  updateCase: jest.fn(),
};

jest.mock("../../../lib/endpoints", () => ({ api: mockApi }));

function suite(overrides: Partial<SuiteNode> & { id: string; name: string }): SuiteNode {
  return {
    project_id: "p-1",
    parent_id: null,
    description: null,
    depth: 1,
    position: 1,
    case_count: 0,
    created_by: "u-1",
    created_at: "2026-10-25T09:00:00Z",
    updated_at: "2026-10-25T09:00:00Z",
    children: [],
    ...overrides,
  };
}

const SUITES: SuiteNode[] = [
  suite({
    id: "s-1",
    name: "Checkout",
    children: [
      suite({ id: "s-2", parent_id: "s-1", name: "Payments", depth: 2 }),
    ],
  }),
];

const DETAIL: CaseDetail = {
  id: "c-1",
  project_id: "p-1",
  suite_id: "s-1",
  case_number: 1,
  display_id: "C1",
  title: "Pay with a saved card",
  preconditions: null,
  steps: [{ position: 1, text: "Open checkout", expected_result: null }],
  priority: "high",
  type: "functional",
  tags: ["smoke"],
  estimate_minutes: 15,
  created_by: "u-1",
  updated_by: "u-1",
  created_at: "2026-10-25T09:00:00Z",
  updated_at: "2026-10-25T09:12:00Z",
};

async function renderEditor(
  props: Partial<React.ComponentProps<typeof import("@/components/cases/CaseEditor").CaseEditor>> = {}
) {
  const { CaseEditor } = await import("@/components/cases/CaseEditor");
  const onSaved = jest.fn();
  const onCancel = jest.fn();
  const view = render(
    <CaseEditor
      projectId="p-1"
      suites={SUITES}
      defaultSuiteId="s-1"
      onSaved={onSaved}
      onCancel={onCancel}
      {...props}
    />
  );
  return { view, onSaved, onCancel };
}

beforeEach(() => {
  mockApi.createCase.mockReset();
  mockApi.updateCase.mockReset();
});

describe("CaseEditor", () => {
  it("shows inline errors on submit and does not call the API", async () => {
    const { onSaved } = await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Add case" }));

    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
    expect(mockApi.createCase).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("validates on blur, before the first submit", async () => {
    await renderEditor();

    const title = screen.getByLabelText("Title");
    fireEvent.blur(title);
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
  });

  it("saves on Ctrl+Enter with reordered steps and parsed estimate", async () => {
    mockApi.createCase.mockResolvedValue({
      ...DETAIL,
      id: "c-9",
      case_number: 9,
      display_id: "C9",
      title: "Refund the order",
    });
    const { onSaved } = await renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Refund the order" },
    });

    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.change(screen.getByLabelText("Step 1 action"), {
      target: { value: "First action" },
    });
    fireEvent.change(screen.getByLabelText("Step 1 expected result"), {
      target: { value: "First result" },
    });
    fireEvent.change(screen.getByLabelText("Step 2 action"), {
      target: { value: "Second action" },
    });

    // Reorder: the second step becomes first.
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
    expect(
      (screen.getByLabelText("Step 1 action") as HTMLTextAreaElement).value
    ).toBe("Second action");

    fireEvent.change(screen.getByLabelText("Estimate"), {
      target: { value: "1h 30m" },
    });
    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "Refunds, refunds, Smoke" },
    });

    fireEvent.keyDown(screen.getByRole("form", { name: "Create case" }), {
      key: "Enter",
      ctrlKey: true,
    });

    await waitFor(() => expect(mockApi.createCase).toHaveBeenCalled());
    expect(mockApi.createCase).toHaveBeenCalledWith("p-1", {
      suite_id: "s-1",
      title: "Refund the order",
      priority: "medium",
      type: "functional",
      tags: ["refunds", "smoke"],
      steps: [
        { text: "Second action", expected_result: null },
        { text: "First action", expected_result: "First result" },
      ],
      estimate_minutes: 90,
    });
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ display_id: "C9" }),
      "create"
    );
  });

  it("prefills in edit mode and refuses an unchanged save", async () => {
    const { onSaved } = await renderEditor({ detail: DETAIL });

    expect(screen.getByLabelText("Title")).toHaveValue("Pay with a saved card");
    expect(screen.getByLabelText("Tags")).toHaveValue("smoke");
    expect(screen.getByLabelText("Estimate")).toHaveValue("15m");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No changes to save."
    );
    expect(mockApi.updateCase).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("cancels without saving", async () => {
    const { onCancel } = await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
