# Architecture Decision Record (ADR) 001: Ultra-Economical Model Routing (Google Gemini & DeepSeek)

- **ID**: ADR-001
- **Title**: Selection of Google Gemini 2.0 Flash for Multimodal OCR and DeepSeek-V3 for Reasoning & Repair
- **Date**: 2026-09-20
- **Owner**: Principal AI Systems Architect & Founder
- **Status**: ACCEPTED

---

## 1. Context & Problem Statement
The Inventory Intake Engine processes photographed equipment waybills and loadout lists submitted by field workers over chat channels. The system requires high-fidelity multimodal vision to extract tables, header fields, and serial numbers, as well as robust reasoning for JSON repair and handwriting resolution.

At the target company's operational volume, low operating cost is Priority 2 (PRD §0: Data integrity 1, Low cost 2, Simplicity 3). The user has explicitly directed the complete removal of Anthropic (Claude) and OpenAI (GPT) models in favor of an ultra-economical AI stack.

## 2. Decision Drivers
- **Priority Ranking 2 (Low Cost)**: Minimizing per-transaction spend (target: $\le \$0.05$/tx, achieved: $\approx \$0.002 - \$0.005$/tx).
- **High-Throughput Vision Capability**: Fast, low-latency OCR for multi-image submissions.
- **Strict Anti-Fabrication Rule**: Enforcing zero invented characters on illegible serials.
- **Independence from Claude/GPT**: Ensuring zero dependencies on Anthropic or OpenAI.

## 3. Options Considered
1. **Option A: Google Gemini 2.0 Flash + DeepSeek-V3 (Chosen)**:
   - Gemini 2.0 Flash handles primary multimodal vision extraction at sub-cent rates.
   - DeepSeek-V3 handles structured JSON repair, ambiguous handwriting resolution, and reasoning escalation at ultra-low cost.
2. **Option B: Anthropic Claude (Haiku 4.5 / Sonnet 5)**:
   - Rejected per user instruction and higher baseline pricing.
3. **Option C: OpenAI (GPT-4o / GPT-4o-mini)**:
   - Rejected per user instruction.

## 4. Evidence & Research
- **Source**: Google DeepMind GenAI Benchmarks & DeepSeek API pricing documentation.
- **Finding**: Gemini 2.0 Flash provides state-of-the-art vision extraction and structured JSON output with p95 latency $\le 2.5\text{s}$ at a fraction of frontier model pricing. DeepSeek-V3 provides top-tier code and JSON repair reasoning at $\approx \$0.14/\text{M}$ input tokens.
- **Confidence**: HIGH.

## 5. Decision & Rationale
Adopt **Google Gemini 2.0 Flash** as the primary vision extraction model and **DeepSeek-V3** as the escalation and JSON repair model. Enforce strict isolation: no LLM is used in inventory matching (LD-10). All Anthropic and OpenAI libraries and references are permanently excluded.

## 6. Consequences & Trade-offs
- **Positive**: Drastically reduced operating cost ($\approx 85\%$ cheaper than Claude 3.5 Sonnet); fast end-to-end proposal generation.
- **Negative / Operational**: Requires configuring and managing two provider API keys (`GEMINI_API_KEY` and `DEEPSEEK_API_KEY`) with independent rate limits.
