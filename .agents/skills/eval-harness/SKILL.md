---
name: eval-harness
description: Executes vision model evaluation against ground truth datasets, measuring exact read rate, hallucination rate, and Phase 0 gate metrics.
---

# Vision Model Evaluation Harness Skill

## Purpose
Executes ground truth evaluation runs for document OCR models (Google Gemini 2.0 Flash and DeepSeek-V3), calculating exact serial read rate and verifying strictly zero hallucinations on unreadable serials.

## When to Invoke
- Whenever prompts, schemas, document types, or model IDs are updated.
- Nightly canary runs or Phase 0 gate validation.

## Required Inputs
- Test document set (images/PDFs) in `tests/golden/` or `tests/fixtures/`.
- Hand-labelled ground truth JSON files matching `GroundTruthDocument` schema.

## Procedure
1. Load test cases from ground truth directory.
2. Execute extraction using `GeminiVisionProvider` with temperature 0.0.
3. Run `evaluateExtractions()` from `@inventory/vision`.
4. Check gate thresholds:
   - Exact serial read rate on legible serials $\ge 95\%$.
   - Fabricated/guessed serials on illegible text = **0**.
   - Header accuracy $\ge 95\%$.
5. Output detailed report to `docs/eval/report-YYYYMMDD.md`.

## Expected Output
An evaluation report summarizing:
- Total documents and serials evaluated.
- Exact match percentage.
- Hallucination count (must be 0).
- Estimated token cost per transaction.
- Gate status: `PASSED` or `FAILED`.
