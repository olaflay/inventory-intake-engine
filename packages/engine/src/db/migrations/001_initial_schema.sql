-- Inventory Intake Engine: Canonical Relational Schema (Postgres)
-- Implements PRD §41 and Locked Decisions LD-1, LD-3, LD-11

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 1. Configuration & Security
CREATE TABLE config_snapshot (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid BOOLEAN NOT NULL DEFAULT TRUE,
    source_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_hashes JSONB NOT NULL DEFAULT '{}'::jsonb,
    bundle JSONB NOT NULL,
    diff_from_previous JSONB
);

CREATE TABLE adapter (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    key_hash TEXT NOT NULL,
    max_assurance TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at TIMESTAMPTZ
);

-- 2. Master Locations & Aliases
CREATE TABLE location (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    name_norm TEXT NOT NULL,
    type_code TEXT NOT NULL,
    parent_id UUID REFERENCES location(id) ON DELETE SET NULL,
    state TEXT NOT NULL DEFAULT 'active',
    created_via TEXT NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_location_name_norm ON location(name_norm);

CREATE TABLE location_alias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID NOT NULL REFERENCES location(id) ON DELETE CASCADE,
    alias_raw TEXT NOT NULL,
    alias_norm TEXT NOT NULL,
    created_via TEXT NOT NULL DEFAULT 'proposal',
    created_by_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_location_alias_norm ON location_alias(alias_norm);

-- 3. Assets & Serials (Canonical Inventory)
CREATE TABLE asset (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    internal_ref TEXT NOT NULL UNIQUE,
    company_asset_no TEXT,
    description TEXT NOT NULL,
    description_norm TEXT NOT NULL,
    category_code TEXT NOT NULL,
    status_code TEXT NOT NULL,
    location_id UUID REFERENCES location(id) ON DELETE SET NULL,
    movement_state TEXT NOT NULL DEFAULT 'at_location', -- at_location | in_transit
    transit_dispatch_id UUID,
    transit_from_location_id UUID REFERENCES location(id),
    transit_to_location_id UUID REFERENCES location(id),
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_verified_at TIMESTAMPTZ,
    last_verified_submission_id UUID,
    version INT NOT NULL DEFAULT 1, -- Optimistic concurrency control (LD-11)
    created_via TEXT NOT NULL DEFAULT 'import',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at TIMESTAMPTZ
);
CREATE INDEX idx_asset_location ON asset(location_id);
CREATE INDEX idx_asset_status ON asset(status_code);
CREATE INDEX idx_asset_description_trgm ON asset USING gin (description_norm gin_trgm_ops);

CREATE TABLE asset_serial (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    serial_raw TEXT NOT NULL,
    serial_norm TEXT NOT NULL,
    part_label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Unique serial enforcement on non-retired assets (PRD §41)
CREATE UNIQUE INDEX uq_asset_serial_active ON asset_serial(serial_norm)
WHERE asset_id IN (SELECT id FROM asset WHERE retired_at IS NULL);

-- 4. Intake Submissions & Documents
CREATE TABLE submission (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    adapter_id UUID NOT NULL REFERENCES adapter(id),
    actor_ref TEXT NOT NULL,
    assurance TEXT NOT NULL,
    channel_context JSONB NOT NULL DEFAULT '{}'::jsonb,
    state TEXT NOT NULL DEFAULT 'DRAFT',
    idempotency_key TEXT NOT NULL UNIQUE,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_append_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    related_to_submission_id UUID REFERENCES submission(id),
    config_snapshot_id UUID NOT NULL REFERENCES config_snapshot(id),
    cost_usd_est NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE document (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submission(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, -- image | pdf
    mime TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    phash TEXT,
    storage_key TEXT NOT NULL,
    bytes BIGINT NOT NULL,
    width INT,
    height INT,
    pages INT,
    quality JSONB NOT NULL DEFAULT '{}'::jsonb,
    sent_as TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);
CREATE INDEX idx_document_sha256 ON document(sha256);

CREATE TABLE extraction (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submission(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, -- gemini | deepseek
    model_id TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    run_kind TEXT NOT NULL DEFAULT 'primary',
    raw JSONB NOT NULL,
    parsed JSONB NOT NULL,
    valid BOOLEAN NOT NULL DEFAULT TRUE,
    tokens_in INT NOT NULL DEFAULT 0,
    tokens_out INT NOT NULL DEFAULT 0,
    cost_usd_est NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
    latency_ms INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Proposals, Decisions, & Policy
CREATE TABLE proposal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submission(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, -- dispatch | receive | assertion | correction | status_change | asset_create
    state TEXT NOT NULL DEFAULT 'READY',
    current_version INT NOT NULL DEFAULT 1
);

CREATE TABLE proposal_version (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id UUID NOT NULL REFERENCES proposal(id) ON DELETE CASCADE,
    version INT NOT NULL,
    tier INT NOT NULL DEFAULT 1,
    approvals_required INT NOT NULL DEFAULT 1,
    payload JSONB NOT NULL,
    validation JSONB NOT NULL DEFAULT '{}'::jsonb,
    config_snapshot_id UUID NOT NULL REFERENCES config_snapshot(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    superseded_at TIMESTAMPTZ,
    UNIQUE(proposal_id, version)
);

CREATE TABLE decision (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_version_id UUID NOT NULL REFERENCES proposal_version(id) ON DELETE CASCADE,
    actor_ref TEXT NOT NULL,
    assurance TEXT NOT NULL,
    adapter_id UUID NOT NULL REFERENCES adapter(id),
    decision TEXT NOT NULL, -- approve | reject | amend
    note TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Transactions, Dispatches & Append-Only Ledger
CREATE TABLE transaction (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_version_id UUID NOT NULL UNIQUE REFERENCES proposal_version(id),
    family TEXT NOT NULL, -- movement | assertion | correction | admin
    dispatch_id UUID,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ledger_entry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES transaction(id) ON DELETE RESTRICT,
    seq INT NOT NULL,
    asset_id UUID NOT NULL REFERENCES asset(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL, -- dispatch | receive | move | status_change | create | retire | verify | reversal
    from_location_id UUID REFERENCES location(id),
    to_location_id UUID REFERENCES location(id),
    from_status TEXT,
    to_status TEXT,
    from_movement_state TEXT NOT NULL,
    to_movement_state TEXT NOT NULL,
    before JSONB NOT NULL,
    after JSONB NOT NULL,
    reverses_entry_id UUID REFERENCES ledger_entry(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ledger_asset_created ON ledger_entry(asset_id, created_at);

CREATE TABLE dispatch (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    human_ref TEXT NOT NULL UNIQUE,
    issuer TEXT NOT NULL,
    waybill_no TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open', -- open | received | partially_received | cancelled
    itemization_state TEXT NOT NULL DEFAULT 'complete',
    from_location_id UUID REFERENCES location(id),
    to_location_id UUID REFERENCES location(id),
    transit_via_text TEXT,
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_at TIMESTAMPTZ,
    created_transaction_id UUID NOT NULL REFERENCES transaction(id),
    UNIQUE(issuer, waybill_no)
);

-- 7. Outbox Events & Audit Log
CREATE TABLE outbox_event (
    seq BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    audience TEXT[] NOT NULL DEFAULT '{}',
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_outbox_seq ON outbox_event(seq);

CREATE TABLE audit_event (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_ref TEXT NOT NULL,
    adapter_id UUID NOT NULL REFERENCES adapter(id),
    assurance TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    config_snapshot_id UUID NOT NULL REFERENCES config_snapshot(id),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);
