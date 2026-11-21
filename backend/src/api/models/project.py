from datetime import date
from typing import Any, Self

from pydantic import BaseModel, model_validator
from optimizer.models import (
    DateRange,
    ProjectPhase,
    ProjectPriority,
)

MAX_START_CANDIDATES = 52
DEFAULT_PHASE_ID = "main"


def legacy_phases(
    skill_requirements: list[dict[str, Any]], date_ranges: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Converts a pre-phases project's top-level staffing needs into phases.

    Each date range becomes one phase with the same skill requirements, with
    ids `main`, `main-2`, `main-3`, ... in range order. A project without date
    ranges becomes a single undated `main` phase.

    Args:
        skill_requirements: The legacy top-level skill requirements, as JSON.
        date_ranges: The legacy top-level date ranges, as JSON.

    Returns:
        The phases, as JSON, ready for `ProjectPhase` validation.
    """
    if not date_ranges:
        return [
            {
                "id": DEFAULT_PHASE_ID,
                "skill_requirements": skill_requirements,
                "date_range": None,
            }
        ]
    return [
        {
            "id": DEFAULT_PHASE_ID if index == 1 else f"{DEFAULT_PHASE_ID}-{index}",
            "skill_requirements": skill_requirements,
            "date_range": date_range,
        }
        for index, date_range in enumerate(date_ranges, start=1)
    ]


class ProjectBase(BaseModel):
    name: str
    description: str = ""
    phases: list[ProjectPhase]
    priority: ProjectPriority = ProjectPriority.MEDIUM
    completed_at: date | None = None
    # Absolute earliest/latest allowed start; it bounds the start only, so the
    # project may end after start_window.end.
    start_window: DateRange | None = None
    # A person carrying any of these tags is kept off every phase of the project.
    excluded_tags: list[str] = []

    def excluding_tags(self, person_tags: list[str]) -> list[str]:
        return [tag for tag in self.excluded_tags if tag in person_tags]

    @model_validator(mode="after")
    def _check_phases(self) -> Self:
        if not self.phases:
            raise ValueError("A project needs at least one phase")
        phase_ids = [phase.id for phase in self.phases]
        for phase_id in phase_ids:
            if phase_ids.count(phase_id) > 1:
                raise ValueError(f"Phase id '{phase_id}' is used more than once")
        for phase in self.phases:
            if not phase.skill_requirements:
                raise ValueError(
                    f"Phase '{phase.id}' needs at least one skill requirement"
                )
            skill_ids = [req.id for req in phase.skill_requirements]
            for skill_id in skill_ids:
                if skill_ids.count(skill_id) > 1:
                    raise ValueError(
                        f"Phase '{phase.id}' requires skill '{skill_id}' more than once"
                    )
        return self

    @model_validator(mode="after")
    def _check_start_window(self) -> Self:
        window = self.start_window
        if window is None:
            return self
        if (window.end - window.start).days // 7 + 1 > MAX_START_CANDIDATES:
            raise ValueError(
                f"A flexible start window can span at most {MAX_START_CANDIDATES} weekly starts"
            )
        return self


class Project(ProjectBase):
    id: str
    organization_id: str

    # Projects stored before phases became the only staffing scope keep their
    # needs in top-level skill_requirements/date_ranges and have no phases.
    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_scope(cls, data: dict[str, Any]) -> dict[str, Any]:
        if data.get("phases") or "skill_requirements" not in data:
            return data
        return {
            **data,
            "phases": legacy_phases(
                data["skill_requirements"], data.get("date_ranges") or []
            ),
        }


class ProjectCreate(ProjectBase):
    # Only new payloads must be dated: a stored project without dates still loads,
    # and applying a team to it fails with a 400 instead.
    @model_validator(mode="after")
    def _check_phase_dates(self) -> Self:
        for phase in self.phases:
            if phase.date_range is None:
                raise ValueError(f"Phase '{phase.id}' needs a date range")
        return self
