from sqlalchemy import text


def test_health_reports_database_ok(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_tests_use_the_separate_test_database():
    from app.db import engine

    with engine.connect() as conn:
        assert conn.scalar(text("SELECT current_database()")) == "murmur_test"
