# AI Model Routing & Economics Rules (RULE-AI-01)

---

## 1. Allowed AI Providers & Models
- **Primary Multimodal Vision Model**: **Google Gemini (`gemini-2.0-flash` / `gemini-1.5-flash`)**.
  * Use: Document OCR, table extraction, header reading, auto-rotation evaluation.
  * Temperature: `0.0`.
  * Format: Strict JSON output.
- **Secondary Reasoning & Repair Model**: **DeepSeek (`deepseek-chat` / `deepseek-v3`)**.
  * Use: Complex JSON repair, ambiguous handwriting resolution, classification escalation.
  * Temperature: `0.0`.
  * Format: Strict JSON output.
- **Strictly Excluded**:
  * Claude / Anthropic (completely forbidden).
  * OpenAI / GPT (completely forbidden).

---

## 2. Pre-AI Quality Gate Enforcement
- Before invoking Gemini vision APIs:
  * Check Laplacian blur variance ($\sigma^2 \ge 100$).
  * Check dimension and pixel limits ($10,000 \le \text{pixels} \le 40,000,000$).
  * If blurred or corrupted, reject immediately with a retake request, incurring **$0.00** AI cost.

---

## 3. Cost Ceilings
- Per-submission token ceiling: $\le 12,000$ tokens.
- Expected AI cost per transaction: $\approx \$0.002 - \$0.005$.
- Monthly spend alert: $\$25.00$; Hard stop: $\$50.00$.
