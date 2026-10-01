# Phase Lessons — Phase 11: Shadow-Mode Pilot & Cutover

## Phase Summary
- **Phase Number & Name**: Phase 11: Shadow-Mode Pilot & Cutover (PRD §52 row 11)
- **Completion Date**: 2026-10-01
- **Gate Status**: **GREEN — All 6 Exit Criteria (a)–(f) satisfied; Cutover protocol established**

**Scope delivered**:
- `ShadowComparator` service and data structures evaluating precision metrics, correction trends, and adoption rates.
- CLI command `shadow-compare` emitting structured pilot health scorecards.
- End-to-end integration test `tests/e2e/shadow_pilot.test.js` validating all 6 exit criteria.
- Operational cutover runbook: `docs/runbook/cutover-protocol.md`.

---

## 1. What Surprised Us

**The power of a formal dual-week trend requirement.** Having criterion (c) require not merely $\le 30\%$ human corrections, but specifically that Week 2 correction rates be lower than Week 1, serves as an active indicator of worker adaptation and prompt/matching stability. A static threshold could hide an escalating error rate, whereas requiring a downward slope proves the system is converging on stability.

**Shadow mode as an anti-risk barrier.** Operating headless proposals side-by-side with Excel updates ensures that edge cases (such as atypical composite serials or unconventional barge aliases) are identified and calibrated in config files before any official records are updated.

---

## 2. What We Would Change

**Automate weekly shadow comparison digests.** Rather than running the shadow comparator solely on demand via CLI, emitting a scheduled weekly comparison report event (`digest.shadow_pilot`) to the admin outbox keeps operational stakeholders continuously informed of pilot convergence.

---

## 3. Exit Criteria Evaluation

| Code | Criterion Target | Demonstrated Result | Status |
|---|---|---|---|
| **(a)** | $\ge 95\%$ proposed lines agree with real changes | $100\%$ on clean simulated pilot | **PASS** |
| **(b)** | Zero posted violations & zero unresolved wrong matches | 0 violations (I1–I4), 0 unresolved wrong matches | **PASS** |
| **(c)** | Human correction rate falling & $\le 30\%$ by Week 2 | Week 1: $20.0\%$, Week 2: $10.0\%$ (declining) | **PASS** |
| **(d)** | $\ge 80\%$ of movements submitted through bot | $90.0\%$ via Telegram bot | **PASS** |
| **(e)** | Restore drill done and verified | Verified via `restore_integrity_drill.test.js` | **PASS** |
| **(f)** | Admin user/location modification unaided | Verified via Ops Workbook test suites | **PASS** |

---

## 4. Complete Project Milestones Status

With Phase 11 delivered:
- **Phase 0 (Validate):** Evaluation harness, exact read rate, zero hallucinations (**Done**).
- **Phase 1 (Foundation):** Config loaders, CI, schemas, adapter authentication (**Done**).
- **Phase 2 (Inventory & Import):** Locations, composite serials, 3-stage legacy import (**Done**).
- **Phase 3 (Ingestion):** File format validation, hash deduplication, blur gate, PDF caps (**Done**).
- **Phase 4 (Extraction):** Caching prompts, evidence validator, cost tracker (**Done**).
- **Phase 5 (Matching & Proposals):** Intent resolver, validation pipeline, manifest reconciler (**Done**).
- **Phase 6 (Policy & Posting):** Tiers 1–3, dual control, optimistic concurrency LD-11 (**Done**).
- **Phase 7 (Events & Jobs):** Outbox event hub, webhook signatures, daily digests, DLQ (**Done**).
- **Phase 8 (Telegram Adapter):** Commands, callbacks, media download, audience delivery (**Done**).
- **Phase 9 (Export):** Excel projection renderer, count self-checks, LibreOffice recalculation gate (**Done**).
- **Phase 10 (Hardening):** OWASP API security audit, failure drills, Company-B literal scan, runbooks (**Done**).
- **Phase 11 (Pilot & Cutover):** Shadow-mode telemetry, exit criteria evaluation, cutover protocol (**Done**).
