# Runbook: Shadow Pilot to Production Cutover Protocol

**PRD Reference:** PRD §52 (Phase 11: Shadow pilot → cutover), LD-3, LD-15, RULE-SEC-01.  
**Audience:** Operations Lead, Lead Integrator, Company Founder.

---

## 1. Overview & Locked Decisions
- **Locked Decision LD-15:** Rollout uses a mandatory two-week shadow-mode pilot before cutover.
- **Locked Decision LD-3:** The Postgres database is canonical. The Excel inventory form is a regenerated, dated projection. The engine never edits the company's master workbook in place.
- **Human Approval Trigger (RULE-SEC-01):** Cutover from shadow pilot to production strictly requires explicit Human Founder sign-off before freezing manual edits.

---

## 2. Gate Verification Checklist (Phase 11 Exit Criteria)

Prior to initiating cutover, the operations team must run the shadow comparator and confirm all 6 criteria are **MET**:

```bash
node dist/cli.js shadow-compare tmp-pilot/pilot_two_weeks.json
```

| Exit Criterion | Target Threshold | Validation Evidence |
|---|---|---|
| **(a) Agreement Rate** | $\ge 95\%$ of proposed lines agree with real changes | Automated scorecard |
| **(b) Posted Violations** | Zero posted invariant violations (I1–I4) and 0 unresolved wrong-match reports | Clean ledger audit |
| **(c) Human Correction Rate** | Trending downwards and $\le 30\%$ by Week 2 | Scorecard trend |
| **(d) Adoption Coverage** | $\ge 80\%$ of physical movements submitted through Telegram bot | Ingestion log tally |
| **(e) Disaster Recovery Drill** | Restore drill executed and verified clean | `tests/drills/restore_integrity_drill.test.js` PASS |
| **(f) Admin Self-Sufficiency** | Company admin added a user and a location via Ops Workbook unaided | Audit trace record |

---

## 3. Step-by-Step Cutover Execution

### Step 3.1: Obtain Founder Sign-Off
Founder reviews the Phase 11 scorecard artifact and provides written authorization to proceed.

### Step 3.2: Freeze Manual Workbook Editing
1. Set the legacy master Excel spreadsheet on OneDrive/SharePoint to **Read-Only** for all staff.
2. Archive the final hand-edited version as `ARCHIVE_MASTER_PRE_CUTOVER_[YYYY_MM_DD].xlsx`.
3. Notify all dispatchers and warehouse store staff that all equipment movements must now be reported exclusively through the Telegram bot.

### Step 3.3: Final Historical Baseline Sync
Execute the three-stage importer against the final archived workbook to ensure zero unrecorded assets or discrepancies exist prior to go-live:
```bash
node dist/cli.js import commit --file ARCHIVE_MASTER_PRE_CUTOVER.xlsx
```

### Step 3.4: Transition to Canonical Production Mode
1. Ensure the container service is running with `SHADOW_MODE=false`.
2. Approver decisions on Telegram bot now post atomically to Postgres tables (LD-11).
3. The engine automatically emits transactional outbox events to subscribers.

### Step 3.5: Establish First Monthly Projection
Generate the first official dated projection from canonical database state:
```bash
node dist/cli.js export --config config/example/engineering/export.yaml --out dist/exports/
```
Publish the resulting dated `.xlsx` file to the company's document repository.

### Step 3.6: Safety Net Reconciliation (Month 1)
Run the reconciler diff script weekly during Month 1 to monitor operational habits and flag any manual divergence without modifying the database.
