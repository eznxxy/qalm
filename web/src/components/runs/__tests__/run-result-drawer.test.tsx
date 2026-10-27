import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import type { Result, RunItemDetail } from "@/lib/api-types";

/**
 * RunResultDrawer (card 3.2). The behaviour the primitives do not own: the
 * failed⇒comment rule shown inline (PRD criterion 4), the save / save-and-next
 * paths, the per-item Tester gate and the "status is immutable" edit path.
 *
 * The API module is mocked at its relative path so the component's `@/lib`
 * import and the mock resolve to the same module.
 */

const mockApi = {
  getRunItem: jest.fn(),
  listItemResults: jest.fn(),
  createResult: jest.fn(),
  updateResult: jest.fn(),
  uploadResultAttachment: jest.fn(),
  deleteAttachment: jest.fn(),
  deleteRunItem: jest.fn(),
  fetchAttachmentBlob: jest.fn(),
};

jest.mock("../../../lib/endpoints", () => ({ api: mockApi }));

function detail(overrides: Partial<RunItemDetail> = {}): RunItemDetail {
  return {
    id: "i-1",
    run_id: "r-1",
    case_id: "c-1",
    case_display_id: "C1042",
    case_title: "Pay with a saved card",
    case_priority: "high",
    case_suite_id: "s-1",
    assignee_id: "u-1",
    position: 1,
    status: "untested",
    result_count: 0,
    latest_result: null,
    created_at: "2026-10-24T09:00:00Z",
    updated_at: "2026-10-24T09:00:00Z",
    case_steps: [{ position: 1, text: "Open checkout", expected_result: "Cart shows" }],
    case_preconditions: "Signed in as a returning customer.",
    ...overrides,
  };
}

function result(overrides: Partial<Result> = {}): Result {
  return {
    id: "res-1",
    run_item_id: "i-1",
    status: "passed",
    comment: "All good",
    elapsed_minutes: 5,
    defect_url: null,
    attachments: [],
    created_by: "u-1",
    created_at: "2026-10-25T09:00:00Z",
    ...overrides,
  };
}

interface RenderOptions {
  canRecord?: boolean;
  canManage?: boolean;
  role?: "admin" | "lead" | "tester" | "viewer";
  userId?: string;
  nextUntestedId?: string | null;
  recordHint?: string | null;
}

async function renderDrawer(options: RenderOptions = {}): Promise<{
  onChanged: jest.Mock;
  onSaveAndNext: jest.Mock;
  onRemoved: jest.Mock;
}> {
  const onChanged = jest.fn();
  const onSaveAndNext = jest.fn();
  const onRemoved = jest.fn();
  const { RunResultDrawer } = await import("@/components/runs/RunResultDrawer");
  // The drawer's load effect yields a microtask before its first setState (the
  // lint rule forbids a synchronous setState in an effect body), so render
  // inside act to flush both loads with the component mounted.
  await act(async () => {
    render(
      <RunResultDrawer
        runId="r-1"
        itemId="i-1"
        canRecord={options.canRecord ?? true}
        recordHint={options.recordHint ?? null}
        canManage={options.canManage ?? false}
        role={options.role ?? "lead"}
        userId={options.userId ?? "u-1"}
        nextUntestedId={options.nextUntestedId ?? null}
        onClose={jest.fn()}
        onChanged={onChanged}
        onSaveAndNext={onSaveAndNext}
        onRemoved={onRemoved}
      />
    );
  });
  return { onChanged, onSaveAndNext, onRemoved };
}

const createObjectURL = jest.fn(() => "blob:preview");
const revokeObjectURL = jest.fn();

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  mockApi.getRunItem.mockResolvedValue(detail());
  mockApi.listItemResults.mockResolvedValue({
    data: [],
    meta: { page: 1, limit: 25, total: 0, total_pages: 1 },
  });
  mockApi.createResult.mockResolvedValue(result());
  mockApi.updateResult.mockResolvedValue(result());
});

describe("RunResultDrawer", () => {
  it("shows the case's steps, preconditions and an empty history", async () => {
    await renderDrawer();

    expect(await screen.findByText("Signed in as a returning customer.")).toBeInTheDocument();
    expect(screen.getByText("Open checkout")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Add result/ })
    ).toBeInTheDocument();
    expect(await screen.findByText("No results recorded yet.")).toBeInTheDocument();
  });

  it("gives each status button its own status class, the hook the hover colour reads", async () => {
    await renderDrawer();

    const group = await screen.findByRole("group", { name: "Status" });
    const expected: [string, string][] = [
      ["Passed", "rd-seg-passed"],
      ["Failed", "rd-seg-failed"],
      ["Blocked", "rd-seg-blocked"],
      ["Retest", "rd-seg-retest"],
      ["Skipped", "rd-seg-skipped"],
    ];
    for (const [label, className] of expected) {
      expect(within(group).getByRole("button", { name: label })).toHaveClass(
        "rd-seg",
        className
      );
    }
    // Nothing is selected until the tester picks; the tint on hover must never
    // read as a choice, so only an explicit click adds the solid fill.
    expect(
      within(group).getByRole("button", { name: "Failed" })
    ).not.toHaveClass("is-active");
    fireEvent.click(within(group).getByRole("button", { name: "Failed" }));
    expect(within(group).getByRole("button", { name: "Failed" })).toHaveClass(
      "is-active"
    );
  });

  it("requires a comment for a failed result, inline, without a request", async () => {
    await renderDrawer();

    fireEvent.click(await screen.findByRole("button", { name: "Failed" }));
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    expect(
      await screen.findByText("A comment is required for a failed result.")
    ).toBeInTheDocument();
    expect(mockApi.createResult).not.toHaveBeenCalled();
  });

  it("saves a passed result and reports the change", async () => {
    const { onChanged } = await renderDrawer();

    fireEvent.click(await screen.findByRole("button", { name: "Passed" }));
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    await waitFor(() =>
      expect(mockApi.createResult).toHaveBeenCalledWith("r-1", "i-1", {
        status: "passed",
      })
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("'Save and next' advances to the next untested item", async () => {
    const { onSaveAndNext } = await renderDrawer({ nextUntestedId: "i-2" });

    fireEvent.click(await screen.findByRole("button", { name: "Passed" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => expect(onSaveAndNext).toHaveBeenCalled());
  });

  it("blocks a Tester on an item that is not assigned to them", async () => {
    mockApi.getRunItem.mockResolvedValue(detail({ assignee_id: "u-2" }));
    await renderDrawer({ role: "tester", userId: "u-9" });

    expect(
      await screen.findByText(/This item isn't assigned to you/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save result" })).toBeNull();
  });

  it("shows the kept-result actions as compact buttons, not links", async () => {
    mockApi.listItemResults.mockResolvedValue({
      data: [result({ comment: "old" })],
      meta: { page: 1, limit: 25, total: 1, total_pages: 1 },
    });
    await renderDrawer();

    const edit = await screen.findByRole("button", { name: "Edit result" });
    expect(edit).toHaveClass("rd-action-btn");
    expect(edit).not.toHaveClass("linklike");

    // "Add attachment" is still a label over the hidden input, so restyling it
    // must not cost the control its accessible name.
    const add = screen.getByText("Add attachment").closest("label");
    expect(add).toHaveClass("rd-action-btn");
    expect(add).toContainElement(screen.getByLabelText("Add attachment"));
  });

  it("edits the latest result but never its status", async () => {
    mockApi.listItemResults.mockResolvedValue({
      data: [result({ comment: "old" })],
      meta: { page: 1, limit: 25, total: 1, total_pages: 1 },
    });
    await renderDrawer();

    fireEvent.click(await screen.findByRole("button", { name: "Edit result" }));

    // Status is frozen once a result exists.
    expect(screen.getByRole("button", { name: "Passed" })).toBeDisabled();
    expect(
      screen.getByText(/Status cannot be changed after a result is recorded/)
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "new comment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    // `onStartEdit` seeds the form from the latest result, so the unchanged
    // elapsed time (5) and the empty defect URL round-trip as-is.
    await waitFor(() =>
      expect(mockApi.updateResult).toHaveBeenCalledWith("res-1", {
        comment: "new comment",
        elapsed_minutes: 5,
        defect_url: null,
      })
    );
  });

  it("disables Remove from run once the item has a result", async () => {
    mockApi.getRunItem.mockResolvedValue(detail({ result_count: 1 }));
    mockApi.listItemResults.mockResolvedValue({
      data: [result()],
      meta: { page: 1, limit: 25, total: 1, total_pages: 1 },
    });
    await renderDrawer({ canManage: true });

    expect(
      await screen.findByRole("button", { name: "Remove from run" })
    ).toBeDisabled();
  });

  it("states the five extensions the picker accepts", async () => {
    await renderDrawer();

    const input = (await screen.findByLabelText("Attachments")) as HTMLInputElement;
    expect(
      screen.getByText(
        "Up to 5 files, 10 MB each. Allowed: PNG, JPG, JPEG, WebP, PDF. Uploaded when you save."
      )
    ).toBeInTheDocument();
    // `accept` offers the same five extensions, so the dialog filters on the
    // same rule the check applies — no OS MIME table involved.
    expect(input.accept.split(",")).toEqual([".png", ".jpg", ".jpeg", ".webp", ".pdf"]);

    // The reviewer's bug: Windows reports `.zip` as application/x-zip-compressed
    // and the old MIME check refused it (or, worse, the hint promised it).
    fireEvent.change(input, {
      target: { files: [new File(["PK"], "evidence.zip", { type: "application/x-zip-compressed" })] },
    });
    expect(
      await screen.findByText("evidence.zip: that file type is not allowed.")
    ).toBeInTheDocument();

    fireEvent.change(input, {
      target: { files: [new File(["GIF89a"], "anim.gif", { type: "image/gif" })] },
    });
    expect(
      await screen.findByText("anim.gif: that file type is not allowed.")
    ).toBeInTheDocument();

    fireEvent.change(input, {
      target: { files: [new File(["x"], "run.exe", { type: "application/x-msdownload" })] },
    });
    expect(
      await screen.findByText("run.exe: that file type is not allowed.")
    ).toBeInTheDocument();
  });

  it("accepts a valid file whatever MIME the OS reports", async () => {
    await renderDrawer();

    const input = await screen.findByLabelText("Attachments");
    // Windows can report an empty type for a valid file; the extension is what
    // counts, and it is matched case-insensitively.
    fireEvent.change(input, {
      target: { files: [new File(["x"], "Evidence.JPEG", { type: "" })] },
    });

    expect(
      await screen.findByRole("button", { name: "Remove Evidence.JPEG" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/that file type is not allowed/)).toBeNull();
  });

  it("opens a staged image in a viewer and revokes the blob URL on close", async () => {
    await renderDrawer();

    const input = await screen.findByLabelText("Attachments");
    const file = new File(["hello"], "shot.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    // The whole card is the affordance now: clicking the file opens it rather
    // than doing nothing (and the × stays the destructive control beside it).
    fireEvent.click(await screen.findByRole("button", { name: "View shot.png" }));

    const dialog = await screen.findByRole("dialog", { name: "shot.png" });
    expect(
      within(dialog).getByRole("img", { name: "shot.png" })
    ).toHaveAttribute("src", "blob:preview");
    expect(createObjectURL).toHaveBeenCalledWith(file);

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "shot.png" })).toBeNull()
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("opens an uploaded PDF in an iframe after fetching its bytes", async () => {
    mockApi.listItemResults.mockResolvedValue({
      data: [
        result({
          attachments: [
            {
              id: "a-1",
              filename: "report.pdf",
              content_type: "application/pdf",
              size_bytes: 2048,
              created_at: "2026-10-25T09:00:00Z",
            },
          ],
        }),
      ],
      meta: { page: 1, limit: 25, total: 1, total_pages: 1 },
    });
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    mockApi.fetchAttachmentBlob.mockResolvedValue(blob);
    await renderDrawer();

    fireEvent.click(
      await screen.findByRole("button", { name: "View report.pdf" })
    );

    const dialog = await screen.findByRole("dialog", { name: "report.pdf" });
    // PDFs go to the browser's inline viewer, not an <img>.
    const frame = dialog.querySelector("iframe");
    expect(frame?.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", "blob:preview");
    expect(mockApi.fetchAttachmentBlob).toHaveBeenCalledWith("a-1");
  });

  it("removes a staged file through the × button, not a text link", async () => {
    await renderDrawer();

    const input = await screen.findByLabelText("Attachments");
    const file = new File(["hello"], "shot.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    const remove = await screen.findByRole("button", {
      name: "Remove shot.png",
    });
    // The file name stays as text; only the control is icon-only.
    expect(screen.getByText("shot.png")).toBeInTheDocument();

    fireEvent.click(remove);

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Remove shot.png" })
      ).toBeNull()
    );
  });

  it("removes an uploaded attachment through its × button", async () => {
    mockApi.listItemResults.mockResolvedValue({
      data: [
        result({
          attachments: [
            {
              id: "a-1",
              filename: "report.pdf",
              content_type: "application/pdf",
              size_bytes: 2048,
              created_at: "2026-10-25T09:00:00Z",
            },
          ],
        }),
      ],
      meta: { page: 1, limit: 25, total: 1, total_pages: 1 },
    });
    mockApi.deleteAttachment.mockResolvedValue(undefined);
    await renderDrawer();

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove report.pdf" })
    );

    await waitFor(() =>
      expect(mockApi.deleteAttachment).toHaveBeenCalledWith("a-1")
    );
  });

  it("does not render the result form when the item is read-only", async () => {
    await renderDrawer({ canRecord: false, recordHint: "This run is completed." });

    expect(await screen.findByText("This run is completed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save result" })).toBeNull();
  });

  it("offers no edit affordance on a completed run", async () => {
    // Card 3.15: the latest result is editable by its author, but the run is
    // closed — clicking Edit would only swap the heading and leave the
    // read-only sentence. The button (and Add attachment) stay hidden.
    await renderDrawer({
      canRecord: false,
      recordHint: "This run is completed.",
      role: "admin",
    });

    expect(await screen.findByText("This run is completed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit result" })).toBeNull();
    expect(screen.queryByText("Add attachment")).toBeNull();
  });
});