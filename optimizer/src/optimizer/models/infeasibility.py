from enum import StrEnum

from pydantic import BaseModel, Field

from optimizer.models.date_range import DateRange


class InfeasibilityReason(StrEnum):
    """Why a phase admits no feasible team, judged by which relaxation would make it solvable.

    Attributes:
        FORCED_MEMBER_CONFLICT: Un-forcing the listed included members makes the phase solvable.
        FTE_NOT_REACHABLE: Un-forcing the included members doesn't make the phase solvable.
            The need is sized to what the pool can staff on the allocation grid, so this
            is not expected to occur.
        CROSS_PROJECT_FORCED_CONFLICT: In a portfolio solve, a person is forced into more
            overlapping scopes (phases, possibly of different projects) than their
            availability over the overlap has allocation steps, one step per scope
            being the least a selected member can take.
    """

    FORCED_MEMBER_CONFLICT = "forced_member_conflict"
    FTE_NOT_REACHABLE = "fte_not_reachable"
    CROSS_PROJECT_FORCED_CONFLICT = "cross_project_forced_conflict"


class PhaseConflict(BaseModel):
    phase_id: str | None = Field(description="Identifier of the phase, or None for a project without phases.")
    reason: InfeasibilityReason = Field(description="Which constraints make the phase unsolvable.")
    required_fte: float = Field(
        description="FTE the phase (or project) asks to staff, i.e. the sum of its skill requirements' fte."
    )
    need_fte: float = Field(
        description=(
            "FTE the solver had to staff (exactly in a single-project solve, at most in a portfolio solve): "
            "each skill's fte capped by what its qualified people can supply."
        )
    )
    forced_person_ids: list[str] = Field(
        default=[], description="Members of ProjectInput.included_person_ids involved in the conflict."
    )
    person_id: str | None = Field(
        default=None, description="For cross_project_forced_conflict, the person forced into the overlapping scopes."
    )
    project_ids: list[str] = Field(
        default=[],
        description="For cross_project_forced_conflict, every project with a scope the person is forced into.",
    )
    period: DateRange | None = Field(
        default=None,
        description=(
            "For cross_project_forced_conflict, the overlap the forced allocations don't fit in; "
            "None when only scopes without dates are involved."
        ),
    )
