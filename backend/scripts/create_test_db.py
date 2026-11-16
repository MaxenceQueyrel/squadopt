"""Creates the database named in DATABASE_URL if it doesn't exist yet.

`make test-api` runs this before `alembic upgrade head` so the backend tests
get their own database (`team_manager_test`) on the same Postgres server as
the dev stack, instead of sharing (and wiping) the dev `team_manager` one.

Usage:
    DATABASE_URL=<url> uv run python scripts/create_test_db.py
"""

from sqlalchemy import create_engine, make_url, text

from api.core.config import get_configs


def main() -> None:
    url = make_url(get_configs().database_url)
    # CREATE DATABASE can't run inside a transaction, and needs a connection to
    # a database that already exists — `postgres` always does.
    server = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with server.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"),
            {"name": url.database},
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{url.database}"'))
            print(f"Created database {url.database}")
    server.dispose()


if __name__ == "__main__":
    main()
