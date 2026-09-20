# Architecture Decision Record (ADR) 003: Canonical Postgres Database & Projected Excel Generation (LD-3)

- **ID**: ADR-003
- **Title**: Canonical Postgres Database with On-Demand Projected Excel Generation
- **Date**: 2026-09-20
- **Owner**: Principal Data Architect & Founder
- **Status**: ACCEPTED

---

## 1. Context & Problem Statement
The company's existing inventory is managed via a monthly issued, controlled Excel form (~450 item rows, 12 category sheets, ~340 merged ranges, formula totals, location encoded by which column holds a "1"). Hand-editing this large, fragile workbook resulted in stale locations, duplicate records across sheets, and no audit trail. The product must decide whether to update the master spreadsheet in-place via APIs (e.g. Microsoft Graph) or treat a database as the single source of truth.

## 2. Decision Drivers
- **Priority Ranking 1 (Data Integrity)**: Prevent workbook corruption, formula breakage, and concurrent file lock conflicts.
- **Priority Ranking 3 (Simplicity & Maintainability)**: Avoid complex distributed lock management on cloud spreadsheets.
- **Auditability & Traceability**: Append-only ledger history for every equipment movement.

## 3. Options Considered
1. **Option A: Canonical Postgres Database with Projected Excel Generation (Chosen, LD-3)**:
   - Postgres is the single source of truth.
   - All state transitions and movements update Postgres tables and append to `ledger_entry`.
   - The familiar Excel form is regenerated on-demand as a dated projection from the database.
   - The engine never opens or edits the master workbook in place.
2. **Option B: Live In-Place Workbook Editing (Microsoft Graph API)**:
   - Rejected due to merged range fragility, session conflict errors, and lack of atomic transactions.
3. **Option C: Hybrid Master-Master Synchronization**:
   - Rejected due to impossible two-way merge conflicts when offline users edit cells.

## 4. Evidence & Research
- **Source**: PRD §0.1 (LD-3), PRD §20, Microsoft Graph workbook best-practice and error documentation (`learn.microsoft.com/graph/workbook-best-practice`).
- **Finding**: Live workbook sessions can conflict with human editors and lack ACID guarantees. Regenerating the workbook from structured relational data preserves formula totals and template integrity cleanly.
- **Confidence**: HIGH.

## 5. Decision & Rationale
Designate **Postgres as canonical**. The Excel form is strictly an output artifact (dated monthly issue) projected from the database, accompanied by automated formula self-checks.

## 6. Consequences & Trade-offs
- **Positive**: Complete audit trail; zero spreadsheet corruption; ACID transactional integrity.
- **Negative / Operational**: Requires an initial one-time import and reconciliation of the legacy workbook, plus a 2-week shadow-mode pilot to build operational trust.
