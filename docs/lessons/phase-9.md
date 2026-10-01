# Phase Lessons — Phase 9: Export

## Phase Summary
- **Phase Number & Name**: Phase 9: Export (PRD §52 row 9)
- **Completion Date**: 2026-10-01
- **Gate Status**: PARTIAL — automated gate green; §52 gate ("Human parity confirmation") NOT met

**Scope delivered**: FR-EXP-01 and PRD §20.3 steps 1–6 on the automated side.

- Renderer producing a new dated `.xlsx` from `cfg:export_template`, with no overwrite.
- Totals as exporter-generated formulas at addresses the exporter computes itself.
- Location rendering through `cfg:location_export_rules` (column mark, remark template, `{alias}` substitution).
- Self-check: read the produced file back, recompute per-sheet counts from item rows, compare against database counts and against the totals the file claims.
- Template/profile mismatch blocks export with a named sheet or column.
- CI check: headless LibreOffice recalculation compared against the exporter's claims.
- Export failure leaves the ledger untouched (EC-59).

---

## 1. What Surprised Us

**A "no defaults" rule and a working exporter are in direct tension, and the exporter initially lost.** The first implementation shipped `defaultExportConfig()` with a plausible layout. It made every test pass and would have produced a file that looked correct for one company and silently wrong for another. The rule in `.agents/rules/04-zero-domain-literals.md` exists precisely for this failure mode, and it is invisible until you delete the fallback and see how many call sites were depending on it. Removing it touched the exporter, the API server, the CLI, the config loader, and four test files. A green suite was never evidence the rule held.

**Silent sheet-name repair turns a config error into a data-placement error.** The writer sanitized invalid sheet names (stripping `[]:*?/\`, truncating to 31 chars) and silently de-duplicated by appending a counter. That is the worst possible behavior here: the file opens, looks fine, and the self-check passes — because the self-check compares counts, not identity. A renamed sheet in the Ops Workbook would have produced a workbook with the right numbers on a sheet nobody recognises. The check now fails loudly, which is what EC-57 asks for.

**Two distinct bugs shared one root cause: a hardcoded column offset.** The totals label was computed as `totals_column - 1`. With identity in column A and totals in B, that offset lands on column A and overwrites the first item's identity cell with the word "Total". The self-check caught it as a count mismatch — three items became two. The fix is a new required config key, `totals_label_column`, which is the more expensive change but the correct one: no layout assumption survives it.

**The location rule resolver ignored the type it claimed to match.** `resolveLocationRule` found the first rule with a defined `location_type` and returned it, regardless of whether that type was the row's type. With two rules configured (vessel, yard), every row got the vessel mark. Nothing else in the system was wrong; the rendering was just confidently wrong. This is the class of bug a fixture set with two similar-but-distinct rule types should have caught from the start.

**The first version of the self-check test could never fail.** It patched a byte offset inside the ZIP to corrupt the claimed count, then asserted the checker rejected the file. Because worksheet XML is deflated, the patched byte did not correspond to the claimed-count text, so the test passed for the wrong reason — the file was corrupt, but not in the way the test claimed to test. The fix was to build the archive, corrupt the count at the model level, and round-trip it. The lesson generalises: when a test must corrupt a compressed artifact, corrupting bytes is almost never testing what you think.

**CI listed tests by name.** `.github/workflows/ci.yml` enumerated each test file. Every new phase added a line, and forgetting the line produced a silently shrinking suite with a green checkmark. It now runs `npm run build --workspaces` and `npm test`, so a new file cannot be skipped by omission. This is the same failure class as the silent sheet-name repair: a check that passes when it should have complained.

**`COUNTA` is the right function here, and that was worth confirming rather than assuming.** Totals count populated identity cells, not numeric ones, and the two diverge the moment an item row has a blank numeric field. `COUNTA(A2:A4)` also matches the exporter's own recomputation, which is what makes the self-check a genuine cross-check rather than a restatement.

---

## 2. What We Would Change

**Do not let a convenience default ship.** `defaultExportConfig()` was added because call sites needed *something* during development. It should have been a required argument from the first commit, with the sample company config loaded in tests. Cost of removing it late: five files. Cost of keeping it: a silent wrong-output path that no test was designed to find.

**Put layout assertions in a fixture, not in per-test literals.** Each test rebuilt a hand-written export config with slightly different column letters. That repetition is what let the `totals_column - 1` bug through — the tests agreed with each other on a layout that had no config key expressing it. A shared `tests/fixtures/export_template.json`, reused by the tests and by the LibreOffice fixture script, would have made the offset a config question instead of an arithmetic accident.

**The recalculation gate should have been written first.** The LibreOffice job is 20 lines and the reasoning it encodes — that a cached value proves nothing until a second engine agrees — was available from the start of the phase, not the end. Written early it would have caught the offset bug and the type-mismatch bug immediately, because both produce a file that opens cleanly and calculates correctly *for the wrong reason*.

**Enumerate CI jobs from the repo, not in YAML.** Same argument as above, applied to test discovery. A workflow that must be edited to notice new work will be edited wrong.

---

## 3. New Edge Cases Discovered

Every item below has an automated test in `tests/engine/phase9_export.test.js` (30 tests) unless noted.

| ID | Edge case | Control |
|---|---|---|
| EC-57a | Totals label lands on an item column when the layout is tight | Required `totals_label_column`; validation rejects totals/label on item columns and totals value == label |
| EC-57b | Rule with a `location_type` matches a row of a different type | `resolveLocationRule` compares the rule type to the row type; unmatched type yields blank mark and remark |
| EC-57c | `{alias}` placeholder duplicates the location name | Substitution prefers `locationAlias`, falls back to `locationName` |
| EC-57d | Invalid or duplicate sheet name silently repaired | `writeXlsx` throws on forbidden characters, >31 chars, empty names, duplicates |
| EC-57e | Duplicate column key or column letter in the profile | `validateExportConfig` rejects both |
| EC-57f | Summary sheet name shadows a category sheet | `validateExportConfig` rejects |
| EC-57g | Location mark and remark point at the same column | `validateExportConfig` rejects |
| EC-57h | Self-check test corrupts a compressed archive and passes for the wrong reason | Round-trip corruption at the model level; truncated-archive case also covered |
| EC-59 | Export failure touches the ledger | Input projection asserted byte-identical after a thrown export |
| — | Missing `cfg:export_template` | Exporter throws; CLI requires `--config`; API returns `503 export_template_not_configured` |
| — | Recalculation gate is inert | `scripts/verify_recalc.mjs` tested both passing and deliberately-wrong expectations |
| — | Same-day export collides with an existing file | Appends a timestamp suffix rather than overwriting |

---

## 4. Runbook Updates

No `docs/runbook/` directory existed before this phase. Operational entries that belong there:

- **Recalculation check (local).** LibreOffice is not installed on the development machine. The gate runs only in GitHub Actions on `main`/`staging` pushes and pull requests. To run it locally, install LibreOffice and execute:
  ```powershell
  node scripts/make_export_fixture.mjs
  soffice --headless --norestore --convert-to xlsx:"Calc MS Excel 2007 XML" --outdir tmp-recalc tmp-export/*.xlsx
  node scripts/verify_recalc.mjs tmp-recalc tmp-export/expected_totals.json
  ```
- **Fixture inputs.** `EXPORT_TEMPLATE`, `EXPORT_DATA`, and `EXPORT_OUT_DIR` override the fixture script's paths. The date is fixed at 2026-10-01 so the produced filename is stable across runs.
- **Export profile.** `cfg:export_template` must supply `totals_label_column` explicitly. A profile without it fails validation at load time, not at export time.
- **No-config behaviour.** With no template loaded, `POST /v1/exports` returns `503 export_template_not_configured` and `cli export` exits with an LD-5 message. This is deliberate: the engine will not guess a layout.
- **Scratch output.** `tmp-export/` and `tmp-recalc/` are gitignored; both are safe to delete at any time.

---

## Open Items Carried Forward

1. **Human visual parity (the §52 gate for this phase) is not met.** It cannot be met yet: the controlled July export template is not in the repository. Profile-level parity (sheet names, column positions, header rows) is verified against the fixtures only. Actual layout parity requires the real form and a human reviewer.
2. **The LibreOffice job has never run on a runner.** The workflow is verified only up to the point where `soffice` is invoked. The verifier script's own behaviour — pass and fail paths — is covered locally.
3. **Phases 4–8 have no lessons files.** `docs/lessons/` was created for this phase; earlier phases predate the directory and have no entries.
4. **The whole working tree is uncommitted.** Phase 4 through Phase 9 work sits unstaged alongside this documentation.