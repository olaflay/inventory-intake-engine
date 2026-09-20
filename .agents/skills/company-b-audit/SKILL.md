---
name: company-b-audit
description: Executes the complete automated test suite against the Company-B configuration to verify zero hardcoded domain literals in code.
---

# Company-B Portability Audit Skill

## Purpose
Enforces **Locked Decision LD-5** by proving that the entire engine operates correctly against an alternative organization configuration (`/config/company-b`) featuring different statuses, location types, categories, and thresholds, with zero code edits.

## When to Invoke
- Mandatory in the CI/CD pipeline on every pull request.
- Prior to every release or phase gate sign-off.

## Procedure
1. Load configuration from `config/company-b/`.
2. Validate that the engine parses all sheets and YAML files without falling back to defaults.
3. Run the automated portability test:
   ```bash
   node --test tests/portability/companyB.test.js
   ```
4. Perform an automated AST/grep scan of `packages/` to ensure no company-specific literal names appear as constants or strings.

## Expected Output
A portability verification report confirming zero hardcoded domain literals and passing test status.
