import { useState } from "react";
import { Combobox } from "@/components/common/Combobox";
import { Button, colors, inputStyle, selectStyle } from "@/components/common/ui";
import { requiredFte } from "@/components/projects/staffing";
import type {
  AvailabilityWindow,
  DateRange,
  Person,
  ProjectPhase,
  SkillLevel,
  SkillRequirement,
  Tag,
} from "@/types";

const rowStyle = {
  display: "flex",
  gap: "0.5rem",
  alignItems: "center",
  marginBottom: "0.5rem",
} as const;

function num(value: string): number {
  const n = parseFloat(value);
  return Number.isNaN(n) ? 0 : n;
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove"
      style={{
        border: `1px solid ${colors.borderStrong}`,
        background: colors.surface,
        color: colors.danger,
        borderRadius: 6,
        width: 30,
        height: 30,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      ×
    </button>
  );
}

/** A person's skill rows, each picked from the catalog. Skills can't be typed, so a person
 * never gets one the catalog doesn't know; one recorded before that rule stays on its row. */
export function SkillsEditor({
  value,
  onChange,
  skillOptions,
}: {
  value: SkillLevel[];
  onChange: (v: SkillLevel[]) => void;
  skillOptions: string[];
}) {
  const update = (i: number, patch: Partial<SkillLevel>) =>
    onChange(value.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const unused = skillOptions.filter((o) => !value.some((s) => s.id === o));

  return (
    <div>
      {value.map((s, i) => (
        <div key={i} style={rowStyle}>
          <select
            aria-label="Skill"
            value={s.id}
            onChange={(e) => update(i, { id: e.target.value })}
            style={{ ...selectStyle, flex: 1 }}
          >
            <option value="">Select a skill</option>
            {s.id && !skillOptions.includes(s.id) && (
              <option value={s.id}>{s.id} (not in catalog)</option>
            )}
            {skillOptions
              .filter((o) => o === s.id || !value.some((other) => other.id === o))
              .map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
          </select>
          <input
            type="number"
            min={0}
            max={5}
            step={0.5}
            title="Proficiency level (0–5)"
            value={s.level}
            onChange={(e) => update(i, { level: num(e.target.value) })}
            style={{ ...inputStyle, width: 90 }}
          />
          <RemoveButton onClick={() => onChange(value.filter((_, idx) => idx !== i))} />
        </div>
      ))}
      <Button
        disabled={unused.length === 0}
        onClick={() => onChange([...value, { id: "", level: 3 }])}
      >
        + Add skill
      </Button>
      {skillOptions.length === 0 && (
        <div style={{ marginTop: 4, fontSize: "0.75rem", color: colors.muted }}>
          Create a skill in the catalog first, then come back here to assign it.
        </div>
      )}
    </div>
  );
}

const FTE_OPTIONS = Array.from({ length: 25 }, (_, i) => (i + 1) / 5);

// From as few people as the FTE allows (full-time each) to one day per week each.
function peopleRange(fte: number): number[] {
  const steps = Math.round(fte * 5);
  const min = Math.ceil(steps / 5);
  return Array.from({ length: steps - min + 1 }, (_, i) => min + i);
}

const reqColumns = { level: 70, fte: 76, maxPeople: 76 } as const;

export function SkillReqsEditor({
  value,
  onChange,
  skillOptions,
}: {
  value: SkillRequirement[];
  onChange: (v: SkillRequirement[]) => void;
  skillOptions: string[];
}) {
  const update = (i: number, patch: Partial<SkillRequirement>) =>
    onChange(value.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const setFte = (i: number, fte: number) => {
    const allowed = peopleRange(fte);
    const maxPeople = Math.min(
      Math.max(value[i].max_people, allowed[0]),
      allowed[allowed.length - 1],
    );
    update(i, { fte, max_people: maxPeople });
  };

  return (
    <div>
      {value.length > 0 && (
        <div
          aria-hidden
          style={{ ...rowStyle, marginBottom: 2, fontSize: "0.72rem", color: colors.muted }}
        >
          <span style={{ flex: 1 }}>Skill</span>
          <span style={{ width: reqColumns.level }}>Min level</span>
          <span style={{ width: reqColumns.fte }}>FTE</span>
          <span style={{ width: reqColumns.maxPeople }}>Max people</span>
          <span style={{ width: 30 }} />
        </div>
      )}
      {value.map((s, i) => (
        <div key={i} style={rowStyle}>
          <Combobox
            placeholder="skill id"
            value={s.id}
            onChange={(id) => update(i, { id })}
            options={skillOptions.filter(
              (o) => !value.some((other, idx) => idx !== i && other.id.trim() === o),
            )}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            min={0}
            max={5}
            step={0.5}
            title="Minimum level (0–5): only people at or above it can fill this need"
            aria-label="Minimum level"
            value={s.min_level}
            onChange={(e) => update(i, { min_level: num(e.target.value) })}
            style={{ ...inputStyle, width: reqColumns.level }}
          />
          <select
            title="FTE to staff on this skill (1 = one full-time person, 0.2 = one day per week)"
            aria-label="FTE"
            value={s.fte}
            onChange={(e) => setFte(i, Number(e.target.value))}
            style={{ ...selectStyle, width: reqColumns.fte }}
          >
            {FTE_OPTIONS.map((fte) => (
              <option key={fte} value={fte}>
                {fte}
              </option>
            ))}
          </select>
          <select
            title="Most people this FTE may be split across"
            aria-label="Max people"
            value={s.max_people}
            onChange={(e) => update(i, { max_people: Number(e.target.value) })}
            style={{ ...selectStyle, width: reqColumns.maxPeople }}
          >
            {peopleRange(s.fte).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
          <RemoveButton onClick={() => onChange(value.filter((_, idx) => idx !== i))} />
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <Button
          onClick={() => onChange([...value, { id: "", min_level: 3, fte: 1, max_people: 1 }])}
        >
          + Add requirement
        </Button>
        {value.length > 0 && (
          <span className="mono" style={{ fontSize: "0.82rem", color: colors.muted }}>
            Total {requiredFte(value)} FTE
          </span>
        )}
      </div>
    </div>
  );
}

/** A single optional date range: an add button while unset, start and end inputs once set. */
export function DateRangeEditor({
  value,
  onChange,
}: {
  value: DateRange | null;
  onChange: (v: DateRange | null) => void;
}) {
  if (!value) {
    return <Button onClick={() => onChange({ start: "", end: "" })}>+ Add date range</Button>;
  }
  return (
    <div style={rowStyle}>
      <input
        type="date"
        aria-label="Start"
        value={value.start}
        max={value.end}
        onChange={(e) => onChange({ ...value, start: e.target.value })}
        style={{ ...inputStyle, flex: 1 }}
      />
      <span style={{ color: colors.muted }}>→</span>
      <input
        type="date"
        aria-label="End"
        value={value.end}
        min={value.start}
        onChange={(e) => onChange({ ...value, end: e.target.value })}
        style={{ ...inputStyle, flex: 1 }}
      />
      <RemoveButton onClick={() => onChange(null)} />
    </div>
  );
}

export function AvailabilityEditor({
  value,
  onChange,
}: {
  value: AvailabilityWindow[];
  onChange: (v: AvailabilityWindow[]) => void;
}) {
  const update = (i: number, patch: Partial<AvailabilityWindow>) =>
    onChange(value.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));

  return (
    <div>
      {value.map((w, i) => (
        <div key={i} style={rowStyle}>
          <input
            type="date"
            aria-label="Window start"
            value={w.start}
            max={w.end}
            onChange={(e) => update(i, { start: e.target.value })}
            style={{ ...inputStyle, flex: 1 }}
          />
          <span style={{ color: colors.muted }}>→</span>
          <input
            type="date"
            aria-label="Window end"
            value={w.end}
            min={w.start}
            onChange={(e) => update(i, { end: e.target.value })}
            style={{ ...inputStyle, flex: 1 }}
          />
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            title="FTE ratio during window (0–1)"
            aria-label="Window ratio"
            value={w.ratio}
            onChange={(e) => update(i, { ratio: num(e.target.value) })}
            style={{ ...inputStyle, width: 80 }}
          />
          <RemoveButton onClick={() => onChange(value.filter((_, idx) => idx !== i))} />
        </div>
      ))}
      <Button onClick={() => onChange([...value, { start: "", end: "", ratio: 0.5 }])}>
        + Add window
      </Button>
    </div>
  );
}

export function AffinitiesEditor({
  value,
  onChange,
  people,
}: {
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
  people: Person[]; // candidate counterparts (self already excluded)
}) {
  const entries = Object.entries(value);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  const used = new Set(Object.keys(value));
  const available = people.filter((p) => !used.has(p.id));

  const setScore = (id: string, score: number) => onChange({ ...value, [id]: score });
  const remove = (id: string) => {
    const next = { ...value };
    delete next[id];
    onChange(next);
  };

  return (
    <div>
      {entries.map(([id, score]) => (
        <div key={id} style={rowStyle}>
          <span style={{ flex: 1, fontSize: "0.875rem" }}>{nameOf(id)}</span>
          <input
            type="number"
            min={-5}
            max={5}
            step={1}
            title="Affinity score (-5..+5)"
            value={score}
            onChange={(e) => setScore(id, num(e.target.value))}
            style={{ ...inputStyle, width: 90 }}
          />
          <RemoveButton onClick={() => remove(id)} />
        </div>
      ))}
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && setScore(e.target.value, 0)}
          style={{ ...selectStyle, maxWidth: 260 }}
        >
          <option value="">+ Add affinity with…</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Skill chips picked from `skillOptions`. Typed text only adds a skill when it names one of
 * the options, so a skill outside them is never recorded. */
export function TagSkillInput({
  value,
  onChange,
  skillOptions,
  placeholder = "search skills, or pick one below",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  skillOptions: string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const available = skillOptions.filter((o) => !value.includes(o));
  const add = (skill: string) => {
    onChange([...value, skill]);
    setDraft("");
  };
  const addTyped = () => {
    const query = draft.trim().toLowerCase();
    const match = available.find((o) => o.toLowerCase() === query);
    if (match) add(match);
    else setDraft("");
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          marginBottom: value.length ? "0.5rem" : 0,
        }}
      >
        {value.map((tag) => (
          <span
            key={tag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: colors.primaryBg,
              color: colors.primary,
              borderRadius: 12,
              padding: "0.15rem 0.6rem",
              fontSize: "0.8rem",
            }}
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              aria-label={`Remove ${tag}`}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                color: colors.primary,
                fontSize: "1rem",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <Combobox
        value={draft}
        onChange={setDraft}
        options={available}
        placeholder={placeholder}
        onSelect={add}
        onEnter={addTyped}
        onBlur={addTyped}
      />
    </div>
  );
}

/** A field of checkbox chips picking tags from the catalog. Tags can't be typed, so a typo
 * never reaches a person or project. */
export function TagPicker({
  label,
  hint,
  value,
  onChange,
  tags,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (v: string[]) => void;
  tags: Tag[];
}) {
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((t) => t !== id) : [...value, id]);

  // A fieldset rather than Field: inside Field's <label>, clicking the hint would toggle the
  // first chip.
  return (
    <fieldset style={{ border: "none", margin: "0 0 0.85rem", padding: 0, minWidth: 0 }}>
      <legend style={{ padding: 0, marginBottom: 5, fontSize: "0.82rem", fontWeight: 600 }}>
        {label}
      </legend>
      {hint && (
        <div style={{ fontSize: "0.78rem", color: colors.muted, marginBottom: 5 }}>{hint}</div>
      )}
      {tags.length === 0 ? (
        <div style={{ fontSize: "0.8rem", color: colors.muted }}>
          No tags yet. Add them from the Tags card on the People page.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
          {tags.map((tag) => {
            const checked = value.includes(tag.id);
            return (
              <label
                key={tag.id}
                title={tag.description || undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0.2rem 0.65rem",
                  borderRadius: 999,
                  border: `1px solid ${checked ? colors.primary : colors.borderStrong}`,
                  background: checked ? colors.primaryBg : colors.surface,
                  color: checked ? colors.primary : colors.text,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(tag.id)}
                  style={{ accentColor: "var(--color-primary)", margin: 0 }}
                />
                {tag.id}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

export function emptyPhase(): ProjectPhase {
  return { id: "", skill_requirements: [], date_range: null };
}

/** Cards for a project's phases. The last phase cannot be removed: a project always has one. */
export function PhasesEditor({
  value,
  onChange,
  skillOptions,
}: {
  value: ProjectPhase[];
  onChange: (v: ProjectPhase[]) => void;
  skillOptions: string[];
}) {
  const update = (i: number, patch: Partial<ProjectPhase>) =>
    onChange(value.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const labelStyle = { fontSize: "0.75rem", fontWeight: 600, margin: "0.25rem 0" } as const;

  return (
    <div>
      {value.map((phase, i) => (
        <div
          key={i}
          style={{
            border: `1px solid ${colors.borderStrong}`,
            borderRadius: 8,
            padding: "0.85rem",
            marginBottom: "0.85rem",
            background: colors.light,
          }}
        >
          <div
            style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.6rem" }}
          >
            <input
              placeholder="phase id (e.g. design)"
              aria-label="Phase id"
              value={phase.id}
              onChange={(e) => update(i, { id: e.target.value })}
              style={{ ...inputStyle, flex: 1 }}
            />
            {value.length > 1 && (
              <RemoveButton onClick={() => onChange(value.filter((_, idx) => idx !== i))} />
            )}
          </div>

          <div style={labelStyle}>Skill requirements</div>
          <SkillReqsEditor
            value={phase.skill_requirements}
            onChange={(reqs) => update(i, { skill_requirements: reqs })}
            skillOptions={skillOptions}
          />

          <div style={{ ...labelStyle, marginTop: "0.6rem" }}>Date range</div>
          <DateRangeEditor
            value={phase.date_range}
            onChange={(range) => update(i, { date_range: range })}
          />
        </div>
      ))}
      <Button onClick={() => onChange([...value, emptyPhase()])}>+ Add phase</Button>
    </div>
  );
}
