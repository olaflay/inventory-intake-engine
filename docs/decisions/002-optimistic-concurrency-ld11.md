# Architecture Decision Record (ADR) 002: Optimistic Concurrency Control (LD-11)

- **ID**: ADR-002
- **Title**: Single Optimistic Versioning Concurrency Strategy (Superseding Row Locks)
- **Date**: 2026-09-20
- **Owner**: Principal Software Architect
- **Status**: ACCEPTED

---

## 1. Context & Problem Statement
Multiple field workers or store personnel may submit proposals or approvals touching overlapping inventory assets concurrently. Early drafts of edge case E22 suggested row-level locks (`SELECT ... FOR UPDATE`), which introduces high deadlock risks, database contention, and complex timeout handling across long-running chat conversations.

## 2. Decision Drivers
- **Priority Ranking 1 (Data Integrity)**: A wrong inventory update or double-post is unacceptable.
- **Priority Ranking 3 (Simplicity & Maintainability)**: A single, consistent concurrency strategy across all operations.
- **Deadlock Prevention**: Zero database deadlocks during multi-asset dispatches.

## 3. Options Considered
1. **Option A: Optimistic Asset Versioning inside Atomic Transaction (Chosen, LD-11)**:
   - Each asset row has an integer `version`.
   - Posting executes: `UPDATE asset SET ... version = version + 1 WHERE id = :id AND version = :expected_version`.
   - Affected assets are sorted in ascending ID order before updating.
   - If any row update touches 0 rows, the entire transaction rolls back, and the proposal is marked `STALE`.
2. **Option B: Pessimistic Row Locking (`SELECT ... FOR UPDATE`)**:
   - Rejected due to deadlock vulnerabilities and lock contention during human approval delays.
3. **Option C: Mixed Strategy (Optimistic for Reads, Pessimistic for Writes)**:
   - Rejected to maintain architectural simplicity (one strategy only).

## 4. Evidence & Research
- **Source**: PRD §0.1 (LD-11), PRD §29, property test suite verification.
- **Finding**: Concurrency simulations using `fast-check` prove that optimistic version checks guarantee serializable consistency with zero deadlocks and zero partial states.
- **Confidence**: HIGH.

## 5. Decision & Rationale
Adopt a single concurrency strategy: **Optimistic Asset Versioning** (LD-11). Row-level locking is permanently forbidden in all engine code and migrations.

## 6. Consequences & Trade-offs
- **Positive**: Complete elimination of deadlocks; low database resource consumption; pure atomic rollbacks.
- **Negative / Operational**: Requires client/adapter awareness of `STALE` proposals, prompting the user to re-validate against updated state.
