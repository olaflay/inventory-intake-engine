# Runbook: Dead-Letter Queue (DLQ) Drainage & Job Reprocessing

**PRD Reference:** PRD §28 (Retry, timeouts and dead letters), §30 (Operations, health and telemetry), §45.  
**Audience:** Site Reliability Engineer / Engine Operator.

---

## 1. Overview
The Dead-Letter Queue (DLQ) isolates jobs and outbox deliveries that have failed repeatedly and exhausted their configured retry ceiling (default 3–5 attempts). Jobs in the DLQ do not block other queue items.

---

## 2. Notification & Triage
When a job enters the DLQ, an event is emitted:
- **Event:** `job.dead_lettered`
- **Audience:** `["admin"]`
- **Payload:** `deadLetterId`, `jobType`, `error`, `attempts`, `submissionId`

---

## 3. Inspection & Diagnosis Procedure

### 3.1: Check DLQ Status
Query the engine API or inspect via CLI:
```bash
node dist/cli.js dlq list
```
Review the list of entries with status `pending_review`.

### 3.2: Common Failure Causes & Remediations
1. **Third-Party Service Outage (AI Provider / Object Storage):**
   * *Diagnosis:* Error indicates `503 Service Unavailable` or connection timeout.
   * *Remediation:* Confirm external service recovery before triggering replay.
2. **Malformed External Document Payload:**
   * *Diagnosis:* Error indicates unparseable attachment or corrupt magic bytes.
   * *Remediation:* Inspect submission file in storage; contact sender to resend uncorrupted copy.
3. **Webhook Endpoint 5xx Failures:**
   * *Diagnosis:* Downstream listener unreachable.
   * *Remediation:* Verify receiver container is up, then replay webhook.

---

## 4. Replay Procedure
Once the root cause is resolved:
```bash
# Replay specific job by ID
node dist/cli.js dlq replay --id <dead-letter-uuid>

# Or replay all pending items
node dist/cli.js dlq replay --all
```
Verify that the entry status transitions to `replayed` and the underlying transaction posts successfully.
