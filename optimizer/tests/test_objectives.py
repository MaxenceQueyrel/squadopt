import pytest

from optimizer.models import AssignmentWeights, PersonInput, ProjectPhase, Seniority, SkillRequirement
from optimizer.objectives import compute_skill_scores

COST_ONLY = AssignmentWeights(performance=0.0, chemistry=0.0, growth=0.0, cost=1.0)


@pytest.mark.parametrize(
    ("seniority", "score"),
    [
        (Seniority.JUNIOR, 1.0),
        (Seniority.MID, 2 / 3),
        (Seniority.SENIOR, 1 / 3),
        (Seniority.LEAD, 0.0),
    ],
)
def test_cost_term_rewards_lower_seniority(seniority, score):
    phase = ProjectPhase(id="main", skill_requirements=[SkillRequirement(id="python", min_level=0, fte=1.0)])
    person = PersonInput(id="p1", seniority=seniority)

    scores = compute_skill_scores(phase, [person], COST_ONLY)

    assert scores["p1", "python"] == pytest.approx(score)
