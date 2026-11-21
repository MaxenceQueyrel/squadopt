import { CalendarCheck, CalendarClock, CalendarX, type LucideIcon } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import {
  Avatar,
  colors,
  inputStyle,
  Pill,
  type PillTone,
  seniorityLabels,
  useDismiss,
} from "@/components/common/ui";
import { SkillMatch } from "@/components/projects/SkillMatch";
import {
  excludingTags,
  formatFte,
  formatHeadcount,
  type SkillMatchTier,
  skillMatchTier,
} from "@/components/projects/staffing";
import type { Person, SkillRequirement } from "@/types";

const tiers: Record<SkillMatchTier, { rank: number; accent: string }> = {
  full: { rank: 0, accent: colors.success },
  partial: { rank: 1, accent: colors.warning },
  none: { rank: 2, accent: colors.danger },
};

// Free FTE is a day-weighted average of ratios, so allow for float noise when comparing.
const EPSILON = 0.005;

function availabilityBadge(
  free: number,
  commitment: number,
): { label: string; tone: PillTone; icon: LucideIcon } {
  if (free >= commitment - EPSILON)
    return { label: "Available", tone: "success", icon: CalendarCheck };
  if (free < EPSILON) return { label: "Unavailable", tone: "danger", icon: CalendarX };
  return { label: `${formatFte(free)} FTE free`, tone: "warning", icon: CalendarClock };
}

// In the page flow rather than a popover: the lane card clips its overflow.
const listStyle: CSSProperties = {
  marginTop: 4,
  padding: "0.25rem",
  background: colors.surface,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
  maxHeight: 320,
  overflowY: "auto",
};

/** A searchable, keyboard-navigable person picker for staffing a lane.
 *
 * Each row shows the person's profile and their level in each of `requirements`, with a
 * green / amber / red left accent for meeting all, some or none of them, and, once
 * `freeFte` is known, whether they have `commitment` FTE free. Rows are sorted by match
 * tier, then free FTE, then name; nobody is disabled, so a poor fit can still be picked.
 * People carrying one of the project's `excludedTags` are left out, and a note at the bottom
 * of the list says how many and by which tags.
 */
export function PersonPicker({
  id,
  people,
  excludedTags,
  value,
  onChange,
  requirements,
  assignedIds,
  freeFte,
  commitment,
}: {
  id: string;
  people: Person[];
  excludedTags: string[];
  value: string;
  onChange: (personId: string) => void;
  requirements: SkillRequirement[];
  assignedIds: Set<string>;
  freeFte: Map<string, number> | null; // average free FTE per person over the form's dates
  commitment: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useDismiss(containerRef, open, () => setOpen(false));

  const selected = people.find((p) => p.id === value);
  const hidden = people.filter((person) => excludingTags(excludedTags, person).length > 0);
  const hidingTags = excludedTags.filter((tag) => hidden.some((p) => p.tags.includes(tag)));
  const candidates = people
    .filter((person) => !hidden.includes(person))
    .map((person) => ({
      person,
      tier: skillMatchTier(person, requirements),
      free: freeFte?.get(person.id),
    }))
    .sort(
      (a, b) =>
        tiers[a.tier].rank - tiers[b.tier].rank ||
        (b.free ?? 0) - (a.free ?? 0) ||
        a.person.name.localeCompare(b.person.name),
    );
  const search = query.trim().toLowerCase();
  const matches = search
    ? candidates.filter((c) => c.person.name.toLowerCase().includes(search))
    : candidates;

  // `matches` shrinks as the user types, so the stored index can outrun the list.
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));
  const optionId = (personId: string) => `${listId}-${personId}`;
  const activeId =
    open && matches[activeIndex] ? optionId(matches[activeIndex].person.id) : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const openList = () => {
    setQuery("");
    setActive(0);
    setOpen(true);
  };

  const choose = (person: Person) => {
    onChange(person.id);
    setOpen(false);
  };

  return (
    <div ref={containerRef}>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          value={open ? query : (selected?.name ?? "")}
          placeholder={selected?.name ?? "Search people"}
          onFocus={openList}
          onClick={() => {
            if (!open) openList();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (open) setActive(Math.min(activeIndex + 1, matches.length - 1));
              else openList();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive(Math.max(activeIndex - 1, 0));
            } else if (e.key === "Enter" && open && matches[activeIndex]) {
              e.preventDefault();
              choose(matches[activeIndex].person);
            }
          }}
          style={{ ...inputStyle, paddingRight: "1.75rem" }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: "0.6rem",
            top: "50%",
            transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
            color: colors.muted,
            fontSize: "0.7rem",
            pointerEvents: "none",
          }}
        >
          ▾
        </span>
      </div>

      {open && (
        <div style={listStyle}>
          {matches.length === 0 ? (
            <div style={{ padding: "0.35rem 0.5rem", color: colors.muted }}>
              {search ? `Nobody matches “${query.trim()}”` : "Nobody to pick"}
            </div>
          ) : (
            <div id={listId} role="listbox" aria-label="People">
              {matches.map(({ person, tier, free }, i) => {
                const badge = free === undefined ? null : availabilityBadge(free, commitment);
                const details = [person.role, seniorityLabels[person.seniority]].filter(Boolean);
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input owns the keyboard (aria-activedescendant)
                  <div
                    key={person.id}
                    id={optionId(person.id)}
                    role="option"
                    aria-selected={person.id === value}
                    data-tier={tier}
                    tabIndex={-1}
                    // The input would blur before click fires and lose the active row.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(person)}
                    onMouseEnter={() => setActive(i)}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.65rem",
                      padding: "0.55rem 0.65rem",
                      borderRadius: 6,
                      borderLeft: `3px solid ${tiers[tier].accent}`,
                      background: i === activeIndex ? colors.primaryBg : "transparent",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                    }}
                  >
                    <Avatar name={person.name} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: "0.4rem",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 600,
                            color: tier === "none" ? colors.muted : colors.text,
                          }}
                        >
                          {person.name}
                        </span>
                        {assignedIds.has(person.id) && (
                          <Pill tone="primary">Already on this phase</Pill>
                        )}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: colors.muted }}>
                        {details.join(" · ")}
                      </div>
                      {requirements.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.35rem",
                            marginTop: "0.35rem",
                          }}
                        >
                          {requirements.map((req) => (
                            <SkillMatch key={req.id} person={person} requirement={req} />
                          ))}
                        </div>
                      )}
                    </div>
                    {badge && (
                      <Pill tone={badge.tone} icon={badge.icon}>
                        {badge.label}
                      </Pill>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {hidden.length > 0 && (
            <div
              style={{ padding: "0.45rem 0.5rem 0.2rem", fontSize: "0.8rem", color: colors.muted }}
            >
              {formatHeadcount(hidden.length)} hidden — excluded by tag: {hidingTags.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
