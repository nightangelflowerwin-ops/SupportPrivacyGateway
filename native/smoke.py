"""Exercise an already running loopback gateway using fictional values only."""

import json
import sys
import urllib.error
import urllib.request

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8766"


def request(path, data=None, headers=None, expected=200):
    body = None if data is None else json.dumps(data).encode()
    hdr = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(base + path, data=body, headers=hdr)
    try:
        with urllib.request.urlopen(req) as response:
            code, raw, response_headers = response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        code, raw, response_headers = error.code, error.read(), error.headers
    assert code == expected, (path, code, raw)
    assert "no-store" in response_headers.get("Cache-Control", "")
    return json.loads(raw)


assert request("/native/health")["forwarding"] is False
key = request("/native/session")["session"]
headers = {"X-Native-Session": key}
request("/native/redact", {"text": "amina@example.com"}, expected=403)
request("/native/session", headers={"Origin": "https://evil.example"}, expected=403)
request("/native/session", headers={"Host": "evil.example"}, expected=400)
text = "My name is Sarah Johnson. Email amina@example.com. Simu +254 712 345 678."
result = request("/native/redact", {"text": text, "action": "pseudonymize"}, headers)
assert "Sarah Johnson" not in result["redacted"] and "amina@example.com" not in result["redacted"]
restored = request(
    "/native/restore",
    {"text": result["redacted"], "conversation_id": result["conversation_id"]},
    headers,
)
assert restored["restored"] == text
request(
    "/native/restore",
    {"text": result["redacted"], "conversation_id": "f" * 32},
    headers,
    expected=409,
)
error = request(
    "/native/redact", {"text": "PRIVATE_CANARY_9482", "action": "invalid"}, headers, expected=400
)
assert "PRIVATE_CANARY" not in json.dumps(error)
request("/native/redact", {"text": "x" * 20001}, headers, expected=413)
print("Native HTTP smoke: boundary checks, scoped roundtrip, sanitized errors and limits passed.")
