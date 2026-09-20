---
name: concurrency-audit
description: Audits database queries, transactions, and posting code to enforce LD-11 optimistic versioning and prevent deadlocks and row-locking.
---

# Concurrency & Optimistic Locking Audit Skill

## Purpose
Ensures that all state mutation in the engine strictly adheres to **Locked Decision LD-11** (optimistic asset versioning) and that no row-level locking (`SELECT ... FOR UPDATE`) or deadlock risks exist.

## When to Invoke
- Whenever database queries, posting logic, transaction handlers, or migration scripts are added or modified.
- Prior to merging any PR modifying `packages/engine`.

## Checklist & Procedure
1. **Search for Forbidden Syntax**:
   - Grep for `FOR UPDATE` or `FOR NO KEY UPDATE` across all repositories. Any match fails the audit.
2. **Verify Asset Sorting**:
   - Ensure that any multi-asset operation sorts asset IDs ascending before executing updates.
3. **Verify Version Increments**:
   - Verify SQL update uses `WHERE id = :id AND version = :expected_version` and sets `version = version + 1`.
4. **Verify Rollback & Stale State**:
   - Ensure that if `rows_affected == 0`, the transaction rolls back immediately and marks the proposal as `STALE`.
5. **Run Property Test**:
   - Execute `node --test tests/property/concurrency.test.js`.

## Expected Output
An audit confirmation affirming that all mutations are deadlock-free, optimistic, and verified by passing tests.
