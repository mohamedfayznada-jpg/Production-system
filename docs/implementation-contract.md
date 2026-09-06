# REF-A Operations Hub — Implementation Contract

## Product contract
The application is the operating system for Final Assembly & Packaging. It must optimize three things simultaneously: fast shop-floor execution, reliable historical data, and managerial decision support.

## Data integrity contract
- Every transactional record has a timestamp and actor.
- Transactions reference configured master data where applicable.
- Quantities are non-negative unless a transaction type explicitly represents a reversal.
- Historical records are never hard-deleted.
- Corrections create an auditable correction/reversal event.
- Date, shift, model, line and station dimensions are preserved for analytics.
- Source records remain traceable from every KPI/chart/report point.

## KPI contract
A KPI is a configured definition with formula, unit, aggregation, scope and applicability. The UI must never silently substitute an invented standard. Missing inputs or configuration yield N/A.

## SPC contract
Control limits are statistically derived or configured according to the selected chart method. Specification limits are engineering/business limits. They must be stored and rendered separately. A process may be statistically stable and still be out of specification, or unstable while all current points remain within specification limits.

## Security contract
- Authentication required for protected application routes.
- Authorization enforced in backend/data policies, not by UI visibility alone.
- Sensitive configuration and master-data changes restricted to authorized roles.
- Audit history available to authorized management/audit roles.

## UX contract
### Manager
The home/control-tower page surfaces exceptions first and supports drill-down to evidence in a few interactions.

### Supervisor
Hourly production, defect, downtime and critical-check capture should use compact, keyboard-friendly forms and sensible defaults.

### Quality
A defect should flow directly into containment, root-cause analysis and CAPA without redundant re-entry.

### Engineering
Critical characteristics, specifications, measurement rules and reaction plans are configurable without source-code changes.

## Production readiness
A release is not production-ready until automated/manual verification confirms authentication, authorization, persistence, transaction validation, auditability, analytics correctness, mobile/tablet workflows, export/print, database migration reproducibility and backup/recovery documentation.
