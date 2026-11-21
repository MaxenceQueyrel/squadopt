import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.models.assignment import Assignment
from api.models.person import Person
from api.models.project import Project
from api.models.role import Role as RoleCatalogEntry
from api.models.tag import Tag
from api.models.team import Team
from api.repositories.file_repository import FileRepository
from api.v1 import assignments as assignments_module
from api.v1 import people as people_module
from api.v1 import projects as projects_module
from api.v1 import roles as roles_module
from api.v1 import tags as tags_module
from api.v1 import teams as teams_module
from optimizer.models import Seniority
from tests.conftest import one_phase


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(people_module, "repo", FileRepository("people", Person))
    monkeypatch.setattr(projects_module, "repo", FileRepository("projects", Project))
    monkeypatch.setattr(teams_module, "repo", FileRepository("teams", Team))
    monkeypatch.setattr(roles_module, "repo", FileRepository("roles", RoleCatalogEntry))
    monkeypatch.setattr(tags_module, "repo", FileRepository("tags", Tag))
    monkeypatch.setattr(
        assignments_module, "repo", FileRepository("assignments", Assignment)
    )
    return TestClient(app)


@pytest.fixture
def headers(client, org_headers):
    client.post("/api/v1/roles/", json={"id": "Backend Developer"}, headers=org_headers)
    for tag_id in ("External", "Contractor"):
        client.post("/api/v1/tags/", json={"id": tag_id}, headers=org_headers)
    return org_headers


NOVEMBER = {"start": "2026-11-01", "end": "2026-11-30"}


def _project_payload(name="Atlas", **overrides):
    return {"name": name, "phases": one_phase(date_range=NOVEMBER), **overrides}


def _create_project(client, headers, name="Atlas", **overrides) -> str:
    response = client.post(
        "/api/v1/projects/", json=_project_payload(name, **overrides), headers=headers
    )
    assert response.status_code == 201
    return response.json()["id"]


def _create_person(client, headers, name, tags=()) -> str:
    response = client.post(
        "/api/v1/people/",
        json={
            "name": name,
            "role": "Backend Developer",
            "seniority": Seniority.SENIOR,
            "tags": list(tags),
        },
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()["id"]


def _assignment_payload(person_id, project_id, **overrides):
    return {
        "person_id": person_id,
        "project_id": project_id,
        "ratio": 1.0,
        "phase_id": "main",
        **NOVEMBER,
        **overrides,
    }


def _create_team(client, headers, project_id, person_ids) -> str:
    response = client.post(
        "/api/v1/teams/",
        json={
            "project_id": project_id,
            "members": [
                {"person_id": person_id, "fte_allocation": 1.0, "phase_id": "main"}
                for person_id in person_ids
            ],
            "optimization_score": 1.0,
            "optimization_max_score": 1.0,
        },
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()["id"]


def _list_assignments(client, headers):
    return client.get("/api/v1/assignments/", headers=headers).json()


def _member_ids(team):
    return [member["person_id"] for member in team["members"]]


# ── Project field ─────────────────────────────────────────────────────────────


def test_project_defaults_to_no_excluded_tags(client, headers):
    project_id = _create_project(client, headers)

    project = client.get(f"/api/v1/projects/{project_id}", headers=headers).json()

    assert project["excluded_tags"] == []


def test_project_can_be_created_and_updated_with_excluded_tags(client, headers):
    project_id = _create_project(client, headers, excluded_tags=["External"])

    response = client.put(
        f"/api/v1/projects/{project_id}",
        json=_project_payload(excluded_tags=["External", "Contractor"]),
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["excluded_tags"] == ["External", "Contractor"]


def test_create_project_rejects_unknown_excluded_tags(client, headers):
    response = client.post(
        "/api/v1/projects/",
        json=_project_payload(excluded_tags=["External", "Ghost", "Phantom"]),
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown tags: Ghost, Phantom"
    assert client.get("/api/v1/projects/", headers=headers).json() == []


def test_update_project_rejects_unknown_excluded_tags(client, headers):
    project_id = _create_project(client, headers)

    response = client.put(
        f"/api/v1/projects/{project_id}",
        json=_project_payload(excluded_tags=["Ghost"]),
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown tags: Ghost"
    project = client.get(f"/api/v1/projects/{project_id}", headers=headers).json()
    assert project["excluded_tags"] == []


def test_deleting_a_tag_removes_it_from_project_exclusions(client, headers):
    project_id = _create_project(
        client, headers, excluded_tags=["External", "Contractor"]
    )
    untouched_id = _create_project(client, headers, "Nova", excluded_tags=["External"])

    assert client.delete("/api/v1/tags/Contractor", headers=headers).status_code == 204

    project = client.get(f"/api/v1/projects/{project_id}", headers=headers).json()
    assert project["excluded_tags"] == ["External"]
    assert project["name"] == "Atlas"
    assert project["phases"][0]["date_range"] == NOVEMBER
    untouched = client.get(f"/api/v1/projects/{untouched_id}", headers=headers).json()
    assert untouched["excluded_tags"] == ["External"]


# ── Optimization ──────────────────────────────────────────────────────────────


def test_solve_never_proposes_an_excluded_person(client, headers):
    _create_person(client, headers, "Bob", tags=["External"])
    alice_id = _create_person(client, headers, "Alice")
    project_id = _create_project(client, headers, excluded_tags=["External"])

    response = client.post(
        "/api/v1/optimization/solve",
        json={"project_id": project_id, "n_alternatives": 3},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert _member_ids(body["best"]) == [alice_id]
    for alternative in body["alternatives"]:
        assert _member_ids(alternative) == [alice_id]


def test_solve_leaves_the_project_short_staffed_when_everyone_is_excluded(
    client, headers
):
    _create_person(client, headers, "Bob", tags=["Contractor"])
    project_id = _create_project(client, headers, excluded_tags=["Contractor"])

    response = client.post(
        "/api/v1/optimization/solve", json={"project_id": project_id}, headers=headers
    )

    assert response.status_code == 200
    assert response.json()["best"]["members"] == []
    assert response.json()["best"]["fully_covered"] is False


def test_solve_batch_excludes_a_person_only_from_the_excluding_project(client, headers):
    bob_id = _create_person(client, headers, "Bob", tags=["External"])
    alice_id = _create_person(client, headers, "Alice")
    critical = _create_project(
        client, headers, "Critical", priority="critical", excluded_tags=["External"]
    )
    low = _create_project(client, headers, "Low", priority="low")

    response = client.post(
        "/api/v1/optimization/solve-batch",
        json={"project_ids": [critical, low]},
        headers=headers,
    )

    assert response.status_code == 200
    critical_team, low_team = response.json()["teams"]
    assert _member_ids(critical_team) == [alice_id]
    assert _member_ids(low_team) == [bob_id]


# ── Assignment enforcement ────────────────────────────────────────────────────


def test_create_assignment_rejects_an_excluded_person(client, headers):
    bob_id = _create_person(client, headers, "Bob", tags=["External", "Contractor"])
    project_id = _create_project(
        client, headers, excluded_tags=["Contractor", "External"]
    )

    response = client.post(
        "/api/v1/assignments/",
        json=_assignment_payload(bob_id, project_id),
        headers=headers,
    )

    assert response.status_code == 400
    assert (
        response.json()["detail"]
        == "Bob is excluded from 'Atlas' by tag: Contractor, External"
    )
    assert _list_assignments(client, headers) == []


def test_create_assignment_accepts_a_person_without_an_excluded_tag(client, headers):
    alice_id = _create_person(client, headers, "Alice", tags=["Contractor"])
    project_id = _create_project(client, headers, excluded_tags=["External"])

    response = client.post(
        "/api/v1/assignments/",
        json=_assignment_payload(alice_id, project_id),
        headers=headers,
    )

    assert response.status_code == 201


def test_update_assignment_rejects_moving_it_to_an_excluding_project(client, headers):
    bob_id = _create_person(client, headers, "Bob", tags=["External"])
    open_project = _create_project(client, headers, "Open")
    excluding = _create_project(client, headers, excluded_tags=["External"])
    created = client.post(
        "/api/v1/assignments/",
        json=_assignment_payload(bob_id, open_project),
        headers=headers,
    ).json()

    response = client.put(
        f"/api/v1/assignments/{created['id']}",
        json=_assignment_payload(bob_id, excluding),
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Bob is excluded from 'Atlas' by tag: External"
    assert _list_assignments(client, headers)[0]["project_id"] == open_project


def test_assignments_made_before_the_exclusion_are_kept(client, headers):
    bob_id = _create_person(client, headers, "Bob", tags=["External"])
    project_id = _create_project(client, headers)
    created = client.post(
        "/api/v1/assignments/",
        json=_assignment_payload(bob_id, project_id),
        headers=headers,
    ).json()

    response = client.put(
        f"/api/v1/projects/{project_id}",
        json=_project_payload(excluded_tags=["External"]),
        headers=headers,
    )

    assert response.status_code == 200
    assert _list_assignments(client, headers) == [created]


# ── Team apply enforcement ────────────────────────────────────────────────────


def test_apply_team_rejects_an_excluded_member(client, headers):
    bob_id = _create_person(client, headers, "Bob", tags=["External"])
    alice_id = _create_person(client, headers, "Alice")
    project_id = _create_project(client, headers)
    team_id = _create_team(client, headers, project_id, [bob_id, alice_id])
    # The exclusion is added after the proposal was generated.
    client.put(
        f"/api/v1/projects/{project_id}",
        json=_project_payload(excluded_tags=["External"]),
        headers=headers,
    )

    response = client.post(f"/api/v1/teams/{team_id}/apply", headers=headers)

    assert response.status_code == 400
    assert response.json()["detail"] == "Excluded from 'Atlas' by tag: Bob (External)"
    assert _list_assignments(client, headers) == []


def test_apply_batch_rejects_a_team_with_an_excluded_member(client, headers):
    bob_id = _create_person(client, headers, "Bob", tags=["Contractor"])
    alice_id = _create_person(client, headers, "Alice")
    allowed = _create_project(client, headers, "Nova")
    excluding = _create_project(client, headers, excluded_tags=["Contractor"])
    team_ids = [
        _create_team(client, headers, allowed, [alice_id]),
        _create_team(client, headers, excluding, [bob_id]),
    ]

    response = client.post(
        "/api/v1/teams/apply-batch", json={"team_ids": team_ids}, headers=headers
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Excluded from 'Atlas' by tag: Bob (Contractor)"
    assert _list_assignments(client, headers) == []
