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


UNDATED_PHASES = [
    {"id": "design", "skill_requirements": [ONE_FTE_NEED], "date_range": PHASE_DATES},
    {"id": "build", "skill_requirements": [ONE_FTE_NEED]},
]
BACKWARDS = {"start": "2026-01-30", "end": "2026-01-05"}


def _create(client, headers, phases):
    return client.post(
        "/api/v1/projects/",
        json={"name": "Apollo", "phases": phases},
        headers=headers,
    )


def _error_message(response) -> str:
    return response.json()["detail"][0]["msg"]


def test_create_with_an_undated_phase_is_rejected(client, org_headers):
    response = _create(client, org_headers, UNDATED_PHASES)

    assert response.status_code == 422
    assert "Phase 'build' needs a date range" in _error_message(response)


def test_update_with_an_undated_phase_is_rejected(client, org_headers):
    project = _create(client, org_headers, one_phase()).json()

    response = client.put(
        f"/api/v1/projects/{project['id']}",
        json={"name": "Apollo", "phases": UNDATED_PHASES},
        headers=org_headers,
    )

    assert response.status_code == 422
    assert "Phase 'build' needs a date range" in _error_message(response)
    stored = client.get(f"/api/v1/projects/{project['id']}", headers=org_headers)
    assert [p["date_range"] for p in stored.json()["phases"]] == [PHASE_DATES]


def test_create_with_a_range_ending_before_it_starts_is_rejected(client, org_headers):
    response = _create(client, org_headers, one_phase(date_range=BACKWARDS))

    assert response.status_code == 422
    assert "End date must not be before start date" in _error_message(response)


def test_update_with_a_range_ending_before_it_starts_is_rejected(client, org_headers):
    project = _create(client, org_headers, one_phase()).json()

    response = client.put(
        f"/api/v1/projects/{project['id']}",
        json={"name": "Apollo", "phases": one_phase(date_range=BACKWARDS)},
        headers=org_headers,
    )

    assert response.status_code == 422
    assert "End date must not be before start date" in _error_message(response)


def test_one_day_range_is_accepted(client, org_headers):
    one_day = {"start": "2026-01-05", "end": "2026-01-05"}

    response = _create(client, org_headers, one_phase(date_range=one_day))

    assert response.status_code == 201
    assert response.json()["phases"][0]["date_range"] == one_day


def test_stored_undated_project_still_loads(client, org_headers, tmp_path):
    project = _create(client, org_headers, one_phase()).json()
    projects_file = tmp_path / "projects.json"
    stored = json.loads(projects_file.read_text())
    stored[0]["phases"][0]["date_range"] = None
    projects_file.write_text(json.dumps(stored))

    response = client.get(f"/api/v1/projects/{project['id']}", headers=org_headers)

    assert response.status_code == 200
    assert response.json()["phases"][0]["date_range"] is None
