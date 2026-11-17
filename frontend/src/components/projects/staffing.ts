import { daysBetween } from "@/components/common/dates";
import type { FillTone, PillTone } from "@/components/common/ui";
import type {
  AssignedMember,
  Assignment,
  AvailabilitySegment,
  DateRange,
  Person,
  Project,
  SkillAllocation,
  SkillRequirement,
} from "@/types";

export type FillStatus = "complete" | "partial" | "empty";

/** Pill / fill-bar tone per fill status; an empty lane reads as a gap like a partial one. */
export const fillTones: Record<FillStatus, FillTone> = {
  complete: "success",
  partial: "warning",
  empty: "warning",
};

/** Fill status of a whole project from its staffed and requested FTE. */
export function projectFill(staffed: number, total: number): FillStatus {
  if (staffed >= total) return "complete";
  return staffed === 0 ? "empty" : "partial";
}

/** One staffing unit of a project: a phase, the whole project when it has a single phase,
 * or the catch-all for assignments that belong to no current phase. */
export interface StaffingLane {
  key: string;
  label: string;
  phaseId: string | null; // sent as `phase_id` when assigning; null for the unphased lane
  requiredFte: number | null; // sum of the skill FTE; null for the unphased lane, which has no requirements
  skillRequirements: SkillRequirement[];
  dateRanges: DateRange[];
  assignments: Assignment[];
}

/** Splits a project's assignments into staffing lanes, phases in timeline order (undated last). */
export function buildLanes(project: Project, assignments: Assignment[]): StaffingLane[] {
  const own = assignments.filter((a) => a.project_id === project.id);
  const wholeProject = project.phases.length === 1;
  const phases = [...project.phases].sort((a, b) => {
    if (!a.date_range || !b.date_range) return Number(!a.date_range) - Number(!b.date_range);
    return a.date_range.start.localeCompare(b.date_range.start);
  });
  const lanes: StaffingLane[] = phases.map((phase) => ({
    key: wholeProject ? "whole-project" : `phase-${phase.id}`,
    label: wholeProject ? "Whole project" : phase.id,
    phaseId: phase.id,
    requiredFte: requiredFte(phase.skill_requirements),
    skillRequirements: phase.skill_requirements,
    dateRanges: phase.date_range ? [phase.date_range] : [],
    assignments: own.filter((a) => a.phase_id === phase.id),
  }));

  // Phases can be renamed or removed after people were staffed on them; those
  // assignments land here too so nothing on the project is hidden.
  const phaseIds = new Set(project.phases.map((p) => p.id));
  const unphased = own.filter((a) => !phaseIds.has(a.phase_id));
  if (unphased.length > 0) {
    lanes.push({
      key: "unphased",
      label: "Unphased",
      phaseId: null,
      requiredFte: null,
      skillRequirements: [],
      dateRanges: [],
      assignments: unphased,
    });
  }
  return lanes;
}

function roundFte(fte: number): number {
  return Math.round(fte * 100) / 100;
}

/** Each distinct person's FTE on the lane, in roster order: their highest ratio on it. */
export function fteByPerson(lane: StaffingLane): Map<string, number> {
  // A person can hold several assignments on the same lane.
  const ratioByPerson = new Map<string, number>();
  for (const a of lane.assignments) {
    ratioByPerson.set(a.person_id, Math.max(ratioByPerson.get(a.person_id) ?? 0, a.ratio));
  }
  return ratioByPerson;
}

/** FTE staffed on the lane: each distinct person counts once, at their ratio on the lane. */
export function assignedFte(lane: StaffingLane): number {
  let total = 0;
  for (const ratio of fteByPerson(lane).values()) total += ratio;
  return roundFte(total);
}

export function formatFte(fte: number): string {
  return String(roundFte(fte));
}

/** FTE a project or phase needs: the sum of its skill needs. */
export function requiredFte(requirements: SkillRequirement[]): number {
  return roundFte(requirements.reduce((sum, req) => sum + req.fte, 0));
}

/** A member's per-skill shares, e.g. "python 40% · react 40%". */
export function formatSkillAllocations(allocations: SkillAllocation[]): string {
  return allocations.map((a) => `${a.skill_id} ${Math.round(a.fte * 100)}%`).join(" · ");
}

/** A score as a rating out of 5 of its theoretical max, e.g. "2.1 / 5". Clamped to [0, 5]:
 * negative affinities can push a score below zero, but a rating reads as bounded, and the
 * exact value stays in `formatRawScore`. "—" when there is no score or the max is zero (an
 * empty result). */
export function formatScoreRating(
  score: number | null | undefined,
  maxScore: number | null | undefined,
): string {
  if (score == null || maxScore == null || maxScore <= 0) return "—";
  const rating = Math.min(Math.max((score / maxScore) * 5, 0), 5);
  return `${rating.toFixed(1)} / 5`;
}

/** The exact score behind `formatScoreRating`, with its unclamped share of the max, e.g.
 * "Raw score: 12.34 / 29.10 (42% of theoretical max)". Undefined when the rating is "—", so
 * there is no details bubble next to a dash. */
export function formatRawScore(
  score: number | null | undefined,
  maxScore: number | null | undefined,
): string | undefined {
  if (score == null || maxScore == null || maxScore <= 0) return undefined;
  const share = Math.round((score / maxScore) * 100);
  return `Raw score: ${score.toFixed(2)} / ${maxScore.toFixed(2)} (${share}% of theoretical max)`;
}

export function formatHeadcount(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

function fillStatus(lane: StaffingLane): FillStatus {
  const fte = assignedFte(lane);
  if (fte === 0) return "empty";
  return fte >= (lane.requiredFte ?? 0) ? "complete" : "partial";
}

/** A person's level in a skill; like the optimizer, a skill they lack counts as level 0. */
export function skillLevel(person: Person, skillId: string): number {
  return person.skills.find((s) => s.id === skillId)?.level ?? 0;
}

/** How well a person covers a set of skill requirements: all of them, some, or none. */
export type SkillMatchTier = "full" | "partial" | "none";

export function skillMatchTier(person: Person, requirements: SkillRequirement[]): SkillMatchTier {
  const met = requirements.filter((req) => skillLevel(person, req.id) >= req.min_level).length;
  if (met === requirements.length) return "full";
  return met > 0 ? "partial" : "none";
}

/** Average FTE free per day over `range` (inclusive), from availability segments that may
 * extend past either end of it; days no segment covers count as fully booked. */
export function averageFreeFte(segments: AvailabilitySegment[], range: DateRange): number {
  let total = 0;
  for (const segment of segments) {
    const start = segment.start > range.start ? segment.start : range.start;
    const end = segment.end < range.end ? segment.end : range.end;
    if (start <= end) total += (daysBetween(start, end) + 1) * segment.ratio;
  }
  return total / (daysBetween(range.start, range.end) + 1);
}

/** Requirements of the lane that no assigned person meets at the required level. */
export function missingSkills(lane: StaffingLane, people: Person[]): SkillRequirement[] {
  const assignedIds = new Set(lane.assignments.map((a) => a.person_id));
  const assigned = people.filter((p) => assignedIds.has(p.id));
  return lane.skillRequirements.filter(
    (req) => !assigned.some((p) => skillLevel(p, req.id) >= req.min_level),
  );
}

/** FTE staffed across all lanes; over-staffing one lane never offsets a gap in another. */
export function staffedFte(lanes: StaffingLane[]): { staffed: number; total: number } {
  let staffed = 0;
  let total = 0;
  for (const lane of lanes) {
    if (lane.requiredFte === null) continue;
    staffed += Math.min(assignedFte(lane), lane.requiredFte);
    total += lane.requiredFte;
  }
  return { staffed: roundFte(staffed), total: roundFte(total) };
}

/** Current staffing as team members, limited to the phases `proposed` covers: applying a
 * proposal only replaces those, so other phases are not part of its diff. */
export function staffingBaseline(
  assignments: Assignment[],
  proposed: AssignedMember[],
): AssignedMember[] {
  const covered = new Set(proposed.map((m) => m.phase_id));
  const byKey = new Map<string, AssignedMember>();
  for (const a of assignments) {
    if (!covered.has(a.phase_id)) continue;
    // A member can hold several assignments on the same phase.
    byKey.set(`${a.person_id}|${a.phase_id}`, {
      person_id: a.person_id,
      fte_allocation: a.ratio,
      skill_allocations: [],
      phase_id: a.phase_id,
    });
  }
  return [...byKey.values()];
}

/** Whether every lane with requirements has its FTE filled and all its skills covered. */
export function isFullyStaffed(lanes: StaffingLane[], people: Person[]): boolean {
  return lanes.every(
    (lane) =>
      lane.requiredFte === null ||
      (fillStatus(lane) === "complete" && missingSkills(lane, people).length === 0),
  );
}

/** Lifecycle status shown as a pill on project lists and the project workspace. */
export type ProjectStatus = "unstaffed" | "running" | "ended" | "complete";

export const projectStatusLabels: Record<ProjectStatus, string> = {
  unstaffed: "Unstaffed",
  running: "Running",
  ended: "Ended",
  complete: "Complete",
};

export const projectStatusTones: Record<ProjectStatus, PillTone> = {
  unstaffed: "warning",
  running: "success",
  ended: "neutral",
  complete: "primary",
};

/** First start to last end across the project's phase dates; null if undated. */
export function projectSpan(project: Project): DateRange | null {
  const ranges = project.phases.flatMap((phase) => (phase.date_range ? [phase.date_range] : []));
  if (ranges.length === 0) return null;
  let { start, end } = ranges[0];
  for (const range of ranges) {
    if (range.start < start) start = range.start;
    if (range.end > end) end = range.end;
  }
  return { start, end };
}

/** Status of a project on `today` (`YYYY-MM-DD`), first match wins: `complete` once
 * `completed_at` is set, `ended` when its last date is past, `unstaffed` when nobody is
 * assigned, otherwise `running` (which includes staffed projects that have not started). */
export function projectStatus(
  project: Project,
  lanes: StaffingLane[],
  today: string,
): ProjectStatus {
  if (project.completed_at) return "complete";
  const span = projectSpan(project);
  if (span && span.end < today) return "ended";
  return lanes.some((lane) => lane.assignments.length > 0) ? "running" : "unstaffed";
}

/** Whether people can still be staffed on the project: it is neither complete nor ended. */
export function isOpenForStaffing(project: Project, today: string): boolean {
  const status = projectStatus(project, buildLanes(project, []), today);
  return status !== "complete" && status !== "ended";
}

/** Whether a project that is not complete still has requested FTE left to fill, even if it ended. */
export function needsStaffing(project: Project, lanes: StaffingLane[]): boolean {
  if (project.completed_at) return false;
  const { staffed, total } = staffedFte(lanes);
  return staffed < total;
}
