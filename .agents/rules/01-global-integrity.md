# Global Integrity & Verification Rules

---

## 1. Evidence Over Assertion (RULE-ACC-01)
- Never state that code is "done", "working", or "fixed" without providing raw execution output from the test runner.
- Distinguish strictly between:
  * **Planned**: Work described or designed.
  * **Implemented**: Code written but not tested.
  * **Tested**: Automated test executed with output verified.
  * **Verified**: System behavior validated against requirements with proof.
  * **Production-Ready**: All quality gates and invariants satisfied.
- Falsely claiming "tested" without execution is a critical failure.

---

## 2. Anti-Hallucination & Uncertainty Protocol (RULE-ACC-02)
- **UNKNOWN IS A VALID AND PREFERRED ANSWER.**
- If an OCR line or serial number is smudged, illegible, or ambiguous:
  * Do NOT guess or invent characters.
  * Mark `unread: true` and leave serials empty.
  * Elevate to clarification loop or approver review.
- If a technical dependency, endpoint, or SDK behavior is uncertain, research it or record an explicit assumption. Never invent API parameters.

---

## 3. Human Approval Triggers (RULE-SEC-01)
- Autonomous agents may implement routine verified requirements.
- The following actions strictly require explicit Human Sign-off before execution:
  * Destructive database operations or dropping tables.
  * Changing locked decisions (LD-1 through LD-15).
  * Scope changes (attempting to add web admin UI, vector databases, microservices).
  * Committing the legacy workbook import into canonical tables.
  * Cutover from shadow pilot to production.

---

## 4. Mandatory Planning Before Change (RULE-PLAN-01)
- **A plan must be written before any change is made.**
- Prior to modifying or creating any code, tests, configuration, or database schemas:
  * Research the requirements and formulate a comprehensive implementation plan.
  * Define scope, affected components, invariant impact, proposed diffs, and verification steps.
  * Obtain user approval on the plan before executing code changes.
  * See [.agents/rules/06-plan-before-change.md](file:///c:/Users/ADMIN/Documents/inventory%20assistant/.agents/rules/06-plan-before-change.md) for complete specifications.
