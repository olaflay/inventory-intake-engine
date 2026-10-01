# Headless Equipment Inventory Intake Engine

[![Build & Test Status](https://img.shields.io/badge/tests-156%2F156%20passed-brightgreen.svg)](file:///c:/Users/ADMIN/Documents/inventory%20assistant/package.json)
[![Architecture](https://img.shields.io/badge/architecture-LD--1%20to%20LD--15%20locked-blue.svg)](file:///c:/Users/ADMIN/Documents/inventory%20assistant/docs/PRD_Inventory_Intake_Engine_v1.0.md)
[![Security Audit](https://img.shields.io/badge/OWASP-API%20Top%2010%20Verified-success.svg)](file:///c:/Users/ADMIN/Documents/inventory%20assistant/docs/security_audit_report.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](file:///c:/Users/ADMIN/Documents/inventory%20assistant/tsconfig.json)

An industrial-grade, headless equipment inventory intake and reconciliation engine. It converts physical field paperwork (waybills, equipment manifests, inspection sheets) received via Telegram into canonical database updates, with automated dated Excel projections and dual-LLM multimodal verification (Gemini 2.5 Flash + DeepSeek R1).

---

## Table of Contents

- [For New Users & Operations Staff](#for-new-users--operations-staff)
  - [How It Works](#how-it-works)
  - [Using the Telegram Bot](#using-the-telegram-bot)
  - [Human Approval Tiers](#human-approval-tiers)
  - [Administering the System (Ops Workbook)](#administering-the-system-ops-workbook)
  - [Accessing Monthly Excel Projections](#accessing-monthly-excel-projections)
- [For Developers & Integrators](#for-developers--integrators)
  - [Architecture Overview](#architecture-overview)
  - [Monorepo Workspace Structure](#monorepo-workspace-structure)
  - [Locked Architectural Decisions (LD-1 to LD-15)](#locked-architectural-decisions-ld-1-to-ld-15)
  - [Quickstart & Local Development](#quickstart--local-development)
  - [Environment Variables (`.env`)](#environment-variables-env)
  - [CLI Commands Reference](#cli-commands-reference)
  - [HTTP API Reference](#http-api-reference)
  - [Testing & Verification Suites](#testing--verification-suites)
  - [Production Runbooks](#production-runbooks)

---

## For New Users & Operations Staff

### How It Works

Traditional warehouse operations suffer from spreadsheet drift, manual data entry errors, and lost dispatches. This engine automates equipment tracking without altering your physical field workflows:

```mermaid
flowchart LR
    A[Field Staff / Dispatcher] -->|Sends photo/PDF of paperwork| B[Telegram Bot]
    B -->|Ingest & Vision OCR| C[Headless Engine]
    C -->|Reconciliation & Invariants| D{Confidence Tier}
    D -->|Tier 1: High Confidence| E[Auto-Approved]
    D -->|Tier 2 / 3: Ambiguity| F[Approver Telegram Notification]
    F -->|One-Tap Approval| G[Canonical Postgres Ledger]
    E --> G
    G -->|Regenerate on Demand| H[Dated Excel Inventory Summary]
```

1. **Snap & Send:** Field staff snap a picture or upload a PDF of waybills and manifests to the company Telegram bot.
2. **AI Multimodal Extraction:** The engine extracts serial numbers, asset descriptions, destinations, and quantities.
3. **Automated Verification:** The engine matches physical items against existing warehouse records and detects missing items or discrepancies.
4. **Interactive Approval:** Designated managers receive an interactive card in Telegram with a side-by-side comparison to approve with a single tap.
5. **Clean Excel Records:** Your master records in Postgres update automatically, and official dated Excel inventory projections are generated without manual typing.

---

### Using the Telegram Bot

| Action | How to Perform |
|---|---|
| **Intake Document** | Send a photo or document (PNG, JPG, PDF) directly to the bot. Multi-page manifests can be sent together as an album. |
| **Check Status** | Send `/status` or `/pending` to view all active proposals awaiting review. |
| **Review Proposals** | When an intake is processed, approvers receive a summary message with **[Approve]**, **[Reject]**, or **[Clarify]** buttons. |
| **Discrepancy Alerts** | If an unrecorded serial or location conflict is detected, the bot highlights the exact line with an advisory tag. |

---

### Human Approval Tiers

Every incoming document is routed to an approval tier according to rules defined in your Ops Workbook:

* **Tier 1 (Auto-Approval):** Routine movements with 100% optical clarity and verbatim match against existing assets.
* **Tier 2 (Peer Review):** Minor ambiguities, non-serialized items, or new destination movements. Requires 1 operations lead approval.
* **Tier 3 (Lead / Founder Sign-Off):** High-value assets, major discrepancies, or unrecorded serial numbers. Self-approval is strictly prohibited.

---

### Administering the System (Ops Workbook)

**Zero Code Needed (LD-5):** All business rules, locations, users, and categories live in an Excel / JSON file called the **Ops Workbook** (`tests/fixtures/valid_config.json`).

To change locations, add staff, or modify categories:
1. Update the Ops Workbook sheet (e.g. add a new Yard to `locationTypes` or a new user to `actors`).
2. Reload the configuration via the CLI:
   ```bash
   node packages/engine/dist/cli/index.js validate-config path/to/ops_workbook.json
   ```
3. The engine performs atomic validation. If any required field is missing, it refuses to reload, preserving the previous stable configuration without downtime.

---

### Accessing Monthly Excel Projections

The engine generates fresh, dated Excel sheets on demand (**LD-3**). The system **never modifies your files in place**, preventing corrupted workbooks:

```bash
node packages/engine/dist/cli/index.js export --org "Apex Drilling Equipment" --config tests/fixtures/export_template.json --data tests/fixtures/export_data.json
```
Output: `Apex Drilling Equipment_INVENTORY_2026_10_01.xlsx` (includes formula-driven totals, zero manual entry).

---

## For Developers & Integrators

### Architecture Overview

The system is built as a strict headless architecture separated into distinct domain, engine, vision, and transport packages:

```mermaid
graph TD
    Client[Telegram Bot Client / Webhook] --> Adapter[adapters/telegram]
    Adapter -->|HTTP / Bearer Auth| EngineAPI[packages/engine / EngineApiServer]
    EngineAPI --> Extractor[packages/vision / ExtractionService]
    Extractor -->|Dual Model| AI[Gemini Flash + DeepSeek Reasoner]
    EngineAPI --> Core[packages/engine / Core Domain Services]
    Core --> DB[(PostgreSQL 16 - Canonical)]
    Core --> Outbox[Transactional Outbox Worker]
    Outbox --> EventHub[EventHub & Webhooks]
    Core --> Exporter[packages/engine / ExcelFormExporter]
    Exporter --> XlsxWriter[cellGrid + xlsxWriter]
```

### Monorepo Workspace Structure

```
├── packages/
│   ├── domain/       # Shared TypeScript schemas, types, interfaces, invariants (I1–I4)
│   ├── engine/       # Headless core: posting service, state machines, reconciler, exporter, API
│   └── vision/       # Multimodal OCR pipeline, magic-byte sniffer, prompt caching, dHash deduplication
├── adapters/
│   └── telegram/     # Telegram Bot reference adapter (pure HTTP webhook, rate limiting, HMAC verification)
├── tests/
│   ├── drills/       # Automated recovery drills (storage outage, config corruption, restore integrity)
│   ├── e2e/          # End-to-end integration and shadow pilot telemetry scorecard tests
│   ├── golden/       # Golden test suite matching Appendix D loadout dispatches
│   ├── portability/  # Company-B portability audit (verifies zero domain literals in packages/)
│   ├── property/     # Fast-check generative property tests validating invariants I1..I4
│   └── security/     # OWASP API Security Top 10 test suite
├── docs/             # PRD, Architectural Decision Records (ADRs), and operational runbooks
└── scripts/          # Server runners, fixture generators, and recalculation verifiers
```

---

### Locked Architectural Decisions (LD-1 to LD-15)

Every contributor must honor the 15 Locked Decisions established in the PRD:

- **LD-1:** Single-company engine instance. No multi-tenant partitions in core code.
- **LD-2:** Headless core. The engine has zero UI coupling and communicates via REST and webhooks.
- **LD-3:** Canonical Postgres database. Excel workbooks are read-only inputs or generated projections.
- **LD-4:** Multimodal dual-engine OCR (Gemini 2.5 Flash for speed, DeepSeek R1 for reasoning repair).
- **LD-5:** Zero domain literals in code. All company names, categories, and locations come from config.
- **LD-6:** Multi-tier human approval state machine with anti-self-approval enforcement.
- **LD-7:** Pure webhook Telegram transport with zero long-polling in production.
- **LD-8:** Ephemeral media handling. Raw images are stored in object storage; never on disk.
- **LD-9:** Explicit location hierarchy with unrecorded state preservation.
- **LD-10:** Verbatim evidence validation with anti-hallucination read rate gates.
- **LD-11:** Optimistic concurrency control using monotonic version checks (`EXPECTED_VERSION`).
- **LD-12:** Transactional outbox event bus for reliable subscriber delivery.
- **LD-13:** Command Line Interface (CLI) parity for all engine capabilities.
- **LD-14:** Dual-engine Excel recalculation verification (LibreOffice CI gate).
- **LD-15:** Mandatory 2-week shadow-mode pilot before production cutover.

---

### Quickstart & Local Development

#### Prerequisites
- Node.js $\ge 22.0.0$
- npm $\ge 10.0.0$
- Docker & Docker Compose (optional for local Postgres/MinIO)

#### 1. Clone & Install
```bash
git clone https://github.com/olaflay/inventory-intake-engine.git
cd inventory-intake-engine
npm install
```

#### 2. Build Monorepo Workspaces
```bash
npm run build
```

#### 3. Run the Test Suite (156 tests)
```bash
npm test
```

#### 4. Start the Local Server Runtime
```bash
npm start
```
This boots:
* **Engine HTTP API Server:** `http://localhost:4000`
* **Telegram Adapter Server:** `http://localhost:4001`
* Conducts automatic health self-checks against `/healthz` and `/readyz`.

---

### Environment Variables (`.env`)

Create a `.env` file based on `.env.example`:

| Variable | Description | Default / Example |
|---|---|---|
| `PORT` / `ENGINE_PORT` | Port for the Headless Engine HTTP API | `4000` |
| `ADAPTER_PORT` | Port for the Telegram Adapter Webhook Server | `4001` |
| `DATABASE_URL` | Canonical PostgreSQL 16 connection string | `postgres://inventory_app:local_dev_password@localhost:5432/inventory_canonical` |
| `STORAGE_ENDPOINT` | MinIO or S3 Object Storage endpoint | `http://localhost:9000` |
| `STORAGE_ACCESS_KEY` | Object storage access key | `minio_dev_admin` |
| `STORAGE_SECRET_KEY` | Object storage secret key | `minio_dev_secret_key` |
| `GEMINI_API_KEY` | Google Gemini API Key for primary multimodal OCR | (Required for live vision) |
| `DEEPSEEK_API_KEY` | DeepSeek API Key for reasoning repair | (Required for escalation) |
| `ADAPTER_KEY_PEPPER` | 32-byte secret pepper for hashing API tokens | `local-dev-pepper-32-bytes-secure` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot token from @BotFather | (Required for live bot) |
| `TELEGRAM_WEBHOOK_SECRET` | Secret string for Telegram HMAC verification | `dev_secret` |

---

### CLI Commands Reference

The engine provides full CLI parity via `packages/engine/dist/cli/index.js`:

```bash
# Validate an Ops Workbook (LD-5)
node packages/engine/dist/cli/index.js validate-config tests/fixtures/valid_config.json

# Submit document files for intake
node packages/engine/dist/cli/index.js submit document.pdf manifest.jpg

# Inspect a proposal and its validation tier
node packages/engine/dist/cli/index.js inspect p-102938

# Submit human approval for a proposal
node packages/engine/dist/cli/index.js approve p-102938 --actor "telegram:alice"

# Generate dated Excel inventory projection (LD-3)
node packages/engine/dist/cli/index.js export --org "Apex Drilling Equipment" --config tests/fixtures/export_template.json --data tests/fixtures/export_data.json

# Evaluate 2-Week Shadow Pilot Exit Scorecard (LD-15)
node packages/engine/dist/cli/index.js shadow-compare tmp-pilot/pilot_two_weeks.json
```

---

### HTTP API Reference

#### Health & Readiness
- `GET /healthz` - Returns `200 OK` `{ status: "ok", uptime: <seconds> }`.
- `GET /readyz` - Returns `200 OK` when database and configuration are fully loaded.

#### Submissions (PRD §42)
- `POST /v1/submissions`
  - **Headers:** `Authorization: Bearer <ADAPTER_KEY>`, `Content-Type: application/json`
  - **Payload:** `{ "files": ["doc1.pdf", "doc2.jpg"] }`
  - **Response (201):** `{ "id": "sub-123", "state": "DRAFT", "limits": { ... } }`

#### Proposals
- `GET /v1/proposals/:id`
  - **Headers:** `Authorization: Bearer <ADAPTER_KEY>`
  - **Response (200):** `{ "id": "p-123", "state": "READY", "tier": 2, "lines": [ ... ] }`

#### Exports (FR-EXP-01)
- `POST /v1/exports`
  - **Headers:** `Authorization: Bearer <ADAPTER_KEY>`, `Content-Type: application/json`
  - **Payload:** `{ "organizationName": "...", "sheets": [ ... ] }`
  - **Response (201):** `{ "id": "exp-123", "filename": "Org_INVENTORY_2026_10_01.xlsx" }`
- `GET /v1/exports/:id/file`
  - Streams the generated binary `.xlsx` spreadsheet (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).

---

### Testing & Verification Suites

The repository contains 156 deterministic automated tests covering every aspect of the PRD:

```bash
# Run all tests
npm test

# Run property tests for Invariants I1-I4 (fast-check)
npm run test:property

# Run golden test loadout dispatches (Appendix D)
npm run test:golden

# Run Company-B zero-literals portability audit (LD-5)
npm run test:company-b

# Run disaster recovery and outage drills
npm run test:drills

# Run end-to-end shadow pilot gate tests
npm run test:e2e
```

---

### Production Runbooks

Operational procedures are documented in detail in `docs/runbook/`:

* [Cutover Protocol Runbook](file:///c:/Users/ADMIN/Documents/inventory%20assistant/docs/runbook/cutover-protocol.md) — 6-criteria shadow pilot gate and manual spreadsheet freeze procedure.
* [Disaster Recovery Restore](file:///c:/Users/ADMIN/Documents/inventory%20assistant/docs/runbook/disaster-recovery-restore.md) — Point-in-time recovery and database reconstitution.
* [Ops Workbook Admin](file:///c:/Users/ADMIN/Documents/inventory%20assistant/docs/runbook/ops-workbook-admin.md) — User role onboarding, location updates, and config reloading.
* [Dead-Letter Queue Drain](file:///c:/Users/ADMIN/Documents/inventory%20assistant/docs/runbook/dead-letter-drain.md) — Inspection and replay of failed webhooks or OCR payloads.
* [Recalculation Export](file:///c:/Users/ADMIN/Documents/inventory%20assistant/docs/runbook/recalculation-export.md) — Headless Excel validation and LibreOffice parity auditing.

---

## License

Private & Proprietary. All rights reserved.
