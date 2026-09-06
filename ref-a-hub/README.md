# REF-A Operations Hub

Production-oriented Manufacturing Operations System for Final Assembly & Packaging.

## Scope
Production, Quality, SPC, Critical Process Control, Manpower, Materials, Downtime/Losses, Checklists/LPA, CAPA, Root Cause Analysis, SOPs, Reports, KPI analytics and auditability.

## Implementation status
- Foundation architecture: complete
- Relational PostgreSQL model blueprint: complete
- Application shell: in progress
- Production database integration: pending environment credentials
- Authentication/RBAC: in progress
- Shop-floor workflows: in progress

## Data integrity principles
- No fabricated factory standards.
- Server-side validation for operational transactions.
- Protected operational history uses void/soft-delete semantics.
- Analytics must trace back to persisted source records.
- Control limits and specification limits are separate concepts.
- Demo data is explicitly marked.

## Deployment
The application is intended to run as a TypeScript web application backed by PostgreSQL/Supabase. Production secrets must be provided through environment variables; never commit credentials.
