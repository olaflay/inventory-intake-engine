---
name: excel-projection-audit
description: Audits the generated Excel projection against canonical database counts and verifies formula integrity and visual template parity.
---

# Excel Form Projection Audit Skill

## Purpose
Enforces **Locked Decision LD-3** (database is canonical, Excel form is a regenerated projection) by verifying that generated `.xlsx` workbooks accurately reflect the database without in-place workbook corruption.

## When to Invoke
- Whenever export templates, mappings, or sheet generation logic are modified.
- Monthly during the shadow pilot or prior to issuing official inventory issues.

## Procedure
1. Query canonical database asset totals by category and location.
2. Trigger export projection via `ExcelFormExporter`.
3. Verify self-checks:
   - Sum of items on all category sheets equals canonical database count.
   - Summary sheet formula cells evaluate to expected counts without `#REF!` or `#VALUE!`.
4. Run automated test:
   ```bash
   node --test tests/engine/api.test.js
   ```

## Expected Output
Audit report confirming exact item count equality between database and exported workbook.
