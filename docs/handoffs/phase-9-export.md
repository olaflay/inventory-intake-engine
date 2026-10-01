# Session Handoff — Phase 9 Export complete, Phase 10 next

```text
TASK: Phase 9 Export (FR-EXP-01, PRD §20.3), EC-56/57/59
OBJECTIVE: Render the company form as a new dated .xlsx from cfg:export_template,
  self-check totals against the database, and gate the formulas with a second
  calculation engine in CI.
CURRENT STATE: Automated gate green. Phase gate (§52 "Human parity confirmation")
  NOT met — the controlled July export template is not in the repository.
WORK COMPLETED:
  - packages/engine/src/excel/cellGrid.ts    A1 addressing, ranges, formulas
  - packages/engine/src/excel/xlsxWriter.ts   OOXML ZIP writer + reader, validation
  - packages/engine/src/excel/exporter.ts     projection render, totals, self-check,
                                              location rules, overwrite protection
  - cfg:export_template required; defaultExportConfig() removed (LD-5)
  - config/example + config/company-b export profiles added
  - .github/workflows/libreoffice_recalc.yml  headless recalculation gate
  - .github/workflows/ci.yml                  now runs build + `npm test`, not a
                                              hand-maintained test list
  - scripts/make_export_fixture.mjs           fixture workbook + expected_totals.json
  - scripts/verify_recalc.mjs                 compares recalculated totals to claims
  - tests/fixtures/export_template.json, export_data.json
  - docs/lessons/phase-9.md                   lessons + runbook entries
FILES AFFECTED:
  packages/engine/src/excel/{cellGrid,xlsxWriter,exporter}.ts
  packages/engine/src/config/engineeringConfigLoader.ts
  packages/engine/src/api/server.ts        503 export_template_not_configured
  packages/engine/src/cli/index.ts         --config now required
  packages/engine/src/index.ts             excel exports
  config/example/engineering/export.yaml
  config/company-b/engineering/export.yaml
  tests/engine/phase9_export.test.js       30 tests
  tests/engine/api.test.js, tests/cli/cli.test.js, tests/e2e/dispatch_flow.test.js
  tests/portability/companyB.test.js
  tests/fixtures/export_{template,data}.json
  scripts/{make_export_fixture,verify_recalc}.mjs
  .github/workflows/{ci,libreoffice_recalc}.yml
  .gitignore                              tmp-export/, tmp-recalc/
DECISIONS:
  - No default export profile. A missing template is an error, never a guess.
  - totals_label_column is required config. The "totals_column - 1" offset
    overwrote the identity cell and silently corrupted counts.
  - Invalid/duplicate sheet names fail loudly instead of being sanitized.
    A self-check on counts cannot catch a sheet placed on the wrong sheet.
  - Location rules match on type equality; a rule's presence never implies
    a match. Name-specific rules take precedence over type rules.
  - Cached values are treated as unproven until a second engine agrees.
EVIDENCE:
  - npm run build --workspaces        clean
  - npm test                          145/145 pass, 0 fail
  - npm run test:company-b            3/3 pass (FR-CFG-04, zero code changes)
  - tests/engine/phase9_export.test.js 30/30 pass
  - node scripts/make_export_fixture.mjs
      CACHED SURVEY EQUIPMENT B5 = 3 (claimed 3)
      CACHED IT EQUIPMENT      B4 = 2 (claimed 2)
      CACHED SUMMARY          B4 = 5 (claimed 5)
  - node scripts/verify_recalc.mjs ... PASS: recalculated 3 totals and all match
    (and correctly fails on a deliberately wrong expectation)
ASSUMPTIONS:
  - LibreOffice is absent on the dev machine; the recalculation gate is proven
    only as far as the soffice invocation. Needs one CI run to close.
  - Exported bytes are held in an in-memory Map (server.ts:16), so a restart
    drops them. Acceptable for a dated monthly file that is regenerated, but
    a GET by id after a restart returns 404. Not yet backed by object storage.
RISKS:
  - Visual parity may fail once the real July form is available: header rows,
    fonts, column widths, and print layout were never compared to it.
  - COUNTA totals assume item rows are contiguous from first_data_row. A gap
    row would be counted.
  - OOXML is hand-built against node:zlib with no third-party writer, so
    Excel-version compatibility rests on the round-trip reader passing.
UNRESOLVED QUESTIONS:
  - Where is the controlled July export template? Needed for the §52 gate.
  - Should the totals label be a fixed string or a per-category config value?
  - Do we need print-area / page-setup output for the form to print correctly?
NEXT ACTION:
  1. Commit phases 4-9 (working tree is entirely uncommitted).
  2. Push to a branch and let libreoffice_recalc.yml run; confirm the gate green.
  3. Obtain the July template, add a header-level profile test against it, and
     run a human parity review to close the Phase 9 gate.
  4. Then begin Phase 10 Hardening (security gate, drills, restore drill,
     Company-B full pass, runbooks).
REQUIRED APPROVAL: Human Founder — July template and human parity confirmation
```