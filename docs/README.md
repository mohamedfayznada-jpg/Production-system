# REF-A Operations Hub

A production-oriented Manufacturing Operations System for Final Assembly & Packaging.

## Current repository state
This repository contains the legacy Production-system implementation plus the REF-A Operations Hub architecture documents. The REF-A build is being developed on `feat/ref-a-operations-hub` so the existing `main` branch remains untouched while the new system is implemented and validated.

## Production data policy
Never place real employee, production, quality, customer, or material data in source code. Use database seed data only for clearly marked DEMO records. Production secrets must be supplied through environment configuration.

## Production readiness gates
Before merging to `main`, verify:
- authenticated access works;
- permissions are enforced in the backend/data layer;
- transactional records persist in PostgreSQL/Supabase;
- operational history is auditable;
- no destructive delete is available for protected operational records;
- KPIs are computed from persisted source data and use configured definitions;
- SPC charts distinguish control limits from specification limits;
- exports and print reports work on filtered datasets;
- mobile/tablet entry works for shop-floor workflows;
- database migrations are reproducible;
- backup/recovery procedure is documented;
- demo records are isolated from production records.

## Recommended deployment shape
Frontend: TypeScript + React application.

Data: PostgreSQL/Supabase with migrations, indexes, constraints, RLS, and audit tables.

Operational analytics: SQL views/materialized views or server-side aggregation for high-volume histories. Avoid loading entire historical tables into the browser.

## Domain scope
Production, Quality, Critical Process Control, SPC, Checklists/LPA, Manpower, Materials, Returns, Downtime/Losses, KPI Analytics, SOP/Work Instructions, CAPA, Root Cause Analysis, Reporting, Master Data and Governance.
