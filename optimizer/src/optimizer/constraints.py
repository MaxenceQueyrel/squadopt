from optimizer.availability import effective_availability
from optimizer.grid import floor_to_grid
from optimizer.models import ProjectInput, PersonInput


def feasible_people(project: ProjectInput, people: list[PersonInput]) -> list[PersonInput]:
    """Returns the people eligible for the project: available for at least one allocation step."""
    return [p for p in people if floor_to_grid(effective_availability(p, project, p.assignments)) > 0]
