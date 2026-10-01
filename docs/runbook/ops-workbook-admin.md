# Runbook: Ops Workbook Administration

**PRD Reference:** Appendix A (Ops Workbook Specification), LD-4, LD-5, LD-6, EC-53.  
**Audience:** Company Administrator (Non-developer).

---

## 1. Overview
The Ops Workbook (`config/ops_workbook.xlsx` or SharePoint sync) is the primary administrative control plane. Changes here require zero code changes or recompilations.

---

## 2. Strict Workbook Rules (LD-5)
1. **No merged cells**: Merged cells are strictly rejected by the parser.
2. **No hidden rows or columns**: Hidden rows are ignored or treated as malformed.
3. **No formula errors**: Formulas returning `#REF!`, `#VALUE!`, `#N/A` fail validation.
4. **No missing required keys**: A missing key renders the config invalid.

---

## 3. Common Administrative Tasks

### 3.1: Adding or Deactivating Users (`Actors` Sheet)
- **Sheet:** `Actors`
- **Columns:** `actor_ref`, `display_name`, `role`, `active`
- **Example row:**
  | actor_ref | display_name | role | active |
  |---|---|---|---|
  | `telegram:987654321` | John Dispatcher | Worker | Y |
- **Deactivation:** Set `active` to `N`. The user will receive an "unregistered/inactive" message and can perform zero inventory operations.

### 3.2: Adding a New Location Entity (`LocationSeed` & `LocationTypes`)
- **Sheet:** `LocationTypes` (if creating a new location type, e.g. `warehouse`)
  * `code`: `warehouse`
  * `label`: `Storage Warehouse`
  * `can_be_destination`: `Y`
  * `export_column_key`: `warehouse`
- **Sheet:** `LocationSeed` (initial seed only; live updates live in database)
  * `name`: `Warri Central Store`
  * `type`: `warehouse`
  * `parent`: `Warri Base`
  * `aliases`: `WCS, Warehouse 1`

### 3.3: Adjusting Operational Limits (`Limits` Sheet)
- **Key-Value pairs on `Limits` sheet:**
  * `max_files_per_submission`: Maximum attachments accepted per album (default 10).
  * `draft_quiet_seconds`: Album aggregation debounce window (default 90s).
  * `proposal_expiry_hours`: Duration before unapproved proposals lapse (default 48h).

---

## 4. Reloading and Safety Protocol (EC-53)
When an updated workbook is uploaded or reloaded:
1. The engine atomically validates the schema.
2. If validation succeeds, a new cryptographic `config_snapshot` is generated and becomes active (`config.reloaded` event).
3. If validation fails (e.g. invalid syntax, missing column):
   - The engine **refuses** the new workbook.
   - The **last-known-good snapshot remains active**.
   - An alert event `config.invalid` is emitted to all administrators.
   - Ongoing submissions are not interrupted.
