import os

import httpx
import pytest
from fastapi.testclient import TestClient

from pii_gateway.api import _env_detector, create_app
from pii_gateway.lab import create_lab
from pii_gateway.vault import Vault
from tests.test_proxy import NameStub


def test_lab_round_trip_no_external_calls():
    client = TestClient(create_lab(detector=NameStub(), use_env=False))
    session = client.get("/lab/session").json()["session"]
    text = "Priya: priya@example.com, card 4111 1111 1111 1111"
    result = client.post("/lab/run", json={"text": text}, headers={"X-Lab-Session": session})
    assert result.status_code == 200
    data = result.json()
    assert data["external_requests"] == 0 and data["tokens_restored"] == 3
    assert "Priya" not in data["redacted"] and "priya@example.com" not in data["redacted"]
    assert data["restored_reply"] == "Support draft received: " + text
    assert client.post("/lab/run", json={"text": text}).status_code == 403
    assert (
        client.post(
            "/lab/run",
            json={"text": text},
            headers={"X-Lab-Session": session, "Origin": "https://evil.example"},
        ).status_code
        == 403
    )
    assert client.get("/", headers={"Host": "evil.example"}).status_code == 400
    assert client.get("/").headers["cache-control"] == "no-store"
    assert client.get("/assets/app.js").status_code == 200


def test_proxy_rejects_unsafe_modes_without_outbound_call():
    calls = []
    upstream = httpx.Client(
        base_url="https://example.test/v1",
        transport=httpx.MockTransport(lambda request: calls.append(request) or httpx.Response(200)),
    )
    vault = Vault(os.urandom(32))
    validators = TestClient(create_app(vault=vault, use_env=False, upstream=upstream))
    body = {"messages": [{"role": "user", "content": "Priya"}]}
    assert validators.post("/proxy", json=body).status_code == 503
    contextual = TestClient(
        create_app(detector=NameStub(), vault=vault, use_env=False, upstream=upstream)
    )
    assert contextual.post("/proxy", json={**body, "policy": "analytics"}).status_code == 400
    assert calls == []


def test_unknown_detector_and_remote_require_explicit_configuration(monkeypatch):
    monkeypatch.setenv("PII_DETECTOR", "typo")
    with pytest.raises(ValueError):
        _env_detector()
    monkeypatch.setenv("PII_DETECTOR", "remote")
    monkeypatch.delenv("PII_ALLOW_REMOTE_DETECTOR", raising=False)
    with pytest.raises(ValueError, match="raw text"):
        _env_detector()
    monkeypatch.setenv("PII_ALLOW_REMOTE_DETECTOR", "1")
    with pytest.raises(ValueError, match="local lab"):
        create_lab()


def test_metadata_cannot_leak_into_logs_or_policy_errors(caplog):
    client = TestClient(create_app(use_env=False))
    canary = "secret.person@example.com"
    with caplog.at_level("INFO", logger="pii_gateway"):
        assert (
            client.post(
                "/redact", json={"text": "Hello", "tenant": canary, "conversation_id": canary}
            ).status_code
            == 200
        )
        response = client.post("/redact", json={"text": "Hello", "policy": canary})
    assert canary not in caplog.text and canary not in response.text
