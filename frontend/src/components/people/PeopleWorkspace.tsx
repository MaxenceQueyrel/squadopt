import { CircleAlert, CircleCheck, Download, Plus, Upload, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useShallow } from "zustand/shallow";
import { addDays, isoToday } from "@/components/common/dates";
import { Button, colors, IconButton, PageHeader, Tabs } from "@/components/common/ui";
import { PersonForm } from "@/components/people/PersonForm";
import { averageFreeFte, formatFte, formatHeadcount } from "@/components/projects/staffing";
import { assignmentsApi, errorMessage, peopleApi } from "@/services/api";
import { downloadBlob } from "@/services/download";
import { knownRoleIds, knownSkillIds, useAppStore } from "@/store";
import { useAuthStore } from "@/store/authStore";
import type { Assignment, AvailabilitySegment, PeopleImportSummary, Person } from "@/types";

export const FREE_HORIZON_DAYS = 30;

/** What the People workspace hands to its tabs through the router outlet. */
export interface PeopleWorkspaceContext {
  // Average FTE each person has free over the next FREE_HORIZON_DAYS, keyed by person id.
  freeRatios: Map<string, number>;
  // Ids of the projects each person has a current assignment on, keyed by person id.
  currentProjectIds: Map<string, string[]>;
  editPerson: (person: Person) => void;
}

/** Average FTE free per day over the FREE_HORIZON_DAYS days starting `today`, from
 * availability segments that may extend past either end of that window. */
export function freeNextDays(segments: AvailabilitySegment[], today: string): number {
  return averageFreeFte(segments, { start: today, end: addDays(today, FREE_HORIZON_DAYS - 1) });
}

function currentProjectIdsByPerson(
  assignments: Assignment[],
  today: string,
): Map<string, string[]> {
  const byPerson = new Map<string, string[]>();
  const sorted = [...assignments].sort((a, b) => a.start.localeCompare(b.start));
  for (const a of sorted) {
    if (a.end < today) continue;
    const projectIds = byPerson.get(a.person_id) ?? [];
    if (!projectIds.includes(a.project_id)) projectIds.push(a.project_id);
    byPerson.set(a.person_id, projectIds);
  }
  return byPerson;
}

function summaryLine(people: Person[], freeRatios: Map<string, number>): string {
  if (people.length === 0) return "No people yet";
  const capacity = people.reduce((sum, p) => sum + p.base_capacity, 0);
  const parts = [formatHeadcount(people.length), `${formatFte(capacity)} FTE capacity`];
  if (freeRatios.size > 0) {
    const free = people.reduce((sum, p) => sum + (freeRatios.get(p.id) ?? 0), 0);
    const allFree = people.every((p) => (freeRatios.get(p.id) ?? 0) >= p.base_capacity - 0.005);
    parts.push(
      allFree
        ? `all free in the next ${FREE_HORIZON_DAYS} days`
        : `${formatFte(free)} FTE free in the next ${FREE_HORIZON_DAYS} days`,
    );
  }
  return parts.join(" · ");
}

// "1 new role, 2 new skills and 1 new tag (External)", or "" when the import added nothing.
function catalogAdditions(summary: PeopleImportSummary): string {
  const parts: string[] = [];
  const count = (n: number, noun: string) => `${n} new ${noun}${n === 1 ? "" : "s"}`;
  if (summary.created_roles.length > 0) parts.push(count(summary.created_roles.length, "role"));
  if (summary.created_skills.length > 0) parts.push(count(summary.created_skills.length, "skill"));
  if (summary.created_tags.length > 0)
    parts.push(`${count(summary.created_tags.length, "tag")} (${summary.created_tags.join(", ")})`);
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Shared frame of the People workspace: the header with its summary line and roster actions,
 * the Directory / Capacity / Roles, skills & tags tabs, and the person form they open. */
export default function PeopleWorkspace() {
  const {
    people,
    roles,
    tags,
    fetchPeople,
    fetchProjects,
    fetchRoles,
    fetchSkills,
    fetchTags,
    savePerson,
    importPeople,
  } = useAppStore();
  const roleOptions = useAppStore(useShallow(knownRoleIds));
  const skillOptions = useAppStore(useShallow(knownSkillIds));
  const canWritePeople = useAuthStore((s) => s.permissions.has("people:write"));
  const location = useLocation();
  // This layout stays mounted across the tabs, so it can remember each tab's filters and
  // restore them when the user comes back to it.
  const [searches, setSearches] = useState<Record<string, string>>({
    [location.pathname]: location.search,
  });
  if (searches[location.pathname] !== location.search) {
    setSearches({ ...searches, [location.pathname]: location.search });
  }
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const [importSummary, setImportSummary] = useState<PeopleImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [freeRatios, setFreeRatios] = useState<Map<string, number>>(new Map());
  const [currentProjectIds, setCurrentProjectIds] = useState<Map<string, string[]>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchPeople();
    fetchProjects();
    fetchRoles();
    fetchSkills();
    fetchTags();
  }, [fetchPeople, fetchProjects, fetchRoles, fetchSkills, fetchTags]);

  // Re-run whenever the roster is refetched so a saved working-pattern or vacation change, or an
  // assignment made from a person's detail page, shows up.
  useEffect(() => {
    if (people.length === 0) return;
    const today = isoToday();
    peopleApi
      .availability(today, addDays(today, FREE_HORIZON_DAYS - 1))
      .then((availability) =>
        setFreeRatios(
          new Map(availability.map((a) => [a.person_id, freeNextDays(a.segments, today)])),
        ),
      )
      .catch((e) => setError(errorMessage(e)));
    assignmentsApi
      .list()
      .then((assignments) => setCurrentProjectIds(currentProjectIdsByPerson(assignments, today)))
      .catch((e) => setError(errorMessage(e)));
  }, [people]);

  const handleImportFile = async (file: File) => {
    setImporting(true);
    setError(null);
    setImportSummary(null);
    try {
      setImportSummary(await importPeople(file));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      downloadBlob(await peopleApi.exportCsv(), "people.csv");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const tabs = [
    {
      value: "directory",
      label: "Directory",
      to: `/people${searches["/people"] ?? ""}`,
      end: true,
    },
    {
      value: "capacity",
      label: "Capacity",
      to: `/people/capacity${searches["/people/capacity"] ?? ""}`,
    },
    { value: "catalog", label: "Roles, skills & tags", to: "/people/catalog" },
  ];
  const context: PeopleWorkspaceContext = {
    freeRatios,
    currentProjectIds,
    editPerson: setEditing,
  };

  return (
    <div>
      <PageHeader
        title="People"
        subtitle={summaryLine(people, freeRatios)}
        style={{ marginBottom: "1.25rem" }}
        actions={
          canWritePeople ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) handleImportFile(file);
                }}
              />
              <Button
                icon={Upload}
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                {importing ? "Importing…" : "Import"}
              </Button>
              <Button icon={Download} disabled={exporting} onClick={handleExport}>
                {exporting ? "Exporting…" : "Export"}
              </Button>
              <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>
                Add person
              </Button>
            </>
          ) : undefined
        }
      />

      {importSummary && (
        <Notice tone="success" onDismiss={() => setImportSummary(null)}>
          Import complete — created {importSummary.created.length}
          {importSummary.skipped.length > 0 && (
            <>
              , skipped {importSummary.skipped.length} (already existing:{" "}
              {importSummary.skipped.join(", ")})
            </>
          )}
          .
          {catalogAdditions(importSummary) && (
            <> Also added {catalogAdditions(importSummary)} to the catalog.</>
          )}
        </Notice>
      )}
      {error && (
        <Notice tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}

      <Tabs items={tabs} ariaLabel="People views" style={{ marginBottom: "1.5rem" }} />
      <Outlet context={context} />

      {editing && (
        <PersonForm
          person={editing === "new" ? null : editing}
          people={people}
          roles={roles}
          tags={tags}
          roleOptions={roleOptions}
          skillOptions={skillOptions}
          onClose={() => setEditing(null)}
          onSave={async (draft, id) => {
            await savePerson(draft, id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Notice({
  tone,
  onDismiss,
  children,
}: {
  tone: "success" | "danger";
  onDismiss: () => void;
  children: ReactNode;
}) {
  const Icon = tone === "success" ? CircleCheck : CircleAlert;
  return (
    <div
      role={tone === "success" ? "status" : "alert"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        marginBottom: "1rem",
        padding: "0.55rem 0.6rem 0.55rem 0.9rem",
        borderRadius: "var(--radius)",
        background: tone === "success" ? colors.successBg : colors.dangerBg,
        color: tone === "success" ? colors.success : colors.danger,
        fontSize: "0.875rem",
      }}
    >
      <Icon size={16} aria-hidden style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{children}</span>
      <IconButton icon={X} ariaLabel="Dismiss" size="sm" onClick={onDismiss} />
    </div>
  );
}
