# Architecture & Concurrency Rules (RULE-ENG-02, LD-11)

---

## 1. Single Concurrency Strategy (LD-11)
- Concurrency uses **one strategy only**: optimistic per-asset versioning inside a single atomic Postgres transaction.
- **Strictly No `SELECT ... FOR UPDATE`**: Row-level locking is permanently forbidden.
- **Deadlock Prevention**: When posting a multi-item proposal, sort all affected `asset_id`s in ascending order before executing updates.
- **Atomic Rollback**: Execute:
  ```sql
  UPDATE asset 
  SET location_id = :new_loc, 
      movement_state = :new_state, 
      version = version + 1 
  WHERE id = :asset_id AND version = :expected_version;
  ```
  If zero rows are updated for any asset in the proposal, rollback the entire transaction immediately, mark the proposal as `STALE`, and notify the adapter.

---

## 2. Canonical Database (LD-3)
- The Postgres database is the sole canonical source of truth for inventory.
- The company's Excel form is an exported, dated projection.
- The engine NEVER opens or edits the master workbook in place.

---

## 3. Headless & Stateless Adapters (LD-2, LD-4)
- The core engine contains ZERO channel-specific code (no Telegram API calls, no webhook secrets).
- Adapters authenticate via hashed bearer keys and assert actor identity (`channel:id`).
- Roles and approval policies are enforced exclusively inside the engine from `config_snapshot`.
