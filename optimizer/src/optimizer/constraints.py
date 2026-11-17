from optimizer.availability import effective_availability
from optimizer.grid import floor_to_grid
from optimizer.models import PersonInput, ProjectPhase


def feasible_people(phase: ProjectPhase, people: list[PersonInput]) -> list[PersonInput]:
    """Returns the people eligible for the phase: available for at least one allocation step."""
    return [p for p in people if floor_to_grid(effective_availability(p, phase.date_range, p.assignments)) > 0]
