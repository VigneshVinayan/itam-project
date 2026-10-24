# IT Asset Lifecycle Manager – SAP CAP + SAP HANA Cloud + SAP Fiori (UI5) + XSUAA

Tracks IT hardware from procurement to archival, built with the SAP Cloud Application Programming Model (Node.js).
Requirements: [`IT_Asset_Lifecycle_Manager_Functional_Requirements_v1_1 1 (1).docx`](<IT_Asset_Lifecycle_Manager_Functional_Requirements_v1_1 1 (1).docx>) (FRD v1.1).

## Problem → Solution

| Problem (FRD executive summary)                         | How this project solves it |
|---------------------------------------------------------|----------------------------|
| Assets are **misplaced**, nobody knows who has what      | Every asset has a status (`AVAILABLE → ASSIGNED → MAINTENANCE → RETIRED → ARCHIVED`) and a current holder; inventory search by tag, serial, category, status, owner, vendor, location |
| Assets are **transferred without tracking**              | `assignAsset` / `transferAsset` / `returnAsset` close and open possession periods (`AssetAssignments`) and write the **immutable ownership ledger** |
| Assets are **not returned during offboarding**           | An employee holding assets **cannot be deactivated**; overdue returns are a dashboard KPI |
| Assets are **retired without ownership history**         | Retirement needs a reason; archival only for retired, returned assets; **no physical delete** – ledger and archive rows are protected on the database service |
| Management has **no visibility**                         | Dashboard with KPI tiles and charts (status, category, location) + PDF reports that can be downloaded or e-mailed, all with the same filters |

## Data model

```
Departments ──< Employees          Departments ──< Assets (managing department)
AssetCategories ──< Assets >── Vendors
                      │  └──── CURRENT_HOLDER ──> Employees
                      ├──< AssetAssignments >── Employees        (one row per possession period)
                      ├──< OwnershipLedgers                      (immutable: CREATED, ASSIGNED, TRANSFERRED, RETURNED,
                      │                                           MAINTENANCE_STARTED/COMPLETED, RETIRED, ARCHIVED)
                      ├──< MaintenanceRecords >── Vendors
                      └──< ArchiveRecords
ReportFiles (generated PDFs, time-limited)      ReportLogs (audit of export / download / e-mail)
```

| File | Content |
|---|---|
| `db/common.cds` | reusable types and status enums |
| `db/master.cds` | `context master`: **Departments**, **Employees** (department association), **AssetCategories** (lifespan, active flag), **Vendors**; `context codes`: drop-down code lists |
| `db/schema.cds` | `context transaction`: **Assets**, **AssetAssignments**, **OwnershipLedgers**, **MaintenanceRecords**, **ArchiveRecords**; `context reporting`: **ReportFiles**, **ReportLogs** |

Same conventions as [saurabh-1907/project1-sprint](https://github.com/saurabh-1907/project1-sprint/tree/feature/psa-cap-backend):
keys are `key NODE_KEY : common.Guid`, fields are UPPERCASE, CSV files are named `itam.db-master.*.csv` / `itam.db-transaction.*.csv`.

## Technology

Only SAP technology is used:

| Layer | Technology |
|---|---|
| Database | **SAP HANA Cloud** (HDI container, plan `hdi-shared`) |
| Backend | **SAP CAP** (Node.js), OData V4 |
| UI | **SAP Fiori Elements** apps + 2 freestyle **SAPUI5** apps (dashboard, reports) in a **SAP Fiori launchpad** (sandbox) |
| Login / roles | **XSUAA** (plan `application`) + **SAP Approuter** |
| PDF | small built-in PDF writer (`srv/lib/pdf.js`) – no third-party library |

(SQLite is only a dev-dependency so that `npm test` / `cds watch` run without HANA.)

## Services (FRD: Service Layer)

| Service | Path | Role | Content |
|---|---|---|---|
| `AssetAdminService` | `/odata/v4/admin` | Admin | Assets (+ lifecycle actions), Employees, Categories, Vendors, Assignments, History, Maintenance, Archive, ReportLogs |
| `AssetManagerService` | `/odata/v4/manager` | Manager, Admin | department-scoped assets, assignment updates and lifecycle actions, maintenance requests/approval, history, dashboard, preview/PDF/e-mail/download |
| `AssetUserService` | `/odata/v4/user` | User | own assigned assets (no costs), own assignments/history/profile, submit return and maintenance requests |
| `AppService` | `/odata/v4/app` | any login | `whoAmI()`, `tileKpis()` for the launchpad |

### Lifecycle actions (bound to `Assets`, Admin)

| Action | Allowed from | Rules |
|---|---|---|
| `assignAsset(employee, distributionDate, expectedReturnDate, remarks)` | AVAILABLE | employee ACTIVE; **distribution date ≥ procurement date** (FR-004); first distribution date is kept |
| `transferAsset(toEmployee, transferDate, remarks)` | ASSIGNED | old assignment `TRANSFERRED`, new one `ACTIVE`, holder changes |
| `returnAsset(returnDate, remarks)` | ASSIGNED | assignment `RETURNED`, holder cleared, `AVAILABLE` |
| `sendToMaintenance(vendor, type, issue, reportedDate)` | AVAILABLE | active vendor; open maintenance record |
| `completeMaintenance(completedDate, resolution)` | MAINTENANCE | record `COMPLETED`, asset `AVAILABLE` |
| `retireAsset(reason, retiredDate, condition, disposalMethod)` | AVAILABLE | **assigned assets are rejected** (FR-010) |
| `archiveAsset(reason, complianceReference)` | RETIRED | **rejected while assigned** (FR-012); archive record, no delete (FR-011) |

Every action writes one ledger row (actor = login e-mail). Transition dates cannot be in the future or before the
asset's last ledger event. Ledger and archive rows reject UPDATE / DELETE on the database service (FR-007).

## Users and roles (XSUAA)

| Role collection | Role | Launchpad tiles | Can do |
|---|---|---|---|
| **ITAM_Admin** | Admin | Asset Dashboard, Reports & Export, Manage Assets, Employees, Asset Categories, Vendors, Report Audit Log | lifecycle + master data, dashboard, reports |
| **ITAM_Manager** | Manager | Dashboard, Reports & Export, Asset Overview, Department Operations | manage departmental assets (details, assign, transfer, return), maintain assignments, submit/review requests, department-only reporting |
| **ITAM_User** | User | My Hardware, My Assignments, My Asset History, My Profile, Asset Requests | read own profile/assets/history, submit own return/maintenance requests |

The login e-mail links a user to an **Employee** (`Employees.EMAIL`). `…/odata/v4/app/whoAmI()` shows login, roles and linked employee.

## Fiori apps (FRD: Fiori UI Requirements)

| App | Template | What you do there |
|---|---|---|
| **Manage Assets** | List Report + Object Page (draft) | create / edit assets; header with status, holder, first distribution; facets General · Procurement · Current State · Assignments · Maintenance · History · Retirement/Archive; buttons **Assign, Transfer, Return, Send to Maintenance, Complete Maintenance, Retire, Archive** (enabled only when allowed) |
| **Asset Dashboard** | SAPUI5 (analytical) | filters (status, category, location, procurement date); KPI tiles (total, utilisation, available, overdue returns, open maintenance, end-of-life soon, asset value); donut / bar charts with labels and values; **table with the same numbers** (NFR-011); drill-down to the asset list |
| **Reports & Export** | SAPUI5 | report (inventory, assignments, maintenance, lifecycle history) + same filters → **Preview**, **Export PDF**, **Download PDF**, **E-Mail PDF** with success / failure message |
| **Asset Overview** | List Report + Object Page | manager view of department assets, assignments, maintenance, history; use Department Operations for lifecycle writes |
| **Departments**, **Employees**, **Asset Categories**, **Vendors** | List Report + Object Page (draft) | master data; inactive departments/categories/vendors are not selectable for new associations |
| **Report Audit Log** | List Report | who exported / downloaded / e-mailed which report, filters, recipients, outcome |
| **Hardware Inventory**, **My Assignments**, **My Asset History** | List Report + Object Page (read-only) | user views |

All labels come from `_i18n/i18n.properties` (FR-019); apps run on desktop, tablet and phone (FR-020).

## Reports, PDF and e-mail (FR-022 … FR-026)

- The PDF has the report title, generation time, requester, the **applied filters**, a labelled bar chart and all
  filtered rows (A4 landscape, paged). Limit 5,000 rows – larger reports are refused with a clear message (NFR-008).
- **Download** link: `/odata/v4/manager/ReportFiles(<id>)/CONTENT` – only the requester can open it, valid for 15 minutes (NFR-010).
- **E-mail**: recipients are validated (max 10). Each request carries a `requestId`; sending the same id again returns
  `DUPLICATE` and does not send a second mail. A delivery failure returns `FAILED` (and is logged) so it can be retried (NFR-009).
- Delivery: with a `mail-api` service in `cds.requires` (an HTTP mail / notification API behind a BTP Destination) the
  PDF is POSTed there as base64 attachment. **Without it (local, tests) the mail is only logged** – see `srv/mail-service.js`.
- **Audit**: every export / download / e-mail is written to `ReportLogs` (user, time, report, filters, recipients, rows, outcome) – never the report contents (NFR-012).

## Project structure

```
db/                      data model + sample data (db/data/*.csv)
srv/itam-service.cds     OData V4 services (roles, drafts, actions)
srv/admin-service.js     lifecycle + master-data rules, immutable ledger guard
srv/manager-service.js   dashboard, report preview / PDF export / download / e-mail, audit log
srv/app-service.js       whoAmI + launchpad KPIs
srv/mail-service.js      e-mail delivery (mail-api via destination, or log only)
srv/lib/                 pdf.js (PDF writer), reports.js (filters, KPIs, report definitions), util.js
app/index.html           SAP Fiori launchpad (sandbox), tiles by role
app/annotations.cds      Fiori Elements UI annotations
app/<name>/webapp        Fiori apps incl. departments, manageractions, myrequests, myprofile
_i18n/i18n.properties    UI texts
.deploy/app-router       SAP Approuter (XSUAA login)
xs-security.json         XSUAA roles + role collections ITAM_Admin / ITAM_Manager / ITAM_User
mta.yaml                 Cloud Foundry deployment
test/itam.test.js        automated regression and role-workflow tests (npm test)
```

> **Step-by-step guide:** [docs/BAS_RUN_AND_DEPLOY.md](docs/BAS_RUN_AND_DEPLOY.md) covers prerequisites and entitlements,
> SAP Business Application Studio (local and hybrid), Cloud Foundry deployment, role assignment and troubleshooting.

## Run locally (no BTP needed)

```bash
npm install
npx cds watch          # http://localhost:4004/index.html
```

Log in with a mocked user (`package.json`, profile `development`):

| User | Password | Role |
|---|---|---|
| `admin@itam-demo.com` | `admin` | Admin |
| `manager@itam-demo.com` | `manager` | Manager |
| `ravi.kumar@itam-demo.com` | `user` | User |

## Run in SAP Business Application Studio (hybrid: SAP HANA Cloud + XSUAA)

```bash
cf login
cf create-service xsuaa application itam-hybrid-auth -c xs-security.json
cds bind auth --to itam-hybrid-auth
cds build --production
cds deploy --to hana
cds watch --profile hybrid
# second terminal, from the project root:
npm install --prefix .deploy/app-router
cds bind --exec --profile hybrid -- npm start --prefix .deploy/app-router
```

Open port **5000** → SAP login → launchpad. Assign **ITAM_Admin / ITAM_Manager / ITAM_User** in the BTP cockpit
(Security → Users) and create an Employee with the same e-mail as the login (or put it into `db/data/itam.db-master.Employees.csv`).

## Deploy to Cloud Foundry

```bash
npm install
cf login
mbt build                                       # mta_archives/itam-application_1.0.0.mtar
cf deploy mta_archives/itam-application_1.0.0.mtar
```

Creates the HDI container `itam-application-db`, XSUAA `itam-application-auth`, the CAP server `itam-application-srv`
and the approuter `itam-application` (its URL is the app link). Role collections: **ITAM_Admin / ITAM_Manager / ITAM_User (org-space)**.

## Tests

`npm test` – integration tests on an in-memory database with test logins (no HANA / XSUAA needed): roles and record-level
access, every lifecycle rule (FR-001 … FR-012), immutable ledger (OData and database), offboarding check, dashboard KPIs
and filters, report preview, PDF content, download ownership + expiry, e-mail validation / idempotency / failure + retry,
and the audit log.

## Departments and role-workflow changes

The `feature/departments-er-alignment` branch adds `Departments`, a managed asset department (so available assets can be assigned by department), and an `AssetRequests` workflow. All role-specific OData actions and new Fiori tiles are documented in [Department/Roles/HANA migration guide](docs/DEPARTMENTS_ROLES_AND_HANA_MIGRATION.md). Existing HANA data needs a non-destructive migration before deployment. The feature branch is validated by GitHub Actions (CDS compile and CAP tests). User requests create reviewable records; approval does not execute the asset lifecycle transition automatically. Physical asset deletion remains forbidden under FR-011.

## Not covered (see FRD)

- **INT-01 … INT-04** and the **S4HANA_PROD / S4HANA_QAS** destinations (purchase orders, goods receipts, invoice PDFs to DIM,
  vendor notifications) describe an invoice process and are not part of the asset scope above – to be confirmed with the business owner.
- Generated PDFs are stored in HANA (`ReportFiles`) instead of SAP Document Information Management.
- CI/CD pipeline (NFR-006), load / availability targets (NFR-001 … NFR-003) and the `ind1` data-residency region (NFR-005) are deployment settings.
