import os

import pytest

TEST_DATABASE = "team_manager_test"

# Must be set before api.db.session is imported: it builds the engine from
# DATABASE_URL at import time, and the default points at the dev database.
os.environ.setdefault(
    "DATABASE_URL",
    f"postgresql+psycopg://team_manager:team_manager@localhost:5432/{TEST_DATABASE}",
)

from fastapi.testclient import TestClient  # noqa: E402

from api.db.models import (  # noqa: E402
    Organization,
    OrganizationMember,
    RefreshToken,
    User,
    UserRole,
)
from api.db.session import SessionLocal, engine  # noqa: E402
from api.main import app  # noqa: E402

# _cleanup_users deletes every user and organization, so refuse to run against
# anything but the test database (e.g. a DATABASE_URL exported for the dev app).
# Checked at import rather than in a session hook: from the repo root this
# conftest is only loaded during collection, after pytest_sessionstart has run.
if engine.url.database != TEST_DATABASE:
    pytest.exit(
        f"Backend tests must run against the {TEST_DATABASE!r} database, "
        f"not {engine.url.database!r}. Run them with `make test-api`."
    )


@pytest.fixture
def client():
    # https base_url so Secure cookies (refresh token) round-trip in httpx's jar.
    return TestClient(app, base_url="https://testserver")


@pytest.fixture(autouse=True)
def _cleanup_users():
    yield
    db = SessionLocal()
    db.query(OrganizationMember).delete()
    db.query(Organization).delete()
    db.query(RefreshToken).delete()
    db.query(UserRole).delete()
    db.query(User).delete()
    db.commit()
    db.close()


def register_and_login(client, email, password="hunter2pass") -> dict[str, str]:
    """Registers a user (accounts are managers by default) and returns auth headers."""
    client.post("/api/v1/auth/register", json={"email": email, "password": password})
    response = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _strip_roles(email):
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).first()
        user.roles.clear()
        db.commit()


@pytest.fixture
def manager_headers(client):
    return register_and_login(client, "manager@example.com")


@pytest.fixture
def unprivileged_headers(client):
    """Headers for a logged-in account holding no roles, to exercise permission-denied paths."""
    email = "unprivileged@example.com"
    headers = register_and_login(client, email)
    _strip_roles(email)
    return headers


def create_org(client, headers, name="Acme Corp") -> str:
    """Creates an organization owned by `headers`'s user and returns its id."""
    response = client.post(
        "/api/v1/organizations/", json={"name": name}, headers=headers
    )
    assert response.status_code == 201
    return response.json()["id"]


@pytest.fixture
def org_headers(client, manager_headers):
    """Auth + X-Organization-Id headers for a manager who owns an organization.

    The org-scoped routers (people/roles/skills/projects/assignments/teams)
    require this header on every request.
    """
    organization_id = create_org(client, manager_headers)
    return {**manager_headers, "X-Organization-Id": organization_id}


# A skill need anyone can fill (a missing skill counts as level 0), for tests that
# need a valid project but don't exercise skills.
ONE_FTE_NEED = {"id": "general", "min_level": 0, "fte": 1}

# Every phase of a saved project needs dates; tests that don't exercise them use these.
PHASE_DATES = {"start": "2026-01-05", "end": "2026-01-30"}


def one_phase(
    skill_requirements: list[dict] | None = None, date_range: dict = PHASE_DATES
) -> list[dict]:
    """The `phases` of a one-shot project: a single `main` phase."""
    return [
        {
            "id": "main",
            "skill_requirements": [ONE_FTE_NEED]
            if skill_requirements is None
            else skill_requirements,
            "date_range": dict(date_range),
        }
    ]
