# Local verification

Validation runs on Windows with Python 3.12 and local Presidio / spaCy en_core_web_sm.

This file records this extension's checks. Upstream research under results/ belongs to Othocs.

## Verified on October 8, 2026

- Full suite: **148 passed, 12 skipped**. Skips require unavailable model dependencies/downloads. One upstream Starlette/httpx test-client deprecation warning.
- Ruff lint and format checks passed across 88 Python files.
- Brave dashboard: fictional name, email, phone, card and IP replaced; six tokens restored to the original ticket. One ordinary term (`IP`) was also over-redacted.
- Round-trip API tests inspect a mock OpenAI-compatible upstream and verify raw canary values do not reach outbound payloads, logs or error bodies.
- Tests verify no upstream call on detection failure, validators-only proxy mode or policies that retain detected personal information.
- Local session, cross-origin and Host checks verified. Remote detection is rejected by the local lab.

## Local detector fixture

Presidio with en_core_web_sm on the 20-document upstream fixture:

- PII-character leakage: **22.9%** (lower is better).
- Strict span F1: **0.207**.
- p95 latency: approximately **417 ms per 1,000 characters** on this machine.

This is detector-only evaluation, not the merged gateway. The fixture is tiny, and it is not evidence of production privacy. The measured leakage is a reason to evaluate stronger contextual detectors and representative support text before using real data. Raw aggregate metrics are in [docs/local-fixture.json](docs/local-fixture.json).

## Not verified

No M5 adapter training, GPU training run, paid external inference, cloud deployment, Docker runtime or production privacy/compliance claim. Upstream model results were not reproduced. The real proxy's transport was verified with a mock provider, not a live paid account.
