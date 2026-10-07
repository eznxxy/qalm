"use client";

/**
 * Create + Edit forms for projects (docs/api-projects.md).
 * - Create is offered to Admin and Lead; Edit to Admin only (role gating
 *   happens in the callers — these components render the forms).
 * - The key is auto-suggested from the name (PRD rule) and stays
 *   user-editable; lowercase input is normalized to uppercase like the
 *   server does, and client validation mirrors the contract rules.
 * - Server 400/409 errors land on their fields (details name the field);
 *   403 and other failures render as a form-level alert.
 * - There is deliberately no status control: the contract forbids PATCH from
 *   setting status (archive/restore are separate endpoints).
 */
import { FormEvent, useState } from "react";
import { Project } from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import {
  normalizeProjectKey,
  suggestProjectKey,
} from "@/lib/project-key";
import {
  ProjectFormErrors,
  projectFormServerErrors,
  validateProjectForm,
} from "@/lib/project-form";
import { ApiError } from "@/lib/api-error";
import { projectActionError } from "./project-action-error";

/** True when the name changed since the key was suggested — re-suggest it. */
function keyFollowsName(key: string, suggested: string): boolean {
  return key === suggested;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="field-error">
      {message}
    </p>
  );
}

export function CreateProjectForm({
  onCreated,
  onCancel,
}: {
  onCreated: (project: Project) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleNameChange(nextName: string) {
    setName(nextName);
    // Auto-suggest per the PRD while the user has not customized the key.
    if (keyFollowsName(key, suggestProjectKey(name))) {
      setKey(suggestProjectKey(nextName));
    }
  }

  function handleKeyChange(nextKey: string) {
    setKey(nextKey);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const nextErrors = validateProjectForm({ name, key, description });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const project = await api.createProject({
        name: name.trim(),
        key: normalizeProjectKey(key),
        description: description.trim() || undefined,
      });
      onCreated(project);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return; // auth layer owns it
      const mapped = projectFormServerErrors(err);
      setErrors(mapped.fields);
      setFormError(
        mapped.form ??
          (Object.keys(mapped.fields).length > 0 ? null : projectActionError(err, "create"))
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="panel" aria-label="Create project">
      <h2>Create project</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="project-name">Name</label>
          <input
            id="project-name"
            type="text"
            autoComplete="off"
            required
            maxLength={100}
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "project-name-error" : undefined}
          />
          <FieldError id="project-name-error" message={errors.name} />
        </div>
        <div className="field">
          <label htmlFor="project-key">Key</label>
          <input
            id="project-key"
            type="text"
            autoComplete="off"
            required
            maxLength={10}
            value={key}
            onChange={(e) => handleKeyChange(e.target.value.toUpperCase())}
            aria-invalid={errors.key ? true : undefined}
            aria-describedby="project-key-hint project-key-error"
            className="project-key-input"
          />
          <p id="project-key-hint" className="muted">
            2–10 characters, A–Z and 0–9, letter first. Suggested from the name —
            edit it if you prefer.
          </p>
          <FieldError id="project-key-error" message={errors.key} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="project-description">Description</label>
        <textarea
          id="project-description"
          rows={3}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby="project-description-error"
        />
        <FieldError id="project-description-error" message={errors.description} />
      </div>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <div className="button-row">
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Creating…" : "Create project"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function EditProjectForm({
  project,
  onSaved,
  onCancel,
}: {
  project: Project;
  onSaved: (project: Project) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [key, setKey] = useState(project.key);
  const [description, setDescription] = useState(project.description ?? "");
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const nextErrors = validateProjectForm({ name, key, description });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // PATCH takes any subset — send only what changed. Status is never sent.
    const body: { name?: string; key?: string; description?: string } = {};
    if (name.trim() !== project.name) body.name = name.trim();
    if (normalizeProjectKey(key) !== project.key) body.key = normalizeProjectKey(key);
    if (description.trim() !== (project.description ?? ""))
      body.description = description.trim();

    if (Object.keys(body).length === 0) {
      onCancel();
      return;
    }

    setSubmitting(true);
    try {
      const updated = await api.updateProject(project.id, body);
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return; // auth layer owns it
      const mapped = projectFormServerErrors(err);
      setErrors(mapped.fields);
      setFormError(
        mapped.form ??
          (Object.keys(mapped.fields).length > 0 ? null : projectActionError(err, "update"))
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="panel"
      aria-label={`Edit project ${project.name}`}
    >
      <h2>Edit project</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="edit-project-name">Name</label>
          <input
            id="edit-project-name"
            type="text"
            autoComplete="off"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "edit-project-name-error" : undefined}
          />
          <FieldError id="edit-project-name-error" message={errors.name} />
        </div>
        <div className="field">
          <label htmlFor="edit-project-key">Key</label>
          <input
            id="edit-project-key"
            type="text"
            autoComplete="off"
            required
            maxLength={10}
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            aria-invalid={errors.key ? true : undefined}
            aria-describedby="edit-project-key-error"
            className="project-key-input"
          />
          <FieldError id="edit-project-key-error" message={errors.key} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="edit-project-description">Description</label>
        <textarea
          id="edit-project-description"
          rows={3}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby="edit-project-description-error"
        />
        <FieldError id="edit-project-description-error" message={errors.description} />
      </div>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <div className="button-row">
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
