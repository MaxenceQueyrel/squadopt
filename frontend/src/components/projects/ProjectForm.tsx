import { useState } from "react";
import { Button, colors, Field, inputStyle, Modal, selectStyle } from "@/components/common/ui";
import { emptyPhase, PhasesEditor, TagPicker } from "@/components/editors/listEditors";
import { errorMessage } from "@/services/api";
import type { DateRange, Priority, Project, Tag } from "@/types";

const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

export type ProjectDraft = Omit<Project, "id">;

function emptyDraft(): ProjectDraft {
  return {
    name: "",
    description: "",
    phases: [{ ...emptyPhase(), id: "main" }],
    start_window: null,
    priority: "medium",
    completed_at: null,
    excluded_tags: [],
  };
}

/** Modal form to create a project or edit its phases and constraints. A project always has at
 * least one phase, each with its own skill requirements and one date range. */
export function ProjectForm({
  project,
  skillOptions,
  tags,
  onClose,
  onSave,
}: {
  project: Project | null;
  skillOptions: string[];
  tags: Tag[];
  onClose: () => void;
  onSave: (draft: ProjectDraft, id?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProjectDraft>(() =>
    project ? { ...emptyDraft(), ...project } : emptyDraft(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ProjectDraft>(key: K, val: ProjectDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: val }));
  const setStartWindow = (patch: Partial<DateRange>) => {
    const next = { ...(draft.start_window ?? { start: "", end: "" }), ...patch };
    set("start_window", next.start || next.end ? next : null);
  };

  const submit = async () => {
    if (draft.phases.some((phase) => phase.skill_requirements.length === 0)) {
      setError("Add at least one skill requirement to every phase.");
      return;
    }
    if (draft.phases.some((phase) => phase.skill_requirements.some((req) => !req.id.trim()))) {
      setError("Pick a skill for every skill requirement.");
      return;
    }
    if (draft.phases.some((phase) => !phase.id.trim())) {
      setError("Give every phase an id.");
      return;
    }
    if (new Set(draft.phases.map((phase) => phase.id.trim())).size < draft.phases.length) {
      setError("Give every phase a different id.");
      return;
    }
    // The skill pickers hide skills already chosen in the phase, but a duplicate can still be
    // typed by hand.
    for (const phase of draft.phases) {
      const skillIds = phase.skill_requirements.map((req) => req.id.trim());
      const repeated = skillIds.find((id, i) => skillIds.indexOf(id) !== i);
      if (repeated) {
        setError(`Phase "${phase.id.trim()}" requires skill "${repeated}" more than once.`);
        return;
      }
    }
    for (const phase of draft.phases) {
      const range = phase.date_range;
      if (!range) {
        setError("Add a date range to every phase.");
        return;
      }
      if (!range.start || !range.end) {
        setError(`Fill in both start and end of phase "${phase.id.trim()}".`);
        return;
      }
      // The pickers' min/max only constrain the calendar; a date can still be typed out of order.
      if (range.end < range.start) {
        setError(`Phase "${phase.id.trim()}" ends before it starts.`);
        return;
      }
    }
    if (draft.start_window && (!draft.start_window.start || !draft.start_window.end)) {
      setError("Fill in both earliest and latest start, or leave both empty.");
      return;
    }
    if (draft.start_window && draft.start_window.end < draft.start_window.start) {
      setError("Latest start must not be before earliest start.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft, project?.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={project ? `Edit ${project.name}` : "New project"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving || !draft.name.trim()} onClick={submit}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0 1rem" }}>
        <Field label="Name">
          <input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Priority">
          <select
            value={draft.priority}
            onChange={(e) => set("priority", e.target.value as Priority)}
            style={selectStyle}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description">
        <textarea
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Field>

      <TagPicker
        label="Exclude people tagged"
        hint="Anyone carrying one of these tags is kept off every phase of the project."
        value={draft.excluded_tags}
        onChange={(v) => set("excluded_tags", v)}
        tags={tags}
      />

      <Field
        label="Phases"
        hint="Each phase is staffed on its own, with its own skill requirements and one date range. Per skill: the minimum level (0–5), the FTE to staff (1 = one full-time person, 0.2 = one day per week) and the most people to split it across. For a project that runs over several periods, add one phase per period."
      >
        <PhasesEditor
          value={draft.phases}
          onChange={(v) => set("phases", v)}
          skillOptions={skillOptions}
        />
      </Field>

      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ padding: 0, fontSize: "0.82rem", fontWeight: 600, marginBottom: 5 }}>
          Flexible start
        </legend>
        <div style={{ fontSize: "0.78rem", color: colors.muted, marginBottom: 5 }}>
          The optimizer tries a weekly start between these dates and moves the whole schedule with
          it. Leave both empty to keep the phase dates fixed.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
          <Field label="Earliest start">
            <input
              type="date"
              value={draft.start_window?.start ?? ""}
              max={draft.start_window?.end}
              onChange={(e) => setStartWindow({ start: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Latest start">
            <input
              type="date"
              value={draft.start_window?.end ?? ""}
              min={draft.start_window?.start}
              onChange={(e) => setStartWindow({ end: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </div>
      </fieldset>

      {error && (
        <p role="alert" style={{ color: colors.danger, margin: 0 }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
