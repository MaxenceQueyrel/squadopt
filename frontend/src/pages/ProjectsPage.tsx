import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronRight,
  Download,
  Plus,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/shallow";
import { daysBetween, formatSpan, isoToday } from "@/components/common/dates";
import {
  AvatarStack,
  Button,
  colors,
  Field,
  FillBar,
  FilterMenu,
  IconButton,
  inputStyle,
  PageHeader,
  Pill,
  popoverStyle,
  priorityIcons,
  priorityTones,
  SearchInput,
  selectStyle,
  Tabs,
  useDismiss,
} from "@/components/common/ui";
import { ProjectForm } from "@/components/projects/ProjectForm";
import {
  buildLanes,
  type FillStatus,
  fillTones,
  formatFte,
  needsStaffing,
  type ProjectStatus,
  projectFill,
  projectSpan,
  projectStatus,
  projectStatusLabels,
  projectStatusTones,
  staffedFte,
} from "@/components/projects/staffing";
import { assignmentsApi, projectsApi } from "@/services/api";
import { downloadBlob } from "@/services/download";
import { knownSkillIds, useAppStore } from "@/store";
import { useAuthStore } from "@/store/authStore";
import type { Assignment, DateRange, Priority, Project, ProjectsImportSummary } from "@/types";

type StatusFilter = "all" | "needs-staffing" | "running" | "ended";

const STATUS_FILTERS: StatusFilter[] = ["all", "needs-staffing", "running", "ended"];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  "needs-staffing": "Needs staffing",
  running: "Running",
  ended: "Ended",
};

// The batch solve endpoint accepts 2–10 projects.
const MIN_BATCH_PROJECTS = 2;
const MAX_BATCH_PROJECTS = 10;

const COLUMNS = "minmax(0, 2.3fr) minmax(0, 1.2fr) minmax(0, 1.7fr) 7.5rem 1.25rem";

const rowGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: COLUMNS,
  alignItems: "center",
  gap: "1.5rem",
  padding: "0 1.5rem",
};

interface ProjectRow {
  project: Project;
  staffed: number;
  total: number;
  status: ProjectStatus;
  needsStaffing: boolean;
  span: DateRange | null;
  members: string[];
}

function message(e: unknown): string {
  if (typeof e === "object" && e && "message" in e)
    return String((e as { message: unknown }).message);
  return String(e);
}

function parseStatusFilter(value: string | null): StatusFilter {
  return STATUS_FILTERS.find((filter) => filter === value) ?? "all";
}

function matchesStatus(row: ProjectRow, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs-staffing") return row.needsStaffing;
  return row.status === filter;
}

const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

const PRIORITY_RANK: Record<Priority, number> = { low: 0, medium: 1, high: 2, critical: 3 };

type StaffingFilter = "unstaffed" | "partial" | "full";

const STAFFING_FILTERS: StaffingFilter[] = ["unstaffed", "partial", "full"];

const STAFFING_FILTER_LABELS: Record<StaffingFilter, string> = {
  unstaffed: "Unstaffed",
  partial: "Partially staffed",
  full: "Fully staffed",
};

// Matches projectFill() so the filter always agrees with the fill-bar colour.
const STAFFING_FILTER_FILLS: Record<StaffingFilter, FillStatus> = {
  unstaffed: "empty",
  partial: "partial",
  full: "complete",
};

type SortKey = "priority" | "start" | "end" | "staffing";
type SortDir = "asc" | "desc";

const SORT_KEYS: SortKey[] = ["priority", "start", "end", "staffing"];

const SORT_KEY_LABELS: Record<SortKey, string> = {
  priority: "Priority",
  start: "Start date",
  end: "End date",
  staffing: "Staffing",
};

const DEFAULT_SORT_DIRS: Record<SortKey, SortDir> = {
  priority: "desc",
  start: "asc",
  end: "asc",
  staffing: "desc",
};

interface ListView {
  status: StatusFilter;
  query: string;
  priorities: Priority[];
  staffing: StaffingFilter[];
  from: string;
  to: string;
  sort: SortKey;
  dir: SortDir;
}

function parseList<T extends string>(value: string | null, allowed: T[]): T[] {
  const values = value?.split(",") ?? [];
  return allowed.filter((option) => values.includes(option));
}

function parseDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function viewFromParams(params: URLSearchParams): ListView {
  const sort = SORT_KEYS.find((key) => key === params.get("sort")) ?? "priority";
  const dir = params.get("dir");
  return {
    status: parseStatusFilter(params.get("status")),
    query: params.get("q") ?? "",
    priorities: parseList(params.get("priority"), PRIORITIES),
    staffing: parseList(params.get("staffing"), STAFFING_FILTERS),
    from: parseDate(params.get("from")),
    to: parseDate(params.get("to")),
    sort,
    dir: dir === "asc" || dir === "desc" ? dir : DEFAULT_SORT_DIRS[sort],
  };
}

function viewToParams(view: ListView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.status !== "all") params.set("status", view.status);
  if (view.query) params.set("q", view.query);
  if (view.priorities.length > 0) params.set("priority", view.priorities.join(","));
  if (view.staffing.length > 0) params.set("staffing", view.staffing.join(","));
  if (view.from) params.set("from", view.from);
  if (view.to) params.set("to", view.to);
  if (view.sort !== "priority") params.set("sort", view.sort);
  if (view.dir !== DEFAULT_SORT_DIRS[view.sort]) params.set("dir", view.dir);
  return params;
}

function matchesView(row: ProjectRow, view: ListView): boolean {
  const needle = view.query.trim().toLowerCase();
  if (
    !row.project.name.toLowerCase().includes(needle) &&
    !row.project.description.toLowerCase().includes(needle)
  )
    return false;
  if (!matchesStatus(row, view.status)) return false;
  if (view.priorities.length > 0 && !view.priorities.includes(row.project.priority)) return false;
  if (
    view.staffing.length > 0 &&
    !view.staffing.some(
      (filter) => STAFFING_FILTER_FILLS[filter] === projectFill(row.staffed, row.total),
    )
  )
    return false;
  if (view.from || view.to) {
    if (!row.span) return false;
    if (view.to && row.span.start > view.to) return false;
    if (view.from && row.span.end < view.from) return false;
  }
  return true;
}

type SortValue = string | number | null;

function sortValue(row: ProjectRow, key: SortKey): SortValue {
  if (key === "priority") return PRIORITY_RANK[row.project.priority];
  if (key === "start") return row.span?.start ?? null;
  if (key === "end") return row.span?.end ?? null;
  return row.total > 0 ? row.staffed / row.total : null;
}

// A null value (unscheduled, or no FTE requested) sorts last whatever the direction.
function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  const order = a < b ? -1 : a > b ? 1 : 0;
  return dir === "asc" ? order : -order;
}

function compareRows(a: ProjectRow, b: ProjectRow, sort: SortKey, dir: SortDir): number {
  const tieBreak =
    sort === "priority"
      ? compareValues(sortValue(a, "start"), sortValue(b, "start"), "asc")
      : compareValues(sortValue(a, "priority"), sortValue(b, "priority"), "desc");
  return (
    compareValues(sortValue(a, sort), sortValue(b, sort), dir) ||
    tieBreak ||
    a.project.name.localeCompare(b.project.name)
  );
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeDays(days: number): string {
  const abs = Math.abs(days);
  if (abs < 45) return relativeTime.format(days, "day");
  if (abs < 365) return relativeTime.format(Math.round(days / 30), "month");
  return relativeTime.format(Math.round(days / 365), "year");
}

function spanTiming(span: DateRange, today: string): string {
  if (today < span.start) return `starts ${relativeDays(daysBetween(today, span.start))}`;
  if (today <= span.end) return `ends ${relativeDays(daysBetween(today, span.end))}`;
  return `ended ${relativeDays(daysBetween(today, span.end))}`;
}

export default function ProjectsPage() {
  const {
    projects,
    people,
    isLoading,
    fetchProjects,
    fetchPeople,
    fetchSkills,
    saveProject,
    importProjects,
  } = useAppStore();
  const skillOptions = useAppStore(useShallow(knownSkillIds));
  const canWriteProjects = useAuthStore((s) => s.permissions.has("projects:write"));
  const canRunOptimization = useAuthStore((s) => s.permissions.has("optimization:run"));
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Local state mirrored to the URL: binding the search input to the URL directly drops
  // keystrokes, since react-router applies location changes in a transition.
  const [view, setView] = useState(() => viewFromParams(searchParams));
  const update = (changes: Partial<ListView>) => setView((v) => ({ ...v, ...changes }));
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [importSummary, setImportSummary] = useState<ProjectsImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  // In click order, which sets the order of the batch results.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const today = isoToday();

  useEffect(() => {
    setSearchParams(viewToParams(view), { replace: true });
  }, [view, setSearchParams]);

  useEffect(() => {
    fetchProjects();
    fetchPeople();
    fetchSkills();
    assignmentsApi
      .list()
      .then(setAssignments)
      .catch((e) => setError(message(e)));
  }, [fetchProjects, fetchPeople, fetchSkills]);

  const rows = useMemo<ProjectRow[]>(() => {
    const names = new Map(people.map((p) => [p.id, p.name]));
    return projects.map((project) => {
      const lanes = buildLanes(project, assignments);
      const memberIds = new Set(lanes.flatMap((lane) => lane.assignments.map((a) => a.person_id)));
      return {
        project,
        ...staffedFte(lanes),
        status: projectStatus(project, lanes, today),
        needsStaffing: needsStaffing(project, lanes),
        span: projectSpan(project),
        members: [...memberIds].flatMap((id) => {
          const name = names.get(id);
          return name ? [name] : [];
        }),
      };
    });
  }, [projects, assignments, people, today]);

  const visibleRows = rows
    .filter((row) => matchesView(row, view))
    .sort((a, b) => compareRows(a, b, view.sort, view.dir));
  const requested = rows.reduce((sum, row) => sum + row.total, 0);
  const staffed = rows.reduce((sum, row) => sum + row.staffed, 0);

  const toggleSelected = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id],
    );

  const handleImportFile = async (file: File) => {
    setImporting(true);
    setError(null);
    setImportSummary(null);
    try {
      setImportSummary(await importProjects(file));
    } catch (e) {
      setError(message(e));
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      downloadBlob(await projectsApi.exportCsv(), "projects.csv");
    } catch (e) {
      setError(message(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${rows.length} ${rows.length === 1 ? "project" : "projects"} · ${formatFte(requested)} FTE requested · ${formatFte(staffed)} FTE staffed`}
        actions={
          <>
            {canRunOptimization && (
              <Button
                icon={SlidersHorizontal}
                disabled={
                  selectedIds.length < MIN_BATCH_PROJECTS || selectedIds.length > MAX_BATCH_PROJECTS
                }
                onClick={() =>
                  navigate(`/projects/optimize?ids=${encodeURIComponent(selectedIds.join(","))}`)
                }
              >
                Optimize selected ({selectedIds.length})
              </Button>
            )}
            {canWriteProjects && (
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
                  New project
                </Button>
              </>
            )}
          </>
        }
      />

      {importSummary && (
        <p style={{ color: colors.success, margin: "0 0 1rem", fontSize: "0.85rem" }}>
          Import complete — created {importSummary.created.length}
          {importSummary.skipped.length > 0 && (
            <>
              , skipped {importSummary.skipped.length} (already existing:{" "}
              {importSummary.skipped.join(", ")})
            </>
          )}
          .
        </p>
      )}
      {error && (
        <p style={{ color: colors.danger, margin: "0 0 1rem", fontSize: "0.85rem" }}>{error}</p>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "0.75rem",
        }}
      >
        <Tabs
          variant="segmented"
          ariaLabel="Filter projects by status"
          value={view.status}
          onChange={(value) => update({ status: parseStatusFilter(value) })}
          items={STATUS_FILTERS.map((filter) => ({
            value: filter,
            label: STATUS_FILTER_LABELS[filter],
            count: rows.filter((row) => matchesStatus(row, filter)).length,
          }))}
        />
        <SearchInput
          value={view.query}
          onChange={(query) => update({ query })}
          placeholder="Search projects"
          style={{ width: "100%", maxWidth: "22rem" }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.6rem",
          flexWrap: "wrap",
          marginBottom: "1.25rem",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
          <FilterMenu
            label="Priority"
            options={PRIORITIES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))}
            selected={view.priorities}
            onChange={(selected) => update({ priorities: selected as Priority[] })}
          />
          <FilterMenu
            label="Staffing"
            options={STAFFING_FILTERS.map((s) => ({ value: s, label: STAFFING_FILTER_LABELS[s] }))}
            selected={view.staffing}
            onChange={(selected) => update({ staffing: selected as StaffingFilter[] })}
          />
          <DateRangeFilter
            from={view.from}
            to={view.to}
            onChange={(from, to) => update({ from, to })}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label
            htmlFor="projects-sort"
            style={{ fontSize: "0.85rem", color: colors.muted, whiteSpace: "nowrap" }}
          >
            Sort by
          </label>
          <select
            id="projects-sort"
            value={view.sort}
            onChange={(e) => {
              const sort = SORT_KEYS.find((key) => key === e.target.value) ?? "priority";
              update({ sort, dir: DEFAULT_SORT_DIRS[sort] });
            }}
            style={{ ...selectStyle, width: "auto" }}
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {SORT_KEY_LABELS[key]}
              </option>
            ))}
          </select>
          <IconButton
            variant="secondary"
            icon={view.dir === "asc" ? ArrowUpNarrowWide : ArrowDownWideNarrow}
            ariaLabel={view.dir === "asc" ? "Sort ascending" : "Sort descending"}
            onClick={() => update({ dir: view.dir === "asc" ? "desc" : "asc" })}
          />
        </div>
      </div>

      {isLoading && projects.length === 0 ? (
        <p>Loading…</p>
      ) : projects.length === 0 ? (
        <p style={{ color: colors.muted }}>No projects yet. Create your first project.</p>
      ) : visibleRows.length === 0 ? (
        <p style={{ color: colors.muted }}>No projects match these filters.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 820 }}>
            <div
              aria-hidden
              style={{
                ...rowGrid,
                marginBottom: "0.6rem",
                fontSize: "0.85rem",
                color: colors.muted,
              }}
            >
              <span>Project</span>
              <span>Dates</span>
              <span>Staffing</span>
              <span>Status</span>
            </div>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {visibleRows.map((row) => (
                <ProjectListRow
                  key={row.project.id}
                  row={row}
                  today={today}
                  selected={selectedIds.includes(row.project.id)}
                  onToggleSelected={
                    canRunOptimization ? () => toggleSelected(row.project.id) : undefined
                  }
                  onSetDates={canWriteProjects ? () => setEditing(row.project) : undefined}
                />
              ))}
            </ul>
          </div>
        </div>
      )}

      {editing && (
        <ProjectForm
          project={editing === "new" ? null : editing}
          people={people}
          skillOptions={skillOptions}
          onClose={() => setEditing(null)}
          onSave={async (draft, id) => {
            await saveProject(draft, id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const boundCount = Number(Boolean(from)) + Number(Boolean(to));

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="btn btn-secondary btn-md"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Dates
        {boundCount > 0 && (
          <span className="mono" style={{ color: colors.primary, fontSize: "0.8rem" }}>
            {boundCount}
          </span>
        )}
        <ChevronDown size={15} aria-hidden />
      </button>
      {open && (
        <fieldset style={{ ...popoverStyle, left: 0, margin: 0, padding: "0.75rem" }}>
          <legend style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
            Dates
          </legend>
          <div style={{ fontSize: "0.8rem", color: colors.muted, marginBottom: "0.6rem" }}>
            Projects running at some point in this range
          </div>
          <Field label="From">
            <input
              type="date"
              value={from}
              onChange={(e) => onChange(e.target.value, to)}
              style={inputStyle}
            />
          </Field>
          <Field label="To" style={{ marginBottom: 0 }}>
            <input
              type="date"
              value={to}
              onChange={(e) => onChange(from, e.target.value)}
              style={inputStyle}
            />
          </Field>
          {boundCount > 0 && (
            <button
              type="button"
              className="menu-item"
              onClick={() => onChange("", "")}
              style={{
                color: colors.muted,
                borderTop: `1px solid ${colors.border}`,
                borderRadius: 0,
                marginTop: "0.6rem",
              }}
            >
              Clear
            </button>
          )}
        </fieldset>
      )}
    </div>
  );
}

function ProjectListRow({
  row,
  today,
  selected,
  onToggleSelected,
  onSetDates,
}: {
  row: ProjectRow;
  today: string;
  selected: boolean;
  onToggleSelected?: () => void;
  onSetDates?: () => void;
}) {
  const { project, staffed, total, status, span, members } = row;
  const fill = projectFill(staffed, total);

  return (
    <li
      style={{
        ...rowGrid,
        position: "relative",
        padding: "1.1rem 1.5rem",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.6rem" }}>
          {onToggleSelected && (
            <input
              type="checkbox"
              aria-label={`Select ${project.name}`}
              title={project.completed_at ? "Completed projects can't be optimized" : undefined}
              checked={selected}
              disabled={Boolean(project.completed_at)}
              onChange={onToggleSelected}
              // The row-wide link comes later in the DOM, so it would paint over the checkbox
              // without a z-index.
              style={{ position: "relative", zIndex: 1, margin: 0 }}
            />
          )}
          <h3 style={{ margin: 0 }}>
            <Link to={`/projects/${encodeURIComponent(project.id)}`} style={{ color: "inherit" }}>
              {project.name}
              {/* Stretches the link over the whole row; "Set dates" sits above it. */}
              <span aria-hidden style={{ position: "absolute", inset: 0 }} />
            </Link>
          </h3>
          <Pill tone={priorityTones[project.priority]} icon={priorityIcons[project.priority]}>
            {project.priority[0].toUpperCase() + project.priority.slice(1)}
          </Pill>
        </div>
        <div
          style={{
            marginTop: "0.35rem",
            fontSize: "0.9rem",
            color: project.description ? colors.muted : colors.subtle,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {project.description || "No description yet"}
        </div>
      </div>

      <div>
        {span ? (
          <>
            <div className="mono" style={{ fontSize: "0.9rem" }}>
              {formatSpan(span, today)}
            </div>
            <div style={{ marginTop: "0.2rem", fontSize: "0.82rem", color: colors.muted }}>
              {spanTiming(span, today)}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: "0.9rem" }}>Not scheduled</div>
            {onSetDates && (
              <button
                type="button"
                onClick={onSetDates}
                aria-label={`Set dates for ${project.name}`}
                style={{
                  position: "relative",
                  marginTop: "0.2rem",
                  padding: 0,
                  border: "none",
                  background: "none",
                  color: colors.primary,
                  fontSize: "0.82rem",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Set dates
              </button>
            )}
          </>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
          <FillBar value={staffed} max={total} tone={fillTones[fill]} style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: "0.9rem", whiteSpace: "nowrap" }}>
            {formatFte(staffed)} / {formatFte(total)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginTop: "0.5rem",
            fontSize: "0.85rem",
            color: colors.muted,
          }}
        >
          {members.length > 0 ? (
            <>
              <AvatarStack names={members} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {members.map((name) => name.split(" ")[0]).join(", ")}
              </span>
            </>
          ) : (
            "Nobody assigned"
          )}
        </div>
      </div>

      <div>
        <Pill tone={projectStatusTones[status]} dot>
          {projectStatusLabels[status]}
        </Pill>
      </div>

      <ChevronRight size={18} aria-hidden style={{ color: colors.muted }} />
    </li>
  );
}
