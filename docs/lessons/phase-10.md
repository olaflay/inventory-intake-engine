# Phase Lessons — Phase 10: Hardening

## Phase Summary
- **Phase Number & Name**: Phase 10: Hardening (PRD §52 row 10)
- **Completion Date**: 2026-10-01
- **Gate Status**: **GREEN — Security gate passed; failure drills passed; Company-B full scan passed**

**Scope delivered**:
- `ConfigManager` implementation with atomic snapshot retention on invalid reload and `config.invalid` event dispatch (PRD §45, §49.9, EC-53).
- Failure drills:
  * `tests/drills/config_corruption_drill.test.js`: Confirms invalid config leaves last-good snapshot active and emits `config.invalid`.
  * `tests/drills/storage_outage_drill.test.js`: Confirms attachment storage outages keep jobs in retry queues and route to DLQ with admin notices without data loss.
- Security test suite (`tests/security/owasp_api.test.js`): Comprehensive OWASP API Security Top 10 automated test coverage.
- Company-B full scan (`tests/portability/company_b_full_scan.test.js`): Automated AST/grep scan across all packages confirming zero hardcoded company names, locations, or statuses.
- Complete operational runbooks in `docs/runbook/`:
  * `disaster-recovery-restore.md`
  * `ops-workbook-admin.md`
  * `dead-letter-drain.md`
  * `recalculation-export.md`
- Signed security audit report: `docs/security_audit_report.md`.

---

## 1. What Surprised Us

**Per-chat vs. global throttling in Telegram queue.** When designing rate-limiting tests, throttling that operates per chat ID will process separate chats concurrently. Testing that the delivery delay holds requires checking messages destined for the same chat queue. This reinforces that Telegram's platform limits (1 msg/sec per chat vs 30 msg/sec global) must be modeled with per-chat granularity to avoid starving other users when one chat has high volume.

**Dynamic ephemeral port allocation in test servers prevents test suite flakiness.** Hardcoding test ports (e.g. 48991 or 9811) creates port exhaustion and `EADDRINUSE` errors if a previous test worker terminates abruptly before garbage-collecting the socket. Using `port: 0` allows the OS kernel to assign an available ephemeral port on the fly, eliminating port collisions in concurrent test runners.

---

## 2. What We Would Change

**Automate AST literal scanning as part of git pre-commit.** The Company-B zero domain literals rule (LD-5) was verified via test suite execution, but running this check during local pre-commit hooks catches accidental literal leaks before they ever enter git history.

---

## 3. New Edge Cases Discovered

| ID | Edge case | Control |
|---|---|---|
| EC-60 | Corrupt Ops Workbook uploaded during live operations | `ConfigManager` catches validation error, keeps previous `config_snapshot` active, emits `config.invalid` |
| EC-61 | Object storage download failure during ingestion | Queued job retries; if threshold exceeded, moves to DLQ and emits `job.dead_lettered` alert |
| EC-62 | Malicious SSRF URLs inside uploaded documents | `EvidenceValidator` treats URLs strictly as verbatim strings; engine makes zero outbound network calls |
| EC-63 | Stack trace leakage on malformed input | API server catches parsing errors and returns uniform `{ error: { code, message } }` envelope |

---

## 4. Runbook Updates
Created `docs/runbook/` with four complete operational procedures:
- `docs/runbook/disaster-recovery-restore.md`
- `docs/runbook/ops-workbook-admin.md`
- `docs/runbook/dead-letter-drain.md`
- `docs/runbook/recalculation-export.md`

---

## Open Items Carried Forward to Phase 11
1. **Phase 11 Shadow Pilot Execution:** Deploy container into shadow mode alongside manual Excel workflow for two weeks.
2. **Founder Sign-off on Pilot Plan:** Confirm worker list and Telegram BotFather token.
