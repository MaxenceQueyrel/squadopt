import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.models.project import Project
from api.repositories.file_repository import FileRepository
from api.v1 import projects as projects_module
from tests.conftest import one_phase


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(projects_module, "repo", FileRepository("projects", Project))
    return TestClient(app)


JANUARY = {"start": "2026-01-05", "end": "2026-01-30"}
WINDOW = {"start": "2026-01-05", "end": "2026-02-23"}


def _create(client, headers, **fields):
    return client.post(
        "/api/v1/projects/",
        json={"name": "Apollo", "phases": one_phase(), **fields},
        headers=headers,
    )


def _error_message(response) -> str:
    return response.json()["detail"][0]["msg"]


def test_valid_window_round_trips(client, org_headers):
    response = _create(
        client, org_headers, phases=one_phase(date_range=JANUARY), start_window=WINDOW
    )

    assert response.status_code == 201
    project_id = response.json()["id"]
    fetched = client.get(f"/api/v1/projects/{project_id}", headers=org_headers)
    assert fetched.json()["start_window"] == WINDOW


def test_window_defaults_to_none(client, org_headers):
    response = _create(client, org_headers)

    assert response.status_code == 201
    assert response.json()["start_window"] is None


def test_window_ending_before_it_starts_is_rejected(client, org_headers):
    response = _create(
        client,
        org_headers,
        phases=one_phase(date_range=JANUARY),
        start_window={"start": "2026-02-01", "end": "2026-01-31"},
    )

    assert response.status_code == 422
    assert "End date must not be before start date" in _error_message(response)


@pytest.mark.parametrize(
    ("end", "status"),
    [("2026-12-30", 201), ("2026-12-31", 422)],
    ids=["52-candidates", "53-candidates"],
)
def test_window_is_capped_at_52_weekly_candidates(client, org_headers, end, status):
    # 2026-01-01 + 52 weeks is 2026-12-31, which would be the 53rd candidate.
    response = _create(
        client,
        org_headers,
        phases=one_phase(date_range=JANUARY),
        start_window={"start": "2026-01-01", "end": end},
    )

    assert response.status_code == status
    if status == 422:
        assert "at most 52 weekly starts" in _error_message(response)


def test_update_validates_the_window(client, org_headers):
    project = _create(client, org_headers, phases=one_phase(date_range=JANUARY)).json()

    response = client.put(
        f"/api/v1/projects/{project['id']}",
        json={
            "name": "Apollo",
            "phases": one_phase(),
            "start_window": {"start": "2026-02-01", "end": "2026-01-31"},
        },
        headers=org_headers,
    )

    assert response.status_code == 422
    stored = client.get(f"/api/v1/projects/{project['id']}", headers=org_headers)
    assert stored.json()["phases"][0]["date_range"] == JANUARY


def test_update_can_set_and_clear_the_window(client, org_headers):
    project = _create(client, org_headers, phases=one_phase(date_range=JANUARY)).json()
    url = f"/api/v1/projects/{project['id']}"
    body = {"name": "Apollo", "phases": one_phase(date_range=JANUARY)}

    set_response = client.put(
        url, json={**body, "start_window": WINDOW}, headers=org_headers
    )
    cleared = client.put(url, json=body, headers=org_headers)

    assert set_response.json()["start_window"] == WINDOW
    assert cleared.json()["start_window"] is None
