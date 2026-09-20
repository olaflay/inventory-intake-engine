---
name: owasp-api-audit
description: Audits engine and adapter API endpoints against the OWASP API Security Top 10 checklist before staging and production deployments.
---

# OWASP API Security Audit Skill

## Purpose
Systematically reviews engine API routes, adapter webhooks, and data handling against OWASP API Security Top 10 standards to guarantee zero vulnerabilities above Low severity.

## When to Invoke
- Prior to deploying staging or production builds (Gate 10).
- Whenever authentication, adapter keys, or webhook endpoints are modified.

## Checklist
1. **API1 (Broken Object Level Authorization)**: Verify that users can only view assets/submissions authorized by their role in `config_snapshot`.
2. **API2 (Broken Authentication)**: Verify hashed adapter keys, pepper rotation, and secret-token verification on webhooks.
3. **API3 (Broken Object Property Level Authorization)**: Ensure unmapped or private properties are not leaked in responses.
4. **API4 (Unrestricted Resource Consumption)**: Verify rate limits (1 msg/sec on Telegram), pixel limits (40MP), and submission file caps (10 files).
5. **API5 (Broken Function Level Authorization)**: Verify that administrative endpoints (config reload, import commit) strictly require Admin permissions and dual control.
6. **API7 (Server-Side Request Forgery)**: Verify that the engine NEVER fetches URLs found inside uploaded documents.
7. **API8 (Security Misconfiguration)**: Verify TLS enforcement, no stack traces leaked in error envelopes, environment secrets not checked into git.

## Expected Output
A signed security review artifact confirming zero findings above Low severity.
