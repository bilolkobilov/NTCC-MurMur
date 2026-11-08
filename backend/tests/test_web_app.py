"""FastAPI serves the built web app (frontend/dist) next to the API."""

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture
def web_client(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (dist / "assets" / "app-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("outside dist", encoding="utf-8")
    monkeypatch.setattr(get_settings(), "frontend_dist", dist)
    with TestClient(create_app()) as client:
        yield client


def test_root_and_client_routes_get_index_html(web_client):
    for path in ("/", "/doctor/exams/5", "/patient", "/login?next=/admin"):
        response = web_client.get(path)
        assert response.status_code == 200, path
        assert "<div id=root>" in response.text
        assert response.headers["cache-control"] == "no-cache"


def test_hashed_assets_are_cached_forever_other_files_not(web_client):
    asset = web_client.get("/assets/app-abc123.js")
    favicon = web_client.get("/favicon.svg")

    assert asset.text == "console.log(1)"
    assert "immutable" in asset.headers["cache-control"]
    assert favicon.headers["cache-control"] == "no-cache"


def test_api_is_never_shadowed(web_client):
    assert web_client.get("/api/health").json() == {"status": "ok", "database": "ok"}
    unknown = web_client.get("/api/does-not-exist")
    assert unknown.status_code == 404
    assert unknown.json() == {"detail": "Not Found"}
    assert web_client.get("/api").status_code == 404


def test_files_outside_dist_cannot_be_read(web_client):
    for path in ("/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt"):
        response = web_client.get(path)
        assert "outside dist" not in response.text, path


def test_without_a_build_only_the_api_exists(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "frontend_dist", tmp_path / "missing")
    with TestClient(create_app()) as client:
        assert client.get("/").status_code == 404
        assert client.get("/api/health").status_code == 200
