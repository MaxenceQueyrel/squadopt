from datetime import date

import pytest
from optimizer.adapters.pulp_solver import PuLPTeamAssignmentSolver
from optimizer.domain.solver import InfeasibleAssignmentError
from optimizer.models import (
    AssignmentWeights,
    DateRange,
    InfeasibilityReason,
    PersonInput,
    PhaseConflict,
    PortfolioProject,
    ProjectInput,
    ProjectPhase,
    Seniority,
    SkillLevel,
    SkillRequirement,
)

PERF_ONLY = AssignmentWeights(performance=1.0, chemistry=0.0, growth=0.0, cost=0.0)
WEEK_1 = DateRange(start=date(2026, 1, 5), end=date(2026, 1, 11))
WEEK_3 = DateRange(start=date(2026, 1, 19), end=date(2026, 1, 25))


@pytest.fixture
def solver():
    return PuLPTeamAssignmentSolver()


def _person(person_id, python_level=4.0):
    return PersonInput(id=person_id, seniority=Seniority.SENIOR, skills=[SkillLevel(id="python", level=python_level)])


def _phase(phase_id="main", fte=1.0, date_range=None):
    return ProjectPhase(
        id=phase_id,
        skill_requirements=[SkillRequirement(id="python", min_level=0, fte=fte)],
        date_range=date_range,
    )


def _assigned(team):
    return {m.person_id for m in team.members}


def test_excluded_person_is_not_assigned_even_when_best(solver):
    project = ProjectInput(id="proj", phases=[_phase()], excluded_person_ids=["star"])
    result = solver.solve(project, [_person("star", 5.0), _person("dev", 2.0)], PERF_ONLY)
    assert _assigned(result) == {"dev"}
    assert result.fully_covered


def test_exclusion_applies_to_every_phase_and_alternative(solver):
    weights = AssignmentWeights(performance=1.0, chemistry=0.0, growth=0.0, cost=0.0, handover=1.0)
    project = ProjectInput(id="proj", phases=[_phase("build"), _phase("run")], excluded_person_ids=["star", "missing"])
    people = [_person("star", 5.0), _person("a", 3.0), _person("b", 2.0), _person("c", 1.0)]

    pool = solver.solve_pool(project, people, weights, n_alternatives=2, min_difference=1)

    assert len(pool) == 3
    assert all("star" not in _assigned(team) for team in pool)
    assert all(team.fully_covered for team in pool)


def test_excluded_people_do_not_count_as_available(solver):
    project = ProjectInput(id="proj", phases=[_phase(fte=2.0)], excluded_person_ids=["star"])
    result = solver.solve(project, [_person("star", 5.0), _person("dev", 2.0)], PERF_ONLY)
    (coverage,) = result.coverage
    assert (coverage.staffed_fte, coverage.available_fte, coverage.fte_met) == (1.0, 1.0, False)


def test_excluding_everyone_leaves_the_project_unstaffed(solver):
    project = ProjectInput(id="proj", phases=[_phase()], excluded_person_ids=["star", "dev"])
    result = solver.solve(project, [_person("star"), _person("dev")], PERF_ONLY)
    assert result.members == []
    assert not result.fully_covered


def test_start_window_scan_never_assigns_an_excluded_person(solver):
    project = ProjectInput(id="proj", phases=[_phase(date_range=WEEK_1)], excluded_person_ids=["star"])
    window = DateRange(start=WEEK_1.start, end=WEEK_3.start)

    scan = solver.solve_pool_over_starts(
        project, [_person("star", 5.0), _person("a", 3.0), _person("b", 2.0)], PERF_ONLY, window, min_difference=1
    )

    teams = [*scan.pool, *(c.team for c in scan.candidates if c.team)]
    assert len(scan.candidates) == 3
    assert all(_assigned(team) and "star" not in _assigned(team) for team in teams)


def test_portfolio_person_excluded_from_one_project_staffs_another(solver):
    projects = [
        PortfolioProject(id="a", phases=[_phase(date_range=WEEK_1)], excluded_person_ids=["star"]),
        PortfolioProject(id="b", phases=[_phase(date_range=WEEK_3)]),
    ]
    people = [_person("star", 5.0), _person("dev", 2.0)]

    result = solver.solve_portfolio(projects, people, PERF_ONLY)

    team_a, team_b = result.results
    assert _assigned(team_a) == {"dev"}
    assert "star" in _assigned(team_b)


def test_portfolio_project_excluding_its_only_candidate_stays_empty(solver):
    projects = [
        PortfolioProject(id="a", phases=[_phase()], excluded_person_ids=["star"]),
        PortfolioProject(id="b", phases=[_phase()]),
    ]

    result = solver.solve_portfolio(projects, [_person("star")], PERF_ONLY)

    team_a, team_b = result.results
    assert team_a.members == []
    assert _assigned(team_b) == {"star"}


def test_infeasibility_is_diagnosed_on_the_filtered_pool(solver, monkeypatch):
    # The need is what the pool can staff, so no real input is infeasible; asking one step
    # beyond it reaches the diagnosis, whose need must come from the non-excluded people.
    staffable_steps = PuLPTeamAssignmentSolver._staffable_steps
    monkeypatch.setattr(
        PuLPTeamAssignmentSolver,
        "_staffable_steps",
        lambda self, phase, candidates: staffable_steps(self, phase, candidates) + 1,
    )
    project = ProjectInput(id="proj", phases=[_phase(fte=2.0)], excluded_person_ids=["star"])

    with pytest.raises(InfeasibleAssignmentError) as exc_info:
        solver.solve(project, [_person("star"), _person("dev")], PERF_ONLY)

    assert exc_info.value.conflicts == [
        PhaseConflict(phase_id="main", reason=InfeasibilityReason.FTE_NOT_REACHABLE, required_fte=2.0, need_fte=1.2)
    ]
