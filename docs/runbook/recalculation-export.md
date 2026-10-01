# Runbook: Monthly Excel Export & LibreOffice Recalculation Gate

**PRD Reference:** PRD §20.3 (Excel form export), §45, §52 (Phase 9/10), EC-56, EC-57, EC-59.  
**Audience:** Operations Lead / Release Engineer.

---

## 1. Overview
The inventory intake engine treats the canonical Postgres database as ground truth (LD-3). The company's monthly Excel inventory workbook is a regenerated, dated projection derived directly from canonical tables.

---

## 2. Generating the Monthly Projection
To generate the official monthly projection from the database:
```bash
node dist/cli.js export \
  --config config/example/engineering/export.yaml \
  --out tmp-export/
```

### Exporter Self-Checks (Automated Gate):
The exporter automatically reads back the generated `.xlsx` bytes and verifies:
1. Every sheet exists and matches declared configuration names.
2. Every item row contains an `internal_ref`.
3. Computed `COUNTA(...)` formula totals match canonical database item counts exactly.
4. If a mismatch is detected, the operation aborts with `export_self_check_failed` without touching the ledger.

---

## 3. LibreOffice Headless Recalculation Check
To independently confirm formula totals using a second calculation engine:

### 3.1: In GitHub Actions (Automated CI Gate)
The workflow `.github/workflows/libreoffice_recalc.yml` runs automatically on pushes and PRs:
1. Installs `libreoffice-calc` on `ubuntu-latest`.
2. Generates the dated fixture via `scripts/make_export_fixture.mjs`.
3. Runs headless LibreOffice recalculation (`soffice --headless --convert-to xlsx`).
4. Executes `scripts/verify_recalc.mjs` comparing recalculated cell values to claims.

### 3.2: Local Execution (Requires LibreOffice installed)
```bash
# 1. Generate export fixture and claims
node scripts/make_export_fixture.mjs

# 2. Recalculate with headless Calc
soffice --headless --norestore --convert-to xlsx:"Calc MS Excel 2007 XML" --outdir tmp-recalc tmp-export/*.xlsx

# 3. Verify recalculated totals
node scripts/verify_recalc.mjs tmp-recalc tmp-export/expected_totals.json
```
Successful execution prints:
```text
PASS: LibreOffice recalculated 3 totals and all match
```
