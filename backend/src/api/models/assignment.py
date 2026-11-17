from datetime import date
from typing import Any, Self

from pydantic import BaseModel, Field, field_validator, model_validator
from optimizer.grid import ALLOCATION_STEP, GRID_TOLERANCE, STEPS_PER_FTE, is_on_grid

from api.models.project import DEFAULT_PHASE_ID


class AssignmentBase(BaseModel):
    person_id: str
    project_id: str
    ratio: float = Field(
        le=1,
        description="Fraction of FTE committed to the project, a multiple of 0.2 (one day per week).",
    )
    start: date
    end: date
    phase_id: str

    @field_validator("ratio")
    @classmethod
    def _check_ratio_on_grid(cls, ratio: float) -> float:
        if ratio < ALLOCATION_STEP - GRID_TOLERANCE or not is_on_grid(ratio):
            raise ValueError(
                "Allocation must be a multiple of 20% (one day per week), from 20% to 100%"
            )
        return round(ratio * STEPS_PER_FTE) / STEPS_PER_FTE


class Assignment(AssignmentBase):
    id: str
    organization_id: str

    # Assignments stored before phases became the only staffing scope have no
    # phase_id; their project migrates to phases whose first id is "main".
    @model_validator(mode="before")
    @classmethod
    def _migrate_unphased(cls, data: dict[str, Any]) -> dict[str, Any]:
        if data.get("phase_id") is not None:
            return data
        return {**data, "phase_id": DEFAULT_PHASE_ID}


# Only new payloads are checked, so reversed rows stored before this rule still
# load and can be listed and deleted.
class AssignmentCreate(AssignmentBase):
    @model_validator(mode="after")
    def _check_order(self) -> Self:
        if self.end < self.start:
            raise ValueError("End date must not be before start date")
        return self
