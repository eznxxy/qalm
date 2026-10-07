import { ApiError } from "@/lib/api-error";
import {
  projectFormServerErrors,
  validateProjectForm,
} from "@/lib/project-form";

function apiError(args: {
  status: number;
  code?: string;
  message?: string;
  details?: { field?: string; issue: string }[];
}): ApiError {
  return new ApiError({
    code: args.code ?? "REQUEST_FAILED",
    message: args.message ?? "error",
    status: args.status,
    details: args.details,
  });
}

describe("validateProjectForm (client mirror of contract rules)", () => {
  const valid = { name: "Payments", key: "PAY", description: "" };

  it("accepts a valid form", () => {
    expect(validateProjectForm(valid)).toEqual({});
  });

  it("requires the name", () => {
    expect(validateProjectForm({ ...valid, name: "   " })).toEqual({
      name: "Name is required.",
    });
  });

  it("caps the name at 100 chars", () => {
    expect(validateProjectForm({ ...valid, name: "x".repeat(101) }).name).toMatch(/100/);
    expect(validateProjectForm({ ...valid, name: "x".repeat(100) }).name).toBeUndefined();
  });

  it("requires the key", () => {
    expect(validateProjectForm({ ...valid, key: "" }).key).toMatch(/required/);
  });

  it("enforces the key shape (2-10, letter first) after normalization", () => {
    expect(validateProjectForm({ ...valid, key: "pay" }).key).toBeUndefined(); // normalizes to PAY
    expect(validateProjectForm({ ...valid, key: "1AB" }).key).toBeDefined();
    expect(validateProjectForm({ ...valid, key: "P" }).key).toBeDefined();
    expect(validateProjectForm({ ...valid, key: "P".repeat(11) }).key).toBeDefined();
    expect(validateProjectForm({ ...valid, key: "PAY-1" }).key).toBeDefined();
  });

  it("caps the description at 500 chars", () => {
    expect(
      validateProjectForm({ ...valid, description: "x".repeat(501) }).description
    ).toMatch(/500/);
    expect(
      validateProjectForm({ ...valid, description: "x".repeat(500) }).description
    ).toBeUndefined();
  });

  it("can flag several fields at once", () => {
    const errors = validateProjectForm({ name: "", key: "!!", description: "" });
    expect(Object.keys(errors).sort()).toEqual(["key", "name"]);
  });
});

describe("projectFormServerErrors (400/409 surfaced per field)", () => {
  it("maps 409 details onto the duplicated field (name)", () => {
    const mapped = projectFormServerErrors(
      apiError({
        status: 409,
        code: "CONFLICT",
        message: "A project with this name already exists.",
        details: [{ field: "name", issue: "already in use" }],
      })
    );
    expect(mapped.fields).toEqual({ name: "already in use" });
    expect(mapped.form).toBeNull();
  });

  it("maps 409 details onto the duplicated field (key)", () => {
    const mapped = projectFormServerErrors(
      apiError({
        status: 409,
        code: "CONFLICT",
        message: "A project with this key already exists.",
        details: [{ field: "key", issue: "already in use" }],
      })
    );
    expect(mapped.fields).toEqual({ key: "already in use" });
  });

  it("maps 400 validation details onto their fields", () => {
    const mapped = projectFormServerErrors(
      apiError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Invalid request body.",
        details: [
          { field: "name", issue: "must be 1-100 characters" },
          { field: "key", issue: "must be 2-10 characters, uppercase letter first" },
        ],
      })
    );
    expect(mapped.fields.name).toMatch(/1-100/);
    expect(mapped.fields.key).toMatch(/2-10/);
    expect(mapped.form).toBeNull();
  });

  it("falls back to the message when a 409 carries no field details", () => {
    const mapped = projectFormServerErrors(
      apiError({ status: 409, code: "CONFLICT", message: "Duplicate project." })
    );
    expect(mapped.fields).toEqual({});
    expect(mapped.form).toBe("Duplicate project.");
  });

  it("renders 403 as a form-level message, never on a field", () => {
    const mapped = projectFormServerErrors(
      apiError({
        status: 403,
        code: "FORBIDDEN",
        message: "Insufficient role.",
      })
    );
    expect(mapped.fields).toEqual({});
    expect(mapped.form).toBe("Insufficient role.");
  });

  it("renders non-ApiError failures as a generic form-level message", () => {
    const mapped = projectFormServerErrors(new Error("boom"));
    expect(mapped.fields).toEqual({});
    expect(mapped.form).toMatch(/Something went wrong/);
  });
});
