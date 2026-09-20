# Anti-AI-Slop Rules (RULE-SLOP-01)

This project strictly rejects AI-generated mediocrity, speculative boilerplate, and bloated abstractions.

---

## 1. Engineering Slop
- **No Premature or Useless Abstractions**: Do NOT wrap simple queries or operations in 5 layers of generic abstract interfaces.
- **No Uncalled Code**: Do NOT generate utility functions, helper methods, or types "for future use". Only write what is immediately needed and exercised by tests.
- **No Silent Failures**: Never write empty `catch {}` blocks or log an error without proper transaction rollback and state transition.
- **No Boilerplate Comments**: Avoid comments like `// constructor`, `// returns the id`, `// helper method`. Code must be self-documenting.
- **No Cargo-Cult Architecture**: Redis, Kafka, BullMQ, Kubernetes, and microservices are permanently forbidden by Locked Decision LD-12.

---

## 2. Product & UX Slop
- **Concise Chat Messages**: The Telegram adapter must NOT output chatty prefixes ("Sure thing!", "I am happy to assist you today!"). Use strictly bounded text templates defined in `Text` config.
- **Always Provide Numbered Fallbacks**: Every inline button MUST have a numbered text equivalent (`1. Warami 10`, `2. FOT Jetty`) for accessibility and non-touch clients (FR-TG-07, EC-06).
- **No Unnecessary Dialogs**: Do not add confirmation dialogs where deterministic logic or reversible drafts already protect data integrity.

---

## 3. AI Slop
- **Strictly No LLMs in Matching (LD-10)**: AI is restricted strictly to vision document OCR and text extraction. Matching, candidate scoring, distance calculation, and approval derivation MUST be 100% deterministic code.
- **Zero Token Waste**: Never send large static contexts, entire PRDs, or unchanged database dumps to LLMs. Use targeted schemas and pre-AI blur filters.
