# Runbook: Disaster Recovery & Database Restoration

**PRD Reference:** PRD §45, §49.10, §52 (Phase 10 Hardening), EC-62.  
**Audience:** System Administrator / DevOps Engineer.

---

## 1. Objective
Guide the restoration of canonical Postgres state from daily provider backups or weekly logical SQL dumps, followed by validation of Invariants I1–I4 using `LedgerReplayer`.

---

## 2. Emergency Trigger Conditions
- Database disk corruption, catastrophic container host loss, or unrecoverable hardware failure.
- Accidental destructive table operation or unrecoverable split-brain data loss.

---

## 3. Step-by-Step Restoration Procedure

### Step 3.1: Halt Ingestion Traffic
Immediately prevent incoming webhook traffic to avoid partial writes during restore:
```bash
# Stop Telegram adapter container or block webhook at ingress
docker stop inventory-telegram-adapter
```

### Step 3.2: Restore Postgres Dump
Restore the canonical schema and data from the latest verified SQL backup:
```bash
# Restore to fresh Postgres instance
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f backups/canonical_inventory_latest.sql
```

### Step 3.3: Replay and Validate Ledger Invariants (I1–I4)
Execute the deterministic ledger replayer to prove zero broken invariant states:
```bash
# Run the automated restore integrity drill
npm run test:drills -- tests/drills/restore_integrity_drill.test.js
```

Verify that the replayer output confirms:
- **Invariant I1 (Non-negative inventory):** Every asset has exactly one canonical location and valid state.
- **Invariant I2 (Audit continuity):** Monotonically increasing ledger IDs with unbroken cryptographic hashes.
- **Invariant I3 (Dual-control adherence):** Every Tier 3 record has two distinct approver signatures.
- **Invariant I4 (Reversible movements):** Every dispatch has an in-transit tracking record or matching receipt.

### Step 3.4: Reconcile Against Last Exported Monthly Form
Run the reconciler against the last generated `.xlsx` dated projection:
```bash
node dist/cli.js reconcile --form tmp-export/GOSL_INVENTORY_LAST_KNOWN.xlsx
```
Verify discrepancy report shows zero unexpected variance.

### Step 3.5: Resume Ingestion Traffic
Restart the adapter and worker processes:
```bash
docker start inventory-telegram-adapter
```
Monitor `/healthz` and `/readyz` endpoints.
