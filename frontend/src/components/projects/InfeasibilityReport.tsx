import { colors } from "@/components/common/ui";
import { formatFte } from "@/components/projects/staffing";
import type { InfeasibilityDetail, PhaseConflict } from "@/types";

function explain(conflict: PhaseConflict): { reason: string; hint: string } {
  const scope = conflict.phase_id === null ? "the project" : `phase '${conflict.phase_id}'`;
  const need = formatFte(conflict.need_fte);
  // The solver caps the need at what the eligible pool can supply.
  const fit =
    conflict.need_fte < conflict.required_fte
      ? `the ${need} FTE ${scope} can staff from who is available (of ${formatFte(conflict.required_fte)} required)`
      : `the ${need} FTE ${scope} needs`;
  return {
    reason: `No mix of available people adds up to ${fit} in whole days per week.`,
    hint: "Add candidates, or reduce the required FTE.",
  };
}

/** Explains, in terms of the project's own setup, why the optimizer found no feasible team. */
export function InfeasibilityReport({ detail }: { detail: InfeasibilityDetail }) {
  return (
    <div
      role="alert"
      style={{
        marginTop: "0.75rem",
        padding: "0.75rem",
        borderRadius: 6,
        background: colors.dangerBg,
        color: colors.text,
        fontSize: "0.85rem",
      }}
    >
      <strong style={{ color: colors.danger }}>No feasible team for these constraints</strong>
      {detail.conflicts.length === 0 ? (
        <p style={{ margin: "0.4rem 0 0" }}>{detail.message}</p>
      ) : (
        <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
          {detail.conflicts.map((conflict, i) => {
            const { reason, hint } = explain(conflict);
            return (
              <li key={i} style={{ marginBottom: "0.4rem" }}>
                {reason}
                <div style={{ color: colors.muted, fontSize: "0.8rem" }}>{hint}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
