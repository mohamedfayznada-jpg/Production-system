# REF-A Operations Hub — Implementation Roadmap

## Phase 0 — Foundation
- Modern TypeScript application shell
- Environment configuration
- Supabase/PostgreSQL connection
- Authentication
- Role/permission model
- Global filters and navigation
- Error boundaries, loading and empty states

## Phase 1 — Operational Transactions
- Shifts and calendars
- Production plan
- Hourly production
- Defect/event capture
- Downtime/loss capture
- Manpower attendance and allocation
- Material issue/consumption/return
- Critical process checks
- Checklist execution

## Phase 2 — Analysis & Control
- Production attainment
- Yield / defect / scrap / rework analytics
- Pareto analysis
- Downtime analysis
- Standard-vs-actual material variance
- SPC data pipeline
- Xbar-R / I-MR / attribute chart support
- Exception and alert engine

## Phase 3 — Problem Solving & Governance
- CAPA
- 5 Why
- Fishbone
- SOP/work instruction revisions
- Approval workflows
- Audit trail
- Evidence attachments

## Phase 4 — Management & Scale
- Management reports
- Export/print
- Saved views
- Historical analytics
- Performance optimization
- Archival/retention strategy
- Backup/recovery documentation
- Production deployment hardening

## Non-negotiable quality gates
- No hard-coded production KPI numbers used as real standards.
- No destructive delete for operational history.
- All critical transactions validated server-side.
- Analytical charts trace back to stored source records.
- Permissions enforced in the data layer, not only hidden in UI.
- Demo data clearly marked and isolated from production data.
