"use client";

/**
 * CaseEditor — create/edit form for a test case (card 3.3).
 *
 * Fields mirror docs/api-cases.md § Validation: title, preconditions, steps
 * (numbered, reorderable, each with an expected result), priority, type,
 * tags and estimate. Validation runs on blur and on submit; server
 * `details[]` (including `steps[1].text`) map back onto the offending field.
 *
 * Estimate accepts minutes ("90") or hours and minutes ("1h 30m") and is
 * normalised to integer minutes on save (backlog decision 4). Tags are
 * comma-separated, trimmed, lowercased and de-duplicated.
 *
 * Keyboard: Ctrl/Cmd+Enter saves (DESIGN §7); every step control is a real
 * button with an index-bearing accessible name.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  CASE_TYPE_LABELS,
  PRIORITY_LABELS,
  type CaseDetail,
  type CaseType,
  type Priority,
  type SuiteNode,
} from "@/lib/api-types";
import { CASE_TYPES, PRIORITIES } from "@/lib/api-types";
import {
  buildCreateCaseInput,
  buildUpdateCaseInput,
  caseFormFromDetail,
  caseFormServerErrors,
  emptyCaseForm,
  hasCaseFormErrors,
  isCaseFormDirty,
  validateCaseForm,
  type CaseFormErrors,
  type CaseFormStep,
  type CaseFormValues,
  type CaseStepErrors,
} from "@/lib/case-form";
import { suiteOptions } from "@/lib/suites";
import { api } from "@/lib/endpoints";
import { isSessionDead } from "@/components/require-auth";
import { DisabledHint } from "@/components/ui";
import "./CaseEditor.css";

export interface CaseEditorProps {
  projectId: string;
  suites: readonly SuiteNode[];
  /** Present in edit mode. */
  detail?: CaseDetail | null;
  defaultSuiteId: string;
  onSaved: (detail: CaseDetail, mode: "create" | "edit") => void;
  onCancel: () => void;
  /**
   * Reports whether the form holds input that would be lost if it were
   * dismissed (create: differs from the empty form; edit: differs from the
   * loaded case). The host uses it to confirm before discarding.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function CaseEditor({
  projectId,
  suites,
  detail = null,
  defaultSuiteId,
  onSaved,
  onCancel,
  onDirtyChange,
}: CaseEditorProps) {
  const mode = detail ? "edit" : "create";
  const options = useMemo(() => suiteOptions(suites), [suites]);
  // The state the form opened with, captured once — the baseline the dirty
  // check compares against. Both states share the same lazy initial value, so
  // the baseline is real state (safe to read during render) rather than a ref.
  const [initialValues] = useState<CaseFormValues>(() =>
    detail ? caseFormFromDetail(detail) : emptyCaseForm(defaultSuiteId)
  );
  const [values, setValues] = useState<CaseFormValues>(initialValues);
  const [stepKeys, setStepKeys] = useState<string[]>(() =>
    values.steps.map((_, index) => `step-${index}`)
  );
  const nextKey = useRef(values.steps.length);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState<ReturnType<
    typeof caseFormServerErrors
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = useId();

  // Tell the host when the form becomes dirty/clean so it can confirm before
  // discarding a half-filled create form.
  const dirty = isCaseFormDirty(values, initialValues);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const clientErrors = useMemo(() => validateCaseForm(values), [values]);
  const showing = (field: string): boolean => submitted || touched.has(field);

  function fieldError(field: string): string | undefined {
    const fromServer = (
      server?.errors as Record<string, unknown> | undefined
    )?.[field];
    if (typeof fromServer === "string") return fromServer;
    if (!showing(field)) return undefined;
    const fromClient = clientErrors[field as keyof CaseFormErrors];
    return typeof fromClient === "string" ? fromClient : undefined;
  }

  function stepError(
    index: number,
    field: keyof CaseStepErrors
  ): string | undefined {
    const fromServer = server?.errors.steps?.[index]?.[field];
    if (fromServer) return fromServer;
    if (!showing(`step-${index}-${field}`)) return undefined;
    return clientErrors.steps?.[index]?.[field];
  }

  function update(patch: Partial<CaseFormValues>): void {
    setValues((current) => ({ ...current, ...patch }));
    setServer(null);
  }

  function touch(field: string): void {
    setTouched((current) => {
      if (current.has(field)) return current;
      const next = new Set(current);
      next.add(field);
      return next;
    });
  }

  function setSteps(steps: CaseFormStep[]): void {
    update({ steps });
  }

  function addStep(): void {
    if (values.steps.length >= 50) return;
    const key = `step-new-${nextKey.current++}`;
    setStepKeys((keys) => [...keys, key]);
    setSteps([...values.steps, { text: "", expected_result: "" }]);
  }

  function removeStep(index: number): void {
    setStepKeys((keys) => keys.filter((_, i) => i !== index));
    setSteps(values.steps.filter((_, i) => i !== index));
  }

  function moveStep(index: number, offset: -1 | 1): void {
    const to = index + offset;
    if (to < 0 || to >= values.steps.length) return;
    setStepKeys((keys) => move(keys, index, to));
    setSteps(move(values.steps, index, to));
  }

  function patchStep(index: number, patch: Partial<CaseFormStep>): void {
    setSteps(
      values.steps.map((step, i) => (i === index ? { ...step, ...patch } : step))
    );
  }

  function focusFirstInvalid(errors: CaseFormErrors): void {
    const order: Array<[keyof CaseFormErrors, string]> = [
      ["title", `case-title-${formId}`],
      ["suite_id", `case-suite-${formId}`],
      ["preconditions", `case-preconditions-${formId}`],
      ["tags", `case-tags-${formId}`],
      ["estimate", `case-estimate-${formId}`],
    ];
    for (const [field, id] of order) {
      if (errors[field]) {
        requestAnimationFrame(() => document.getElementById(id)?.focus());
        return;
      }
    }
    const badStep = errors.steps?.findIndex(
      (row) => row.text || row.expected_result
    );
    if (badStep !== undefined && badStep >= 0) {
      const field = errors.steps?.[badStep]?.text ? "text" : "expected_result";
      requestAnimationFrame(() =>
        document.getElementById(`case-step-${badStep}-${field}`)?.focus()
      );
    }
  }

  async function save(): Promise<void> {
    setSubmitted(true);
    setServer(null);
    if (hasCaseFormErrors(clientErrors)) {
      focusFirstInvalid(clientErrors);
      return;
    }

    setBusy(true);
    try {
      if (detail) {
        const body = buildUpdateCaseInput(values, detail);
        if (Object.keys(body).length === 0) {
          setServer({
            errors: {},
            form: "No changes to save.",
          });
          return;
        }
        const saved = await api.updateCase(detail.id, body);
        onSaved(saved, "edit");
      } else {
        const saved = await api.createCase(
          projectId,
          buildCreateCaseInput(values)
        );
        onSaved(saved, "create");
      }
    } catch (err) {
      if (isSessionDead(err)) return;
      setServer(caseFormServerErrors(err));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    void save();
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    }
  }

  const stepsMessage =
    (typeof server?.errors.stepsMessage === "string"
      ? server.errors.stepsMessage
      : undefined) ??
    (showing("steps") || submitted ? clientErrors.stepsMessage : undefined);

  return (
    <form
      className="case-form"
      aria-label={mode === "create" ? "Create case" : "Edit case"}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      noValidate
    >
      {server?.form && (
        <p className="form-error" role="alert">
          {server.form}
        </p>
      )}

      <div className="field">
        <label htmlFor={`case-title-${formId}`}>Title</label>
        <input
          id={`case-title-${formId}`}
          value={values.title}
          maxLength={200}
          onChange={(event) => update({ title: event.target.value })}
          onBlur={() => touch("title")}
          aria-invalid={fieldError("title") ? true : undefined}
          aria-describedby={
            fieldError("title") ? `case-title-error-${formId}` : undefined
          }
        />
        {fieldError("title") ? (
          <p className="field-error" id={`case-title-error-${formId}`}>
            {fieldError("title")}
          </p>
        ) : (
          <p className="field-hint">
            What behaviour does this case check? 200 characters max.
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={`case-suite-${formId}`}>Suite</label>
        <select
          id={`case-suite-${formId}`}
          value={values.suite_id}
          onChange={(event) => update({ suite_id: event.target.value })}
          onBlur={() => touch("suite_id")}
          aria-invalid={fieldError("suite_id") ? true : undefined}
          aria-describedby={
            fieldError("suite_id") ? `case-suite-error-${formId}` : undefined
          }
        >
          <option value="">Choose a suite</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {fieldError("suite_id") && (
          <p className="field-error" id={`case-suite-error-${formId}`}>
            {fieldError("suite_id")}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={`case-preconditions-${formId}`}>Preconditions</label>
        <textarea
          id={`case-preconditions-${formId}`}
          rows={3}
          value={values.preconditions}
          onChange={(event) => update({ preconditions: event.target.value })}
          onBlur={() => touch("preconditions")}
          aria-invalid={fieldError("preconditions") ? true : undefined}
          aria-describedby={
            fieldError("preconditions")
              ? `case-preconditions-error-${formId}`
              : `case-preconditions-hint-${formId}`
          }
        />
        {fieldError("preconditions") ? (
          <p className="field-error" id={`case-preconditions-error-${formId}`}>
            {fieldError("preconditions")}
          </p>
        ) : (
          <p className="field-hint" id={`case-preconditions-hint-${formId}`}>
            Optional. State the setup a tester needs before step 1.
          </p>
        )}
      </div>

      <fieldset className="steps-fieldset">
        <legend>Steps</legend>
        <p className="field-hint">
          Steps run in order. Expected result is optional but recommended.
        </p>

        {stepsMessage && (
          <p className="field-error" role="alert">
            {stepsMessage}
          </p>
        )}

        {values.steps.length === 0 ? (
          <p className="steps-empty">No steps yet.</p>
        ) : (
          <ol className="steps-list">
            {values.steps.map((step, index) => {
              const textError = stepError(index, "text");
              const expectedError = stepError(index, "expected_result");
              return (
                <li className="step-row" key={stepKeys[index] ?? index}>
                  <span className="step-number t-nums" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="step-fields">
                    <div className="field">
                      <label
                        className="sr-only"
                        htmlFor={`case-step-${index}-text`}
                      >
                        Step {index + 1} action
                      </label>
                      <textarea
                        id={`case-step-${index}-text`}
                        rows={2}
                        placeholder="Action"
                        value={step.text}
                        onChange={(event) =>
                          patchStep(index, { text: event.target.value })
                        }
                        onBlur={() => touch(`step-${index}-text`)}
                        aria-invalid={textError ? true : undefined}
                        aria-describedby={
                          textError
                            ? `case-step-${index}-text-error`
                            : undefined
                        }
                      />
                      {textError && (
                        <p
                          className="field-error"
                          id={`case-step-${index}-text-error`}
                        >
                          {textError}
                        </p>
                      )}
                    </div>
                    <div className="field">
                      <label
                        className="sr-only"
                        htmlFor={`case-step-${index}-expected_result`}
                      >
                        Step {index + 1} expected result
                      </label>
                      <textarea
                        id={`case-step-${index}-expected_result`}
                        rows={2}
                        placeholder="Expected result"
                        value={step.expected_result}
                        onChange={(event) =>
                          patchStep(index, {
                            expected_result: event.target.value,
                          })
                        }
                        onBlur={() => touch(`step-${index}-expected_result`)}
                        aria-invalid={expectedError ? true : undefined}
                        aria-describedby={
                          expectedError
                            ? `case-step-${index}-expected_result-error`
                            : undefined
                        }
                      />
                      {expectedError && (
                        <p
                          className="field-error"
                          id={`case-step-${index}-expected_result-error`}
                        >
                          {expectedError}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="step-actions">
                    <DisabledHint
                      hint={
                        index === 0 ? "This is the first step" : "Move step up"
                      }
                    >
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label={`Move step ${index + 1} up`}
                        onClick={() => moveStep(index, -1)}
                      >
                        ↑
                      </button>
                    </DisabledHint>
                    <DisabledHint
                      hint={
                        index === values.steps.length - 1
                          ? "This is the last step"
                          : "Move step down"
                      }
                    >
                      <button
                        type="button"
                        disabled={index === values.steps.length - 1}
                        aria-label={`Move step ${index + 1} down`}
                        onClick={() => moveStep(index, 1)}
                      >
                        ↓
                      </button>
                    </DisabledHint>
                    <button
                      type="button"
                      aria-label={`Remove step ${index + 1}`}
                      title="Remove step"
                      onClick={() => removeStep(index)}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <DisabledHint
          hint={
            values.steps.length >= 50
              ? "A case can have at most 50 steps"
              : "Add another step"
          }
        >
          <button
            type="button"
            onClick={addStep}
            disabled={values.steps.length >= 50}
          >
            + Add step
          </button>
        </DisabledHint>
      </fieldset>

      <div className="form-grid">
        <div className="field">
          <label htmlFor={`case-priority-${formId}`}>Priority</label>
          <select
            id={`case-priority-${formId}`}
            value={values.priority}
            onChange={(event) =>
              update({ priority: event.target.value as Priority })
            }
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`case-type-${formId}`}>Type</label>
          <select
            id={`case-type-${formId}`}
            value={values.type}
            onChange={(event) =>
              update({ type: event.target.value as CaseType })
            }
          >
            {CASE_TYPES.map((type) => (
              <option key={type} value={type}>
                {CASE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor={`case-tags-${formId}`}>Tags</label>
        <input
          id={`case-tags-${formId}`}
          value={values.tags}
          placeholder="payments, smoke"
          onChange={(event) => update({ tags: event.target.value })}
          onBlur={() => touch("tags")}
          aria-invalid={fieldError("tags") ? true : undefined}
          aria-describedby={
            fieldError("tags")
              ? `case-tags-error-${formId}`
              : `case-tags-hint-${formId}`
          }
        />
        {fieldError("tags") ? (
          <p className="field-error" id={`case-tags-error-${formId}`}>
            {fieldError("tags")}
          </p>
        ) : (
          <p className="field-hint" id={`case-tags-hint-${formId}`}>
            Comma-separated. Lowercased and de-duplicated on save.
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={`case-estimate-${formId}`}>Estimate</label>
        <input
          id={`case-estimate-${formId}`}
          value={values.estimate}
          placeholder="1h 30m"
          onChange={(event) => update({ estimate: event.target.value })}
          onBlur={() => touch("estimate")}
          aria-invalid={fieldError("estimate") ? true : undefined}
          aria-describedby={
            fieldError("estimate")
              ? `case-estimate-error-${formId}`
              : `case-estimate-hint-${formId}`
          }
        />
        {fieldError("estimate") ? (
          <p className="field-error" id={`case-estimate-error-${formId}`}>
            {fieldError("estimate")}
          </p>
        ) : (
          <p className="field-hint" id={`case-estimate-hint-${formId}`}>
            Minutes (&ldquo;90&rdquo;) or hours and minutes
            (&ldquo;1h 30m&rdquo;).
          </p>
        )}
      </div>

      <div className="button-row case-form-actions">
        <DisabledHint
          hint={busy ? "Saving — please wait" : null}
        >
          <button type="submit" className="primary" disabled={busy}>
            {busy
              ? "Saving…"
              : mode === "create"
                ? "Add case"
                : "Save changes"}
          </button>
        </DisabledHint>
        <DisabledHint hint={busy ? "Can't cancel while saving" : null}>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </DisabledHint>
        <span className="field-hint case-save-hint">
          <kbd>Ctrl</kbd> + <kbd>Enter</kbd> saves
        </span>
      </div>
    </form>
  );
}
