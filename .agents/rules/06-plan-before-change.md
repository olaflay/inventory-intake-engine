# Mandatory Planning Before Change (RULE-PLAN-01)

---

## 1. Plan-First Mandate
- **No Direct Modifications Without an Approved Plan**:
  * Before any code, configuration, schema, migration, script, test, or infrastructure file is modified, created, or deleted, a structured implementation plan must be written and submitted.
  * No file edits may be performed during the planning/research phase.
  * Stealth edits, speculative tweaks, or unreviewed refactoring are strictly prohibited.

---

## 2. Required Plan Contents
Every implementation plan must explicitly detail:
1. **Objective & Scope**:
   * What problem is being solved or what capability is being added.
   * Specific requirements (`FR-*`, `EC-*`, PRD sections) addressed.
2. **Impact & Invariant Analysis**:
   * Assessment against Locked Decisions (LD-1 through LD-15, e.g., LD-5 Zero Domain Literals, LD-11 Optimistic Concurrency).
   * Schema and database migration implications (if applicable).
   * Upstream/downstream package dependencies (`domain`, `engine`, `vision`, `adapters`).
3. **Proposed Changes by Component**:
   * Exact list of files to create, modify, or delete.
   * Detailed summary of structural, logic, and interface changes.
4. **Verification & Testing Strategy**:
   * Exact test commands (`npm test`, `test:company-b`, etc.) to run.
   * New test coverage for requirements and edge cases.
   * Verification criteria that prove correctness prior to sign-off.

---

## 3. Human Approval Gate
- For any change involving architectural boundaries, schema mutations, public API contracts, or critical business logic:
  * Present the plan clearly to the user/stakeholder.
  * Wait for explicit feedback or approval before beginning code execution.
  * If unforeseen complexities arise during execution requiring a pivot, update the plan and re-verify before proceeding.
