import { X } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDay, formatSpan, isoToday, parseISODate } from "@/components/common/dates";
import { colors, IconButton, Pill } from "@/components/common/ui";
import { formatFte } from "@/components/projects/staffing";
import { useAppStore } from "@/store";
import type { Assignment, AvailabilityWindow, DateRange, Person } from "@/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type Commitment =
  | { kind: "vacation"; span: DateRange }
  | { kind: "window"; window: AvailabilityWindow }
  | { kind: "assignment"; assignment: Assignment };

function overlaps(a: DateRange, b: DateRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** The person's time off, availability windows and assignments overlapping `range`, in the
 * precedence order the optimizer resolves a day's availability with. */
export function commitmentsOverlapping(
  person: Person,
  assignments: Assignment[],
  range: DateRange,
): Commitment[] {
  const byStart = (a: DateRange, b: DateRange) => a.start.localeCompare(b.start);
  const vacations = person.vacations.filter((v) => overlaps(v, range)).sort(byStart);
  const windows = person.availability_windows.filter((w) => overlaps(w, range)).sort(byStart);
  const ownAssignments = assignments
    .filter((a) => a.person_id === person.id && overlaps(a, range))
    .sort(byStart);
  return [
    ...vacations.map((span): Commitment => ({ kind: "vacation", span })),
    ...windows.map((window): Commitment => ({ kind: "window", window })),
    ...ownAssignments.map((assignment): Commitment => ({ kind: "assignment", assignment })),
  ];
}

function formatWeekday(iso: string, today: string): string {
  const weekday = WEEKDAYS[parseISODate(iso).getUTCDay()];
  return `${weekday} ${formatDay(iso, !iso.startsWith(today.slice(0, 4)))}`;
}

/** What takes up a person's time over one day or week of an availability view.
 *
 * `freeFte` comes from the `/people/availability` segments (a week's average for a week), so
 * the optimizer stays the only place the figure is computed.
 */
export function CommitmentBreakdown({
  person,
  assignments,
  range,
  freeFte,
  showName = false,
  onClose,
}: {
  person: Person;
  assignments: Assignment[];
  range: DateRange;
  freeFte: number;
  showName?: boolean;
  onClose: () => void;
}) {
  const projects = useAppStore((s) => s.projects);
  const today = isoToday();
  const isDay = range.start === range.end;
  const when = isDay
    ? formatWeekday(range.start, today)
    : `${formatWeekday(range.start, today)} → ${formatWeekday(range.end, today)}`;
  const free = `${formatFte(freeFte)} of ${formatFte(person.base_capacity)} FTE free${
    isDay ? "" : " on average"
  }`;
  const commitments = commitmentsOverlapping(person, assignments, range);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  // A single-phase project is staffed as a whole, so its phase id is not worth showing.
  const phaseOf = (a: Assignment) =>
    (projects.find((p) => p.id === a.project_id)?.phases.length ?? 0) > 1 ? a.phase_id : null;

  return (
    <section
      aria-label="Commitment breakdown"
      style={{
        marginTop: "1rem",
        padding: "1rem 1.25rem",
        border: `1px solid ${colors.border}`,
        borderRadius: "var(--radius)",
        background: colors.surface,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
        }}
      >
        <div>
          {showName && <div style={{ fontWeight: 600 }}>{person.name}</div>}
          <div style={{ fontWeight: showName ? 400 : 600 }}>
            {when} · {free}
          </div>
        </div>
        <IconButton icon={X} size="sm" ariaLabel="Close breakdown" onClick={onClose} />
      </div>

      {commitments.length === 0 ? (
        <p style={{ margin: "0.75rem 0 0", color: colors.muted, fontSize: "0.88rem" }}>
          No assignments, time off or reduced capacity in this period.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: "0.75rem 0 0", padding: 0 }}>
          {commitments.map((commitment) => (
            <CommitmentItem
              key={commitmentKey(commitment)}
              commitment={commitment}
              projectName={projectName}
              phaseOf={phaseOf}
              today={today}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function commitmentKey(commitment: Commitment): string {
  if (commitment.kind === "assignment") return commitment.assignment.id;
  const span = commitment.kind === "vacation" ? commitment.span : commitment.window;
  return `${commitment.kind}-${span.start}-${span.end}`;
}

function CommitmentItem({
  commitment,
  projectName,
  phaseOf,
  today,
}: {
  commitment: Commitment;
  projectName: (id: string) => string;
  phaseOf: (assignment: Assignment) => string | null;
  today: string;
}) {
  const span =
    commitment.kind === "vacation"
      ? commitment.span
      : commitment.kind === "window"
        ? commitment.window
        : commitment.assignment;
  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.25rem 1rem",
        padding: "0.55rem 0",
        borderTop: `1px solid ${colors.border}`,
        fontSize: "0.9rem",
      }}
    >
      <div style={{ minWidth: 0 }}>
        {commitment.kind === "vacation" && <Pill tone="warning">Time off</Pill>}
        {commitment.kind === "window" && (
          <>
            <Pill>Reduced capacity</Pill>
            <span style={{ marginLeft: "0.5rem" }}>{formatFte(commitment.window.ratio)} FTE</span>
            <div style={{ marginTop: 4, fontSize: "0.8rem", color: colors.muted }}>
              Overrides project assignments while it applies.
            </div>
          </>
        )}
        {commitment.kind === "assignment" && (
          <>
            <Link
              to={`/projects/${encodeURIComponent(commitment.assignment.project_id)}`}
              style={{ fontWeight: 600, color: colors.primary }}
            >
              {projectName(commitment.assignment.project_id)}
            </Link>
            {phaseOf(commitment.assignment) && (
              <span style={{ color: colors.muted }}> · {phaseOf(commitment.assignment)}</span>
            )}
            <span style={{ marginLeft: "0.5rem" }}>
              {formatFte(commitment.assignment.ratio)} FTE
            </span>
          </>
        )}
      </div>
      <span className="mono" style={{ fontSize: "0.85rem", color: colors.muted }}>
        {formatSpan(span, today)}
      </span>
    </li>
  );
}
