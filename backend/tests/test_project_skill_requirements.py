import json

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.models.project import Project
from api.repositories.file_repository import FileRepository
from api.v1 import projects as projects_module
from tests.conftest import ONE_FTE_NEED, PHASE_DATES, one_phase


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(projects_module, "repo", FileRepository("projects", Project))
    return TestClient(app)


PYTHON = {"id": "python", "min_level": 3, "fte": 1.6}
REACT = {"id": "react", "min_level": 2, "fte": 0.4}


def _create(client, headers, **fields):
    return client.post(
        "/api/v1/projects/", json={"name": "Apollo", **fields}, headers=headers
    )


def _error_message(response) -> str:
    return response.json()["detail"][0]["msg"]


def test_skill_needs_round_trip_with_default_max_people(client, org_headers):
    response = _create(
        client, org_headers, phases=one_phase([PYTHON, {**REACT, "max_people": 2}])
    )

    assert response.status_code == 201
    project = response.json()
    assert "n_slots" not in project
    assert [
        (r["id"], r["fte"], r["max_people"])
        for r in project["phases"][0]["skill_requirements"]
    ] == [("python", 1.6, 2), ("react", 0.4, 2)]


def test_n_slots_is_ignored(client, org_headers):
    response = _create(client, org_headers, n_slots=3, phases=one_phase())

    assert response.status_code == 201
    assert "n_slots" not in response.json()


def test_top_level_skill_requirements_and_date_ranges_are_ignored(client, org_headers):
    response = _create(
        client,
        org_headers,
        skill_requirements=[PYTHON],
        date_ranges=[{"start": "2026-01-05", "end": "2026-01-30"}],
        phases=one_phase(),
    )

    assert response.status_code == 201
    project = response.json()
    assert "skill_requirements" not in project
    assert "date_ranges" not in project
    assert [phase["id"] for phase in project["phases"]] == ["main"]


@pytest.mark.parametrize(
    "fields",
    [{}, {"phases": []}, {"skill_requirements": [PYTHON]}],
    ids=["no-phases", "empty-phases", "top-level-skills-only"],
)
def test_project_without_phase_is_rejected(client, org_headers, fields):
    response = _create(client, org_headers, **fields)

    assert response.status_code == 422


def test_empty_phase_list_is_rejected_with_a_clear_message(client, org_headers):
    response = _create(client, org_headers, phases=[])

    assert response.status_code == 422
    assert "A project needs at least one phase" in _error_message(response)


def test_duplicate_phase_id_is_rejected(client, org_headers):
    response = _create(
        client,
        org_headers,
        phases=[
            {"id": "build", "skill_requirements": [PYTHON]},
            {"id": "build", "skill_requirements": [REACT]},
        ],
    )

    assert response.status_code == 422
    assert "Phase id 'build' is used more than once" in _error_message(response)


def test_phase_without_skill_requirement_is_rejected(client, org_headers):
    response = _create(
        client,
        org_headers,
        phases=[
            {"id": "design", "skill_requirements": [REACT]},
            {"id": "build", "skill_requirements": []},
        ],
    )

    assert response.status_code == 422
    assert "Phase 'build' needs at least one skill requirement" in _error_message(
        response
    )


def test_duplicate_skill_in_phase_is_rejected(client, org_headers):
    response = _create(
        client,
        org_headers,
        phases=[{"id": "build", "skill_requirements": [REACT, REACT]}],
    )

    assert response.status_code == 422
    assert "Phase 'build' requires skill 'react' more than once" in _error_message(
        response
    )


def test_same_skill_in_different_phases_is_allowed(client, org_headers):
    response = _create(
        client,
        org_headers,
        phases=[
            {"id": "design", "skill_requirements": [REACT], "date_range": PHASE_DATES},
            {"id": "build", "skill_requirements": [REACT], "date_range": PHASE_DATES},
        ],
    )

    assert response.status_code == 201


@pytest.mark.parametrize(
    ("requirement", "message"),
    [
        ({**PYTHON, "fte": 0.5}, "fte must be a multiple of 0.2"),
        ({**PYTHON, "fte": 0}, "greater than or equal to 0.2"),
        ({**PYTHON, "max_people": 1}, "max_people must be between 2 and 8"),
        ({**PYTHON, "max_people": 9}, "max_people must be between 2 and 8"),
        ({"id": "python", "min_level": 3}, "Field required"),
    ],
    ids=["off-grid", "zero", "too-few-people", "too-many-people", "missing-fte"],
)
def test_invalid_skill_need_is_rejected(client, org_headers, requirement, message):
    response = _create(client, org_headers, phases=one_phase([requirement]))

    assert response.status_code == 422
    assert message in _error_message(response)


def test_update_without_skill_requirement_is_rejected(client, org_headers):
    project = _create(client, org_headers, phases=one_phase([PYTHON])).json()

    response = client.put(
        f"/api/v1/projects/{project['id']}",
        json={"name": "Apollo", "phases": [{"id": "main", "skill_requirements": []}]},
        headers=org_headers,
    )

    assert response.status_code == 422
    stored = client.get(f"/api/v1/projects/{project['id']}", headers=org_headers)
    assert stored.json()["phases"][0]["skill_requirements"][0]["id"] == "python"


def test_legacy_stored_project_loads_as_one_phase_per_date_range(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    need = {**ONE_FTE_NEED, "description": "", "max_people": 1}
    january = {"start": "2026-01-05", "end": "2026-01-30"}
    march = {"start": "2026-03-02", "end": "2026-03-27"}
    may = {"start": "2026-05-04", "end": "2026-05-29"}
    legacy = json.dumps(
        [
            {
                "id": "dated",
                "organization_id": "org",
                "name": "Dated",
                "skill_requirements": [need],
                "date_ranges": [january, march, may],
                "phases": [],
            },
            {
                "id": "undated",
                "organization_id": "org",
                "name": "Undated",
                "skill_requirements": [need],
                "date_ranges": [],
                "phases": [],
            },
            {
                "id": "phased",
                "organization_id": "org",
                "name": "Phased",
                "skill_requirements": [],
                "date_ranges": [january],
                "phases": [{"id": "build", "skill_requirements": [need]}],
            },
        ]
    )
    (tmp_path / "projects.json").write_text(legacy)

    projects = {p.id: p for p in FileRepository("projects", Project).list("org")}

    assert [
        (
            phase.id,
            phase.date_range.model_dump(mode="json") if phase.date_range else None,
        )
        for phase in projects["dated"].phases
    ] == [("main", january), ("main-2", march), ("main-3", may)]
    assert all(
        phase.skill_requirements[0].id == "general"
        for phase in projects["dated"].phases
    )
    assert [(p.id, p.date_range) for p in projects["undated"].phases] == [
        ("main", None)
    ]
    assert [p.id for p in projects["phased"].phases] == ["build"]
    saved = projects["dated"].model_dump(exclude={"id", "organization_id"})
    assert "skill_requirements" not in saved
    assert "date_ranges" not in saved
