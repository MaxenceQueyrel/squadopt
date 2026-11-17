from enum import StrEnum

from pydantic import BaseModel, Field


class InfeasibilityReason(StrEnum):
    """Why a phase admits no feasible team.

    Attributes:
        FTE_NOT_REACHABLE: The phase can't be staffed to its need. The need is sized to
            what the pool can staff on the allocation grid, so this is not expected to occur.
    """

    FTE_NOT_REACHABLE = "fte_not_reachable"


class PhaseConflict(BaseModel):
    phase_id: str = Field(description="Identifier of the phase.")
    reason: InfeasibilityReason = Field(description="Which constraints make the phase unsolvable.")
    required_fte: float = Field(description="FTE the phase asks to staff, i.e. the sum of its skill requirements' fte.")
    need_fte: float = Field(
        description="FTE the solver had to staff: each skill's fte capped by what its qualified people can supply."
    )
