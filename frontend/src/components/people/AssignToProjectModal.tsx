import { useState } from "react";
import { isoToday } from "@/components/common/dates";
import { colors, Field, Modal, selectStyle } from "@/components/common/ui";
import { AssignForm } from "@/components/projects/StaffingLaneCard";
import {
  buildLanes,
  excludingTags,
  formatFte,
  isOpenForStaffing,
} from "@/components/projects/staffing";
import { assignmentsApi, errorMessage } from "@/services/api";
import type { Assignment, Person, Project } from "@/types";

/** Picks an open project (and phase, for phased projects), then assigns `person` to it with the
 * same form the project workspace uses. Projects excluding one of the person's tags are listed
 * but disabled, with the tags as the reason. */
export function AssignToProjectModal({
  person,
  projects,
  onClose,
  onAssigned,
}: {
  person: Person;
  projects: Project[];
  onClose: () => void;
  onAssigned: (assignment: Assignment) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [laneKey, setLaneKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const project = projects.find((p) => p.id === projectId);
  const lanes = project ? buildLanes(project, []) : [];
  const lane = lanes.length === 1 ? lanes[0] : lanes.find((l) => l.key === laneKey);
  const today = isoToday();
  const openProjects = projects
    .filter((p) => isOpenForStaffing(p, today))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Modal title="Assign to project" onClose={onClose}>
      <Field label="Project">
        <select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setLaneKey("");
            setError(null);
          }}
          style={selectStyle}
        >
          <option value="">Select a project</option>
          {openProjects.map((p) => {
            const excludedBy = excludingTags(p.excluded_tags, person);
            return (
              <option key={p.id} value={p.id} disabled={excludedBy.length > 0}>
                {excludedBy.length > 0 ? `${p.name} (excludes ${excludedBy.join(", ")})` : p.name}
              </option>
            );
          })}
        </select>
      </Field>

      {lanes.length > 1 && (
        <Field label="Phase">
          <select value={laneKey} onChange={(e) => setLaneKey(e.target.value)} style={selectStyle}>
            <option value="">Select a phase</option>
            {lanes.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {project && lane && (
        <>
          <p style={{ margin: "0 0 0.25rem", fontSize: "0.85rem", color: colors.muted }}>
            Needs {lane.requiredFte} FTE
            {lane.skillRequirements.length > 0 &&
              ` · ${lane.skillRequirements.map((s) => `${s.id} ≥ ${s.min_level} (${formatFte(s.fte)} FTE)`).join(", ")}`}
          </p>
          <AssignForm
            key={`${project.id}-${lane.key}`}
            lane={lane}
            people={[person]}
            excludedTags={project.excluded_tags}
            defaultPersonId={person.id}
            onCancel={onClose}
            onSubmit={async (data) => {
              setError(null);
              try {
                onAssigned(await assignmentsApi.create({ ...data, project_id: project.id }));
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          />
        </>
      )}

      {error && (
        <p
          role="alert"
          style={{ color: colors.danger, margin: "0.75rem 0 0", fontSize: "0.85rem" }}
        >
          {error}
        </p>
      )}
    </Modal>
  );
}
