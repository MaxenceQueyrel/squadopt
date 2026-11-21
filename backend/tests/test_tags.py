import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.models.person import Person
from api.models.role import Role as RoleCatalogEntry
from api.models.tag import Tag
from api.repositories.file_repository import FileRepository
from api.v1 import people as people_module
from api.v1 import roles as roles_module
from api.v1 import tags as tags_module
from optimizer.models import Seniority
from tests.conftest import create_org


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(people_module, "repo", FileRepository("people", Person))
    monkeypatch.setattr(roles_module, "repo", FileRepository("roles", RoleCatalogEntry))
    monkeypatch.setattr(tags_module, "repo", FileRepository("tags", Tag))
    return TestClient(app)


@pytest.fixture
def headers(client, org_headers):
    client.post("/api/v1/roles/", json={"id": "Backend Developer"}, headers=org_headers)
    return org_headers


def _create_tag(client, headers, tag_id, description=""):
    response = client.post(
        "/api/v1/tags/",
        json={"id": tag_id, "description": description},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


def _person_payload(**overrides):
    return {
        "name": "Alice Martin",
        "role": "Backend Developer",
        "seniority": Seniority.SENIOR,
        **overrides,
    }


def _create_person(client, headers, **overrides):
    response = client.post(
        "/api/v1/people/", json=_person_payload(**overrides), headers=headers
    )
    assert response.status_code == 201
    return response.json()


# ── Tag CRUD ──────────────────────────────────────────────────────────────────


def test_create_and_get_tag(client, headers):
    created = _create_tag(client, headers, "External", "Not on payroll")

    assert created["id"] == "External"
    assert created["description"] == "Not on payroll"
    fetched = client.get("/api/v1/tags/External", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json() == created


def test_list_tags(client, headers):
    _create_tag(client, headers, "External")
    _create_tag(client, headers, "Contractor")

    response = client.get("/api/v1/tags/", headers=headers)

    assert response.status_code == 200
    assert {tag["id"] for tag in response.json()} == {"External", "Contractor"}


def test_create_duplicate_tag_returns_409(client, headers):
    _create_tag(client, headers, "External")

    response = client.post("/api/v1/tags/", json={"id": "External"}, headers=headers)

    assert response.status_code == 409


def test_create_tag_with_blank_id_returns_400(client, headers):
    response = client.post("/api/v1/tags/", json={"id": "  "}, headers=headers)

    assert response.status_code == 400


def test_update_tag_description(client, headers):
    _create_tag(client, headers, "External")

    response = client.put(
        "/api/v1/tags/External",
        json={"id": "External", "description": "Outside the company"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["description"] == "Outside the company"


def test_get_update_delete_unknown_tag_return_404(client, headers):
    assert client.get("/api/v1/tags/ghost", headers=headers).status_code == 404
    assert (
        client.put(
            "/api/v1/tags/ghost", json={"id": "ghost"}, headers=headers
        ).status_code
        == 404
    )
    assert client.delete("/api/v1/tags/ghost", headers=headers).status_code == 404


def test_tags_are_scoped_to_the_organization(client, headers):
    other_headers = {
        **headers,
        "X-Organization-Id": create_org(client, headers, name="Other Org"),
    }
    _create_tag(client, headers, "External")

    assert client.get("/api/v1/tags/", headers=other_headers).json() == []
    assert client.get("/api/v1/tags/External", headers=other_headers).status_code == 404
    _create_tag(client, other_headers, "External")


def test_tags_require_organization_membership(client, headers, unprivileged_headers):
    outsider_headers = {
        **unprivileged_headers,
        "X-Organization-Id": headers["X-Organization-Id"],
    }

    assert client.get("/api/v1/tags/", headers=outsider_headers).status_code == 403


# ── Person tags ───────────────────────────────────────────────────────────────


def test_person_with_known_tags_is_stored_and_returned(client, headers):
    _create_tag(client, headers, "External")

    person = _create_person(client, headers, tags=["External"])

    assert person["tags"] == ["External"]
    fetched = client.get(f"/api/v1/people/{person['id']}", headers=headers).json()
    assert fetched["tags"] == ["External"]


def test_person_tags_default_to_empty(client, headers):
    assert _create_person(client, headers)["tags"] == []


def test_create_person_with_unknown_tag_returns_400(client, headers):
    response = client.post(
        "/api/v1/people/", json=_person_payload(tags=["Ghost"]), headers=headers
    )

    assert response.status_code == 400
    assert "Ghost" in response.json()["detail"]
    assert client.get("/api/v1/people/", headers=headers).json() == []


def test_update_person_with_unknown_tag_returns_400(client, headers):
    person = _create_person(client, headers)

    response = client.put(
        f"/api/v1/people/{person['id']}",
        json=_person_payload(tags=["Ghost"]),
        headers=headers,
    )

    assert response.status_code == 400
    fetched = client.get(f"/api/v1/people/{person['id']}", headers=headers).json()
    assert fetched["tags"] == []


def test_person_cannot_use_a_tag_from_another_organization(client, headers):
    other_headers = {
        **headers,
        "X-Organization-Id": create_org(client, headers, name="Other Org"),
    }
    _create_tag(client, other_headers, "External")

    response = client.post(
        "/api/v1/people/", json=_person_payload(tags=["External"]), headers=headers
    )

    assert response.status_code == 400


# ── Cascade delete ────────────────────────────────────────────────────────────


def test_deleting_a_tag_removes_it_from_every_person_in_the_org(client, headers):
    _create_tag(client, headers, "External")
    _create_tag(client, headers, "Contractor")
    alice = _create_person(client, headers, tags=["External", "Contractor"])
    bob = _create_person(client, headers, name="Bob", tags=["External"])
    carol = _create_person(client, headers, name="Carol", tags=["Contractor"])

    response = client.delete("/api/v1/tags/External", headers=headers)

    assert response.status_code == 204
    assert client.get("/api/v1/tags/External", headers=headers).status_code == 404

    def tags_of(person):
        return client.get(f"/api/v1/people/{person['id']}", headers=headers).json()[
            "tags"
        ]

    assert tags_of(alice) == ["Contractor"]
    assert tags_of(bob) == []
    assert tags_of(carol) == ["Contractor"]
    fetched_bob = client.get(f"/api/v1/people/{bob['id']}", headers=headers).json()
    assert fetched_bob["name"] == "Bob"
    assert fetched_bob["seniority"] == "senior"


def test_deleting_a_tag_leaves_other_organizations_untouched(client, headers):
    other_headers = {
        **headers,
        "X-Organization-Id": create_org(client, headers, name="Other Org"),
    }
    client.post(
        "/api/v1/roles/", json={"id": "Backend Developer"}, headers=other_headers
    )
    _create_tag(client, headers, "External")
    _create_tag(client, other_headers, "External")
    other_person = _create_person(client, other_headers, tags=["External"])

    client.delete("/api/v1/tags/External", headers=headers)

    fetched = client.get(
        f"/api/v1/people/{other_person['id']}", headers=other_headers
    ).json()
    assert fetched["tags"] == ["External"]
    assert client.get("/api/v1/tags/External", headers=other_headers).status_code == 200
