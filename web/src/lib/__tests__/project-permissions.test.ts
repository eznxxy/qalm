import {
  canArchiveProject,
  canCreateProject,
  canEditProject,
  canRestoreProject,
  canViewArchivedProjects,
} from "@/lib/project-permissions";
import type { Role } from "@/lib/api-types";

/**
 * The docs/api-projects.md § Role matrix as executable truth:
 *   create/archive → admin, lead
 *   edit/restore   → admin only
 *   archived view  → admin only
 */
describe("project role matrix", () => {
  const cases: {
    role: Role;
    create: boolean;
    edit: boolean;
    archive: boolean;
    restore: boolean;
    archivedView: boolean;
  }[] = [
    { role: "admin", create: true, edit: true, archive: true, restore: true, archivedView: true },
    { role: "lead", create: true, edit: false, archive: true, restore: false, archivedView: false },
    { role: "tester", create: false, edit: false, archive: false, restore: false, archivedView: false },
    { role: "viewer", create: false, edit: false, archive: false, restore: false, archivedView: false },
  ];

  it.each(cases)(
    "$role: create=$create edit=$edit archive=$archive restore=$restore archivedView=$archivedView",
    ({ role, create, edit, archive, restore, archivedView }) => {
      expect(canCreateProject(role)).toBe(create);
      expect(canEditProject(role)).toBe(edit);
      expect(canArchiveProject(role)).toBe(archive);
      expect(canRestoreProject(role)).toBe(restore);
      expect(canViewArchivedProjects(role)).toBe(archivedView);
    }
  );
});
