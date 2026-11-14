import { CircleCheck, Plus, Sparkles, UserPlus, X } from "lucide-react";
import { type CSSProperties, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { formatSpan } from "@/components/common/dates";
import {
  Avatar,
  Button,
  Card,
  colors,
  Field,
  IconButton,
  inputStyle,
  Pill,
  StackedFillBar,
  selectStyle,
  seniorityLabels,
} from "@/components/common/ui";
import { PersonPicker } from "@/components/projects/PersonPicker";
import { SkillMatch } from "@/components/projects/SkillMatch";
import {
  assignedFte,
  averageFreeFte,
  formatFte,
  fteByPerson,
  missingSkills,
  type StaffingLane,
} from "@/components/projects/staffing";
import { errorMessage, peopleApi } from "@/services/api";
import type { Assignment, Person, SkillRequirement } from "@/types";

// Allocations are whole days per week: the backend rejects ratios off the 20% grid.
const COMMITMENTS = [1, 0.8, 0.6, 0.4, 0.2].map((ratio) => ({
  ratio,
  label:
    ratio === 1 ? "Full-time (5 days/week)" : `${daysPerWeek(ratio)} (${Math.round(ratio * 100)}%)`,
}));

function daysPerWeek(ratio: number): string {
  const days = Math.round(ratio * 5);
  return `${days} ${days === 1 ? "day" : "days"}/week`;
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(lane: StaffingLane): { start: string; end: string } {
  if (lane.dateRanges[0]) return lane.dateRanges[0];
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  return { start: toISODate(start), end: toISODate(end) };
}

export function commitmentForRatio(ratio: number): string {
  return ratio === 1 ? "Full-time" : daysPerWeek(ratio);
}

const rowPadding = "0.95rem 1.5rem";

function joinRequirements(requirements: SkillRequirement[]): string {
  const parts = requirements.map((r) => `${r.id} ≥ ${r.min_level}`);
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** One phase (or the whole project): FTE headline, a per-person stacked bar, the skill
 * requirements, the roster with each member's requirement matches, and the open slot. */
export function StaffingLaneCard({
  lane,
  title,
  people,
  today,
  onAssign,
  onRemove,
  onSuggest,
}: {
  lane: StaffingLane;
  title: string;
  people: Person[];
  today: string;
  onAssign: (data: Omit<Assignment, "id" | "project_id">) => Promise<void>;
  onRemove: (assignmentId: string) => Promise<void>;
  onSuggest?: () => void;
}) {
  const headingId = useId();
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const nameOf = (personId: string) => peopleById.get(personId)?.name ?? personId;
  const missing = missingSkills(lane, people);
  const fte = assignedFte(lane);
  const open = lane.requiredFte === null ? 0 : Math.max(lane.requiredFte - fte, 0);
  const roster = [...lane.assignments].sort((a, b) => a.start.localeCompare(b.start));
  const segments = [...fteByPerson(lane)].map(([personId, value]) => ({
    key: personId,
    label: nameOf(personId).split(" ")[0],
    value,
  }));

  const remove = async (assignmentId: string) => {
    setError(null);
    try {
      await onRemove(assignmentId);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "0.75rem 1rem",
    padding: rowPadding,
    borderTop: `1px solid ${colors.border}`,
  };

  return (
    <section aria-labelledby={headingId}>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "1.25rem 1.5rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "1rem",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 id={headingId} style={{ margin: 0 }}>
                {title}
              </h2>
              {lane.phaseId !== null && lane.dateRanges.length > 0 && (
                <div
                  className="mono"
                  style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: colors.muted }}
                >
                  {lane.dateRanges.map((range) => formatSpan(range, today)).join(", ")}
                </div>
              )}
            </div>
            <div style={{ color: colors.muted, fontSize: "0.95rem" }}>
              <span
                className="mono"
                style={{ fontSize: "1.6rem", fontWeight: 600, color: colors.text }}
              >
                {formatFte(fte)}
              </span>{" "}
              {lane.requiredFte === null ? "FTE" : `of ${lane.requiredFte} FTE`}
            </div>
          </div>

          {lane.requiredFte === null ? (
            <p style={{ margin: "0.4rem 0 0", fontSize: "0.85rem", color: colors.muted }}>
              Assignments not tied to any current phase.
            </p>
          ) : (
            <div style={{ marginTop: "1rem" }}>
              <StackedFillBar segments={segments} total={lane.requiredFte} legend />
            </div>
          )}

          {lane.skillRequirements.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "0.5rem",
                marginTop: "1rem",
                fontSize: "0.88rem",
                color: colors.muted,
              }}
            >
              <span>Requires</span>
              {lane.skillRequirements.map((req) => (
                <Pill key={req.id} tone="outline">
                  {req.id}{" "}
                  <span className="mono">
                    ≥ {req.min_level} · {formatFte(req.fte)} FTE
                  </span>
                </Pill>
              ))}
            </div>
          )}
        </div>

        {roster.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {roster.map((assignment) => {
              const person = peopleById.get(assignment.person_id);
              const name = nameOf(assignment.person_id);
              const details = [
                person?.role,
                person && seniorityLabels[person.seniority],
                lane.requiredFte === null && assignment.phase_id,
              ].filter(Boolean);
              return (
                <li key={assignment.id} style={rowStyle}>
                  <Avatar name={name} />
                  <div style={{ flex: "1 1 10rem", minWidth: 0 }}>
                    <Link
                      to={`/people/${encodeURIComponent(assignment.person_id)}`}
                      style={{ color: colors.text, fontWeight: 600 }}
                    >
                      {name}
                    </Link>
                    {details.length > 0 && (
                      <div style={{ fontSize: "0.85rem", color: colors.muted }}>
                        {details.join(" · ")}
                      </div>
                    )}
                  </div>
                  {person && lane.skillRequirements.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      {lane.skillRequirements.map((req) => (
                        <SkillMatch key={req.id} person={person} requirement={req} />
                      ))}
                    </div>
                  )}
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" title={commitmentForRatio(assignment.ratio)}>
                      {formatFte(assignment.ratio)} FTE
                    </div>
                    <div className="mono" style={{ fontSize: "0.8rem", color: colors.muted }}>
                      {formatSpan(assignment, today)}
                    </div>
                  </div>
                  <IconButton
                    icon={X}
                    size="sm"
                    ariaLabel={`Remove ${name}`}
                    onClick={() => remove(assignment.id)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {lane.requiredFte !== null && (
          <div
            style={{
              ...rowStyle,
              background:
                open > 0 || missing.length > 0
                  ? "color-mix(in srgb, var(--color-warning-tint) 40%, var(--color-surface))"
                  : colors.light,
            }}
          >
            {open > 0 || missing.length > 0 ? (
              <>
                <span
                  aria-hidden
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: `1.5px dashed ${colors.warning}`,
                    color: colors.warning,
                    flexShrink: 0,
                  }}
                >
                  <Plus size={16} />
                </span>
                <div style={{ flex: "1 1 12rem", minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {open > 0 ? `${formatFte(open)} FTE still open` : "Skills not covered"}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: colors.muted }}>
                    {missing.length > 0
                      ? `Needs ${joinRequirements(missing)}`
                      : lane.skillRequirements.length > 0
                        ? "Every required skill is covered"
                        : "No skill requirements"}
                  </div>
                </div>
              </>
            ) : (
              <div
                style={{
                  flex: "1 1 12rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  color: colors.success,
                  fontWeight: 500,
                }}
              >
                <CircleCheck size={18} aria-hidden />
                Fully staffed
              </div>
            )}
            {!assigning && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                <Button
                  icon={UserPlus}
                  onClick={() => setAssigning(true)}
                  ariaLabel={`Assign person to ${lane.label}`}
                >
                  Assign person
                </Button>
                {onSuggest && (open > 0 || missing.length > 0) && (
                  <Button icon={Sparkles} onClick={onSuggest}>
                    Suggest people
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {assigning && (
          <div style={{ padding: rowPadding, borderTop: `1px solid ${colors.border}` }}>
            <AssignForm
              lane={lane}
              people={people}
              onCancel={() => {
                setAssigning(false);
                setError(null);
              }}
              onSubmit={async (data) => {
                setError(null);
                try {
                  await onAssign(data);
                  setAssigning(false);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            />
          </div>
        )}

        {error && (
          <p
            role="alert"
            style={{
              color: colors.danger,
              margin: 0,
              padding: "0 1.5rem 1rem",
              fontSize: "0.85rem",
            }}
          >
            {error}
          </p>
        )}
      </Card>
    </section>
  );
}

/** Inline form to assign a person to `lane`; `defaultPersonId` preselects the person. */
export function AssignForm({
  lane,
  people,
  defaultPersonId = "",
  onCancel,
  onSubmit,
}: {
  lane: StaffingLane;
  people: Person[];
  defaultPersonId?: string;
  onCancel: () => void;
  onSubmit: (data: Omit<Assignment, "id" | "project_id">) => Promise<void>;
}) {
  const [personId, setPersonId] = useState(defaultPersonId);
  const [ratio, setRatio] = useState(1);
  const [range, setRange] = useState(() => defaultRange(lane));
  const [saving, setSaving] = useState(false);
  const [freeFte, setFreeFte] = useState<Map<string, number> | null>(null);
  const personFieldId = useId();
  const assignedIds = new Set(lane.assignments.map((a) => a.person_id));

  useEffect(() => {
    setFreeFte(null);
    const { start, end } = range;
    // Date inputs are briefly empty or inverted while the user edits them.
    if (!start || !end || end < start) return;
    let current = true;
    peopleApi
      .availability(start, end)
      .then((availability) => {
        if (!current) return;
        setFreeFte(
          new Map(
            availability.map((a) => [a.person_id, averageFreeFte(a.segments, { start, end })]),
          ),
        );
      })
      // Availability only annotates the picker, which stays usable without it.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [range]);

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit({
        person_id: personId,
        ratio,
        start: range.start,
        end: range.end,
        phase_id: lane.phaseId,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
          gap: "0 0.75rem",
        }}
      >
        {/* Not a Field: its wrapping <label> would forward clicks on the picker's rows to the input. */}
        <div style={{ gridColumn: "1 / -1", marginBottom: "0.85rem" }}>
          <label
            htmlFor={personFieldId}
            style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: 5 }}
          >
            Person
          </label>
          <PersonPicker
            id={personFieldId}
            people={people}
            value={personId}
            onChange={setPersonId}
            requirements={lane.skillRequirements}
            assignedIds={assignedIds}
            freeFte={freeFte}
            commitment={ratio}
          />
        </div>
        <Field label="Commitment">
          <select
            value={ratio}
            onChange={(e) => setRatio(Number(e.target.value))}
            style={selectStyle}
          >
            {COMMITMENTS.map((item) => (
              <option key={item.ratio} value={item.ratio}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start date">
          <input
            type="date"
            value={range.start}
            onChange={(e) => setRange((current) => ({ ...current, start: e.target.value }))}
            style={inputStyle}
          />
        </Field>
        <Field label="End date">
          <input
            type="date"
            value={range.end}
            onChange={(e) => setRange((current) => ({ ...current, end: e.target.value }))}
            style={inputStyle}
          />
        </Field>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          disabled={saving || !personId || !range.start || !range.end}
          onClick={submit}
        >
          {saving ? "Assigning…" : "Assign"}
        </Button>
      </div>
    </div>
  );
}
