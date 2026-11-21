from pydantic import BaseModel, Field

from optimizer.models.date_range import DateRange
from optimizer.models.skill import SkillRequirement


class ProjectPhase(BaseModel):
    id: str = Field(description="Identifier of the phase (e.g. a project stage).")
    skill_requirements: list[SkillRequirement] = Field(
        default=[], description="Skill needs of this phase; the FTE to staff is the sum of their fte."
    )
    date_range: DateRange | None = Field(
        default=None, description="Calendar span of this phase. None means no date constraint."
    )


class ProjectInput(BaseModel):
    id: str = Field(description="Identifier of the project.")
    phases: list[ProjectPhase] = Field(
        min_length=1, description="Staffing needs of the project, one entry per stage, in schedule order."
    )
    excluded_person_ids: list[str] = Field(
        default=[],
        description="People who must never be staffed on any phase of this project, by person id.",
    )
