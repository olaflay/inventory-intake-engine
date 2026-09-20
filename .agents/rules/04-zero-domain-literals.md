# Zero Domain Literals Rule (RULE-ENG-01, LD-5)

---

## 1. No Hardcoded Business Literals
- Not a single business literal may exist as a hardcoded string, constant, or enum in application code.
- This includes:
  * Status codes (`OPERATIONAL`, `FAULTY`, `SCRAPPED`, `REPAIR`)
  * Location types (`vessel`, `jetty`, `warehouse`, `rig`)
  * Equipment categories (`SURVEY`, `IT`)
  * Approval tier numbers or thresholds
  * File caps or quiet seconds
- All business vocabulary must be read from the Ops Workbook / YAML configuration bundle.

---

## 2. No Defaults in Code
- If a required configuration key or column is missing from the Ops Workbook or Engineering Files:
  * The configuration is **INVALID**.
  * The engine MUST reject the reload, keep the last known good snapshot, and emit `config.invalid`.
  * The engine must NEVER fall back to implicit default values in code.

---

## 3. Mandatory Company-B Portability Proof
- Prior to merging code or releasing builds, the test suite must execute against `/config/company-b` (which features an entirely different status vocabulary, location types, and thresholds) with zero code modifications.
- Any failure on Company-B blocks deployment.
