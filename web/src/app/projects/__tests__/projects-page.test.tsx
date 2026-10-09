import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { Project, User } from "@/lib/api-types";

/**
 * Mutable router state so each test can pin search params / route params.
 * (jest.mock factories are hoisted; names must start with `mock`.)
 */
const mockRouterState = {
  search: "",
  params: {} as Record<string, string>,
  replace: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockRouterState.replace,
    push: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/projects",
  useParams: () => mockRouterState.params,
  useSearchParams: () => new URLSearchParams(mockRouterState.search),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u-1",
    email: "ada@example.com",
    name: "Ada Lovelace",
    role: "admin",
    is_active: true,
    must_change_password: false,
    created_at: "2026-10-07T12:00:00Z",
    updated_at: "2026-10-07T12:00:00Z",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-1",
    key: "PAY",
    name: "Payments",
    description: "Checkout and billing flows",
    status: "active",
    created_by: "u-1",
    created_at: "2026-10-07T12:00:00Z",
    updated_at: "2026-10-07T12:00:00Z",
    ...overrides,
  };
}

const ADMIN = makeUser();
const LEAD = makeUser({ id: "u-2", email: "lea@example.com", name: "Lead", role: "lead" });
const TESTER = makeUser({ id: "u-3", email: "tes@example.com", name: "Tester", role: "tester" });

const ACTIVE = makeProject();
const ARCHIVED = makeProject({
  id: "p-2",
  key: "OLD",
  name: "Legacy",
  description: null,
  status: "archived",
});

let fetchMock: jest.Mock;

/** Installs the API mock for a logged-in session as `user`. */
function mockApiFor(user: User, list: Project[] = [ACTIVE]) {
  fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    if (url.includes("/auth/refresh")) {
      return Promise.resolve(
        jsonResponse(200, {
          data: { access_token: "tok-r", token_type: "Bearer", expires_in: 900 },
        })
      );
    }
    if (url.includes("/auth/me")) {
      return Promise.resolve(jsonResponse(200, { data: user }));
    }
    if (url.match(/\/projects\/[\w-]+\/archive$/) && method === "POST") {
      return Promise.resolve(jsonResponse(200, { data: { ...ACTIVE, status: "archived" } }));
    }
    if (url.match(/\/projects\/[\w-]+\/restore$/) && method === "POST") {
      return Promise.resolve(jsonResponse(200, { data: { ...ACTIVE, status: "active" } }));
    }
    if (url.match(/\/projects\/[\w-]+$/) && method === "GET") {
      if (url.includes("p-1")) return Promise.resolve(jsonResponse(200, { data: ACTIVE }));
      return Promise.resolve(jsonResponse(200, { data: ARCHIVED }));
    }
    if (url.match(/\/projects\/[\w-]+$/) && method === "PATCH") {
      const patch = JSON.parse(init?.body ?? "{}") as Partial<Project>;
      return Promise.resolve(jsonResponse(200, { data: { ...ACTIVE, ...patch } }));
    }
    if (url.match(/\/projects\/?(\?|$)/) && method === "GET") {
      return Promise.resolve(
        jsonResponse(200, {
          data: list,
          meta: { page: 1, limit: 25, total: list.length, total_pages: 1 },
        })
      );
    }
    if (url.match(/\/projects\/?(\?|$)/) && method === "POST") {
      return Promise.resolve(
        jsonResponse(201, { data: { ...ACTIVE, ...JSON.parse(init?.body ?? "{}") } })
      );
    }
    return Promise.reject(new Error(`unexpected ${method} ${url}`));
  });
}

/** GET /projects call URLs (list calls only, in order). */
function listCalls(): string[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => {
      const method = (init?.method as string | undefined) ?? "GET";
      return String(url).includes("/projects") && method === "GET" && !/\/projects\/[\w-]+/.test(String(url));
    })
    .map(([url]) => String(url));
}

async function renderAs(user: User, list?: Project[]) {
  mockApiFor(user, list);
  const { default: ProjectsPage } = await import("@/app/projects/page");
  const { SessionProvider } = await import("@/lib/session");
  render(
    <SessionProvider>
      <ProjectsPage />
    </SessionProvider>
  );
  await screen.findByRole("heading", { name: "Projects" });
}

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockRouterState.search = "";
  mockRouterState.params = {};
  mockRouterState.replace.mockClear();
});

describe("projects list: role matrix rendering", () => {
  it("admin: sees table, status filter, and all write controls on active rows", async () => {
    await renderAs(ADMIN);

    expect(await screen.findByText("Payments")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit Payments" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();

    const listUrl = listCalls()[0] ?? "";
    expect(listUrl).toContain("status=active");
    expect(listUrl).toContain("limit=25");
  });

  it("admin: archived filter shows archived rows with Restore, without Archive", async () => {
    mockRouterState.search = "status=archived";
    await renderAs(ADMIN, [ARCHIVED]);

    expect(await screen.findByText("Legacy")).toBeInTheDocument();
    expect(screen.getByText("Archived", { selector: ".sb-badge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(listCalls()[0]).toContain("status=archived");
  });

  it("lead: can create and archive; no edit, restore, or status filter", async () => {
    await renderAs(LEAD);

    expect(await screen.findByText("Payments")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit Payments" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
  });

  it.each([TESTER, makeUser({ id: "u-4", email: "v@example.com", name: "Viewer", role: "viewer" })])(
    "%s: list and detail only — zero write controls",
    async (user) => {
      await renderAs(user);

      expect(await screen.findByText("Payments")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Payments" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "New project" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Edit Payments" })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
    }
  );

  it("lead hitting ?status=archived never sends the archived query (no 403 round-trip)", async () => {
    mockRouterState.search = "status=archived";
    await renderAs(LEAD);

    expect(await screen.findByText("Payments")).toBeInTheDocument();
    const urls = listCalls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).not.toContain("status=archived");
  });
});

describe("projects list: create form", () => {
  it("auto-suggests the key from the name and normalizes typed keys to uppercase", async () => {
    await renderAs(ADMIN);

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const nameInput = await screen.findByLabelText("Name");
    const keyInput = screen.getByLabelText("Key");

    fireEvent.change(nameInput, { target: { value: "Checkout and billing flows" } });
    expect(keyInput).toHaveValue("CABF");

    fireEvent.change(keyInput, { target: { value: "pay1" } });
    expect(keyInput).toHaveValue("PAY1");

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Checkout flows" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await screen.findByText(/Project “Checkout and billing flows” created/);
    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/projects") && (init as { method?: string })?.method === "POST"
    );
    expect(post).toBeDefined();
    expect(
      JSON.parse(((post as unknown[])[1] as { body: string }).body)
    ).toEqual({
      name: "Checkout and billing flows",
      key: "PAY1",
      description: "Checkout flows",
    });
  });

  it("shows client validation errors and never POSTs an invalid form", async () => {
    await renderAs(ADMIN);

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    await screen.findByLabelText("Name");
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(screen.getByText("Key is required.")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/projects") && (init as { method?: string })?.method === "POST"
      )
    ).toBe(false);
  });

  it("surfaces a duplicate-key 409 on the key field", async () => {
    await renderAs(ADMIN);

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    await screen.findByLabelText("Name");
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        jsonResponse(409, {
          error: {
            code: "CONFLICT",
            message: "A project with this key already exists.",
            details: [{ field: "key", issue: "already in use" }],
          },
        })
      )
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Another" } });
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "PAY" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByText("already in use")).toBeInTheDocument();
    // Per-field mapping: no form-level alert is rendered for a fielded 409.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a duplicate-name 409 on the name field", async () => {
    await renderAs(ADMIN);

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    await screen.findByLabelText("Name");
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        jsonResponse(409, {
          error: {
            code: "CONFLICT",
            message: "A project with this name already exists.",
            details: [{ field: "name", issue: "already in use" }],
          },
        })
      )
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "payments" } });
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "PAYX" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByText("already in use")).toBeInTheDocument();
  });
});

describe("projects list: search + pagination state in the URL", () => {
  it("debounces search input into the ?query= param and resets the page", async () => {
    await renderAs(ADMIN);

    fireEvent.change(screen.getByLabelText("Search by name"), {
      target: { value: "pay" },
    });
    await waitFor(
      () => expect(mockRouterState.replace).toHaveBeenCalledWith("/projects?query=pay", { scroll: false }),
      { timeout: 1500 }
    );
  });

  it("renders pagination controls from meta and steps pages via the URL", async () => {
    mockRouterState.search = "page=2";
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(
          jsonResponse(200, {
            data: { access_token: "tok-r", token_type: "Bearer", expires_in: 900 },
          })
        );
      }
      if (url.includes("/auth/me")) return Promise.resolve(jsonResponse(200, { data: ADMIN }));
      if (method === "GET" && !/\/projects\/[\w-]+/.test(String(url))) {
        return Promise.resolve(
          jsonResponse(200, {
            data: [ACTIVE],
            meta: { page: 2, limit: 25, total: 26, total_pages: 2 },
          })
        );
      }
      return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });
    const { default: ProjectsPage } = await import("@/app/projects/page");
    const { SessionProvider } = await import("@/lib/session");
    render(
      <SessionProvider>
        <ProjectsPage />
      </SessionProvider>
    );

    expect(await screen.findByText(/Page 2 of 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    // page=1 is the default and is dropped from the URL.
    await waitFor(() =>
      expect(mockRouterState.replace).toHaveBeenCalledWith("/projects", { scroll: false })
    );
  });
});

describe("project detail: states and role gating", () => {
  async function renderDetailAs(user: User, project: Project = ACTIVE) {
    mockApiFor(user, [project]);
    mockRouterState.params = { id: project.id };
    const { default: DetailPage } = await import("@/app/projects/[id]/page");
    const { SessionProvider } = await import("@/lib/session");
    render(
      <SessionProvider>
        <DetailPage />
      </SessionProvider>
    );
  }

  it("admin: sees project fields and can edit name/key/description (PATCH sends only changes)", async () => {
    await renderDetailAs(ADMIN);

    expect(await screen.findByRole("heading", { name: /Payments/ })).toBeInTheDocument();
    expect(screen.getByText("PAY", { selector: "code" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = await screen.findByLabelText("Name");
    expect(nameInput).toHaveValue("Payments");

    fireEvent.change(nameInput, { target: { value: "Payments v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByRole("heading", { name: /Payments v2/ });
    const patch = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes("/projects/p-1") && (init as { method?: string })?.method === "PATCH"
    );
    expect(
      JSON.parse(((patch as unknown[])[1] as { body: string }).body)
    ).toEqual({ name: "Payments v2" });
  });

  it("admin: archive requires confirmation, then shows the archived state", async () => {
    await renderDetailAs(ADMIN);

    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Archive project?");
    expect(dialog).toHaveTextContent("disappear from the list");

    // Two "Archive" buttons exist now (row + dialog); pick the dialog's
    // confirm button (the first button inside the alertdialog).
    const confirmButton = (
      await screen.findByRole("alertdialog")
    ).querySelectorAll("button")[0];
    fireEvent.click(confirmButton);
    await screen.findByText("Archived", { selector: ".sb-badge" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("admin: restore hides the dialog on Escape without calling the API", async () => {
    mockRouterState.params = { id: "p-2" };
    await renderDetailAs(ADMIN, ARCHIVED);

    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/restore"))
    ).toBe(false);
  });

  it("lead: archived project detail is the contract's 404 — rendered as readable not-found", async () => {
    mockRouterState.params = { id: "p-2" };
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(
          jsonResponse(200, {
            data: { access_token: "tok-r", token_type: "Bearer", expires_in: 900 },
          })
        );
      }
      if (url.includes("/auth/me")) return Promise.resolve(jsonResponse(200, { data: LEAD }));
      if (url.includes("/projects/p-2")) {
        return Promise.resolve(
          jsonResponse(404, { error: { code: "NOT_FOUND", message: "Project not found." } })
        );
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    const { default: DetailPage } = await import("@/app/projects/[id]/page");
    const { SessionProvider } = await import("@/lib/session");
    render(
      <SessionProvider>
        <DetailPage />
      </SessionProvider>
    );

    expect(await screen.findByText("Project not found")).toBeInTheDocument();
    expect(screen.getByText(/archived projects are only visible to Admins/i)).toBeInTheDocument();
  });

  it("tester: detail shows no write controls", async () => {
    await renderDetailAs(TESTER);

    expect(await screen.findByRole("heading", { name: /Payments/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("lead: active detail offers Archive but not Edit or Restore", async () => {
    await renderDetailAs(LEAD);

    expect(await screen.findByRole("heading", { name: /Payments/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });
});
