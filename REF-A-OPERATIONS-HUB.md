# REF-A Operations Hub

## Purpose
Production-grade operating system for the Final Assembly & Packaging department of a refrigerator factory.

## Target capabilities
- Executive Control Tower
- Production plan and hourly production
- Defects, scrap, rework and quality analytics
- Critical process controls and SPC/control charts
- Checklists and LPA
- Manpower, attendance, skills and station assignment
- Materials, consumption, returns and standard-vs-actual variance
- Downtime and loss analysis
- KPI/OEE-style analytics
- SOP/work-instruction/version control
- CAPA and structured root-cause analysis
- Reports and exports
- Master data/configuration
- Audit trail and role-based permissions

## Architecture principles
1. Transactional data is persisted in a normalized relational database.
2. Master data, transactions, configuration and analytical views are separated.
3. Production, quality, manpower, materials, downtime, audits and CAPA share common business keys and references.
4. No factory-specific limits or standards are fabricated; missing configuration is represented explicitly as N/A.
5. Operational records use immutable history/audit patterns rather than destructive deletion.
6. The system is Arabic-first (RTL), responsive, and optimized for shop-floor data entry.

## Core entities
organization, department, line, area, station, process, model, shift, calendar, employee, role, permission, production_plan, production_hour, defect, defect_event, test_definition, test_result, critical_control_point, critical_check, control_chart, checklist_template, checklist_item, checklist_run, checklist_response, material, material_standard, material_transaction, return_transaction, downtime_event, loss_reason, document, document_revision, document_acknowledgement, problem_record, five_why, fishbone_cause, capa_action, kpi_definition, kpi_snapshot, alert, audit_log.

## Initial operating assumptions
- Department: Final Assembly & Packaging
- One configurable production line
- Two configurable shifts
- Demo Shift 1: 07:30–15:30
- Shift 2 remains configurable
- Final Assembly & Packaging includes configurable product tests

## Production readiness requirements
- Authentication and RBAC
- Row-level security where supported
- Input validation and database constraints
- Server-side persistence for core transactions
- Audit logging for critical mutations
- Pagination/filtering for historical records
- Print-ready operational reports
- CSV/XLSX export hooks
- Responsive tablet/mobile workflows
- Seeded DEMO dataset clearly separated from real data
