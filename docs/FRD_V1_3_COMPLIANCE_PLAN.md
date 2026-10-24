# FRD v1.3 compliance work plan and regression gate

Source: `TEAM_3 IT_Asset_Lifecycle_Manager_Functional_Requirements_v1_3.docx` (15-Oct-2026).
Baseline: `feature/departments-er-alignment`.
Work branch: `feature/frd-v1.3-compliance`.

## Change-control rules

- Preserve existing Admin, Manager and User pages. **Do not hide Department Operations from Admin.**
- Do not implement or modify the proposed Employee → Manager → Admin two-level request workflow without explicit authorization.
- No automatic HANA schema changes or `cds deploy --to hana` against existing data. Back up and inspect migration/backfill first.
- Keep functional changes small. Run compilation, tests, and affected-page checks after each group.
- Never claim runtime completion based solely on GitHub CI; BAS/HANA, XSUAA, email and BTP acceptance need independent verification.

## FRD checklist

| FRD | Scope | Initial finding | Acceptance gate |
|---|---|---|---|
| FR-001–006 | Asset create, assign, dates, transfer, return | Implemented in CAP with tests | HANA end-to-end and Fiori workflows |
| FR-007–012 | Immutable ledger, maintenance, retirement, archive | Implemented in CAP with tests | HANA mutation-denial and lifecycle tests |
| FR-013–015, FR-025 | Role isolation and permitted history | CAP role rules present | Real XSUAA role tests, including negative requests |
| FR-016–018 | Category, vendor, search and filter | Implemented in part | All specified filters and inactive-selection rules in UI |
| FR-019 | English i18n | Mixed i18n and hardcoded UI strings | Inspect each custom UI; localize exposed strings |
| FR-020 | Responsive UI | Responsive controls used | Desktop and tablet manual visual tests |
| FR-021, FR-026 | KPI visuals and consistent filters | Dashboard + shared report filters exist | Authorized manager scoping, drill-down and filter parity tests |
| FR-022–024 | PDF export, email, download | Export/download implemented; email simulated without provider | Real PDF integrity and real email delivery |
| FR-027–028 | Department maintenance and filtering | Entities/services/UI present | Active department value helps, join and role tests |
| INT-01 | S/4HANA OData v2 PO/GR polling | Not found | Destination, scheduler, ingestion and integration tests |
| INT-02 | Invoice PDF to DIM | Not found | Document service integration test |
| INT-03 | Invoice status to S/4HANA | Not found | Action and integration test |
| INT-04 | Vendor notification | Not found | Notification service and delivery test |
| INT-05 | Report mail notification | Abstraction only | Configured provider, outcomes, retries, audit |
| NFR-001–003,007–008 | Response/load/availability/export SLOs | Not established | Measured 95p and 200-user test; 5k-row 10s PDF test |
| NFR-004–005 | Seven-year invoice retention, DPDP ind1 | Not established | Retention policy and region/compliance evidence |
| NFR-006 | SAP CI/CD | GitHub Actions exists, SAP CI/CD not demonstrated | Build/release deployment evidence |
| NFR-009–012 | Mail reliability, download security, accessibility, audit | Partial implementation | Real integration/security/accessibility testing |
| BTP hosting | XSUAA, HANA, HTML5 repo, destination, DIM, logging | MTA has srv/hdb/approuter/XSUAA; other resources absent | CF deployment audit and service binding checks |

## Safe implementation sequence

1. **Baseline**: record present config and CI state; verify there are no undocumented pending BAS-only changes.
2. **Low-risk**: localized UI labels, readable identifiers, validation messages and non-invasive Fiori annotations, with regression tests.
3. **Medium-risk**: report-email provider integration behind opt-in configuration; test fallback and failures without exposing reports.
4. **Separate external integrations**: S/4HANA, DIM and Notification Service, subject to access to destination specifications and business mapping. Do not fake successful integration.
5. **Higher-risk deployment/security**: XSUAA, HTML5 application repository, destinations and SAP CI/CD in a separate environment.
6. **HANA migration**: review generated schema, plan backfill, take backup, run tests, then request explicit production migration approval.
7. **Acceptance**: execute Admin/Manager/User journeys and NFR measurement against target BTP environments.

## Minimum regression scenarios

- Admin: CRUD Departments / Employees / Categories / Vendors; Employee Department dropdown and displayed department names.
- Admin: create asset, assign, transfer, return, maintenance start/complete, retire/archive, immutable history and report audit.
- Manager: own-department assets only, existing Department Operations tab behaviors, request review without implicit lifecycle mutation; deny cross-department operations.
- User: My Hardware, Assignments, Profile, History, Return/Maintenance Requests, request status/details; deny another employee's records.
- Reports: dashboard filter parity, preview, export, download, expiration, unauthorized downloads, e-mail simulation vs actual delivery and retry.
- Authentication: separate Admin, Manager and User identities; hybrid mocked vs deployed XSUAA clearly separated.
- UI: desktop/tablet view, readable names instead of UUIDs, accessibility and localization.

## Open scope decisions (not coded yet)

- Clarify Manager operational write permissions: FR-025 emphasizes explicitly permitted operations, with read-only language in some passages.
- Confirm external PO/invoice/DIM requirements against FRD's exclusion of a full procurement approval workflow.
- Confirm production target BTP subaccount/region, retention and provider arrangements before binding services.
