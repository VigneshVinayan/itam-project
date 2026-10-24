# Department and Role Workflow Implementation

> Feature branch: `feature/departments-er-alignment`. Review and test against HANA before merging and deploying.

## Architecture

- `db/master.cds`: Departments, Employees, Categories, Vendors. Employees now reference Departments using `DEPARTMENT_NODE_KEY`.
- `db/schema.cds`: Assets (including `MANAGING_DEPARTMENT`), assignment and maintenance records, ownership ledger, archive, requests, PDF files and audit log.
- `srv/itam-service.cds`: OData services and allowed roles.
- `srv/admin-service.js`: administrative validations, maintenance and asset state transitions, immutable ledger protection.
- `srv/manager-lifecycle.js`: department-safe assignment, transfer, return and updates.
- `srv/manager-service.js`: manager row-level security, departmental dashboards, PDF reporting, request review.
- `srv/user-service.js`: user-only return / maintenance requests; does **not** directly mutate asset states.
- `app/`: Fiori Elements master-data apps and SAPUI5 custom workflows.

## Identity and permissions

Identity is read from XSUAA/mocked auth and linked to `master.Employees.EMAIL`.
Managers are scoped to `Employees.DEPARTMENT_NODE_KEY` and `Assets.MANAGING_DEPARTMENT_NODE_KEY`. The latter is intentional: an AVAILABLE asset has no current employee, and thus cannot be scoped safely by current holder alone.

| Feature | Admin | Manager | User |
|---|---|---|---|
| Employees CRUD and Departments CRUD/deactivate | Yes (referenced records guarded) | Read own department employees and reference departments | Read own profile only |
| Categories / Vendors | Manage | Read | No management |
| Assets | Create/read/edit; asset physical delete blocked by FR-011 | Read and edit asset name/location within department | Read assets assigned to self, without cost |
| Assign / transfer / return | Admin bound lifecycle actions | Department-scoped unbound lifecycle actions | Submit return request only |
| Assignment update | Active assignment PATCH (date, remarks) | Own-department active PATCH or action | View own assignments |
| Maintenance | Create/update and complete lifecycle | View and raise maintenance request | Raise maintenance request for own asset |
| Retirement / archive | Bound actions and immutable archival evidence | Read history as permitted | Read own history |
| Dashboard, PDF, download, email | Yes | Department scoped | Not permitted |
| Request approval/rejection | Yes | Requesting employee's department | Not permitted |

The `DELETE /Assets` operation deliberately returns 405: irreversible removal violates the existing archive/ledger protection. Use retirement and archive actions instead. Employee/category/department deletion is blocked when a protected relationship exists.

## Department model and filters

The Department entity has `NODE_KEY`, `NAME`, `COST_CENTER`, and `IS_ACTIVE`. Department names are required and checked for duplicates. Inactive departments cannot be chosen for new Employee associations; existing employees can be reassigned before department deletion.

Employee association: `DEPARTMENT : Association to Departments` (foreign key `DEPARTMENT_NODE_KEY`).
Asset accountability: `MANAGING_DEPARTMENT : Association to Departments` (foreign key `MANAGING_DEPARTMENT_NODE_KEY`).

Use standard OData `$filter` on Admin Employees and Assets, or the Fiori filter bar. Department is also accepted as a UUID argument on dashboard, report preview, export and email actions. Managers cannot override the signed-in department.

## OData example calls

All examples require an authenticated login. POST/PATCH additionally require a valid CSRF token when served through the approuter.

```http
GET /odata/v4/admin/Departments
GET /odata/v4/admin/Employees?$filter=DEPARTMENT_NODE_KEY eq 21000000-0000-4000-8000-000000000003
GET /odata/v4/manager/Assets?$filter=STATUS eq 'AVAILABLE'
GET /odata/v4/manager/getDashboard()
GET /odata/v4/manager/getDashboard(department=21000000-0000-4000-8000-000000000002)
GET /odata/v4/user/Employees
GET /odata/v4/user/AssetRequests
```

Manager actions (POST JSON; named operation, no direct ledger manipulation):

```http
POST /odata/v4/manager/assignAsset
Content-Type: application/json

{"asset":"<asset-uuid>","employee":"<employee-uuid>","expectedReturnDate":"2027-12-31","remarks":"New laptop"}
```

```http
POST /odata/v4/manager/transferAsset
Content-Type: application/json

{"asset":"<asset-uuid>","toEmployee":"<employee-uuid>","remarks":"Team handover"}
```

```http
POST /odata/v4/manager/returnAsset
Content-Type: application/json

{"asset":"<asset-uuid>","remarks":"Returned to inventory"}
```

```http
POST /odata/v4/manager/updateAssignment
Content-Type: application/json

{"assignment":"<assignment-uuid>","expectedReturnDate":"2027-12-31","remarks":"Extended"}
```

Users submit `POST /odata/v4/user/submitReturnRequest` or `submitMaintenanceRequest`, each with `{"asset":"<uuid>","description":"..."}`. Both require that the asset is currently assigned to the caller. Managers/Admins may `POST /odata/v4/manager/reviewAssetRequest` with `{"requestId":"<uuid>","approve":true,"note":"..." }`. An approved request remains a **request** until a lifecycle action executes; it does not silently return an asset.

## Fiori applications

- Admin: **Departments** Fiori Elements application, alongside Employees, Assets, Categories and Vendors.
- Manager/Admin: **Department Operations** for assigning, transferring, returning and editing assets; maintenance request submission and request review.
- User: **My Profile**, **My Assignments**, **My Asset History**, and **Asset Requests** for maintenance and return intake.
- Manager/Admin: existing Dashboard and Reports & Export continue to work, with Manager data scoped to accountable department.

## HANA deployment and data migration (important)

This release includes **breaking persistence changes**. Do **not** deploy directly to a database with valuable records using a destructive reset. Use a staging copy and a verified backup/restore plan.

1. Back up/export Departments (if already independently present), Employees, Assets, AssetAssignments, MaintenanceRecords, ArchiveRecords, ownership ledger and report tables. Record row counts.
2. Create/load department rows with stable UUIDs and correct cost centres. Use the same source values as the old Employee text `DEPARTMENT` column.
3. Populate new `DEPARTMENT_NODE_KEY` for every Employee by matching the old text value to the department's NAME. Verify that no previously assigned department maps to NULL.
4. Populate `MANAGING_DEPARTMENT_NODE_KEY` for each Asset based on the accountable department. This is **not always the department of its current holder**; make an explicit decision for available, retired and archived assets.
5. Migrate old Maintenance `ISSUE` -> `DESCRIPTION`, `RESOLUTION` -> `OUTCOME`, and Archive `COMPLIANCE_REFERENCE` -> `DISPOSAL_CERT_NO`, preserving historical values.
6. Add nullable `ASSIGNED_BY_NODE_KEY` and `REPORTED_BY_NODE_KEY` for old records, plus `COST`, `COVERED_BY_WARRANTY`, `NEXT_DUE_DATE`; historical actor values may remain NULL when unknowable.
7. Deploy new request table and service model. Compare pre/post row counts and validate association joins, old ledger immutability and reporting.
8. Test mocked roles and actual XSUAA role collections on BTP. In HANA, inspect generated HDI artifacts before writing migration SQL; physical table/column quoting and names may differ from CDS identifiers.

For SQL inspection, use `npx cds compile db --to sql --dialect hana` and `npx cds build --production`, reviewing generated database artifacts. A production-specific migration script is **not included** because the current production data and HDI layout were not available; do not assume initial seed CSV deployment migrates existing HANA rows.

## Validation

The branch contains `.github/workflows/validate.yml`, which runs `npm ci`, `npx cds compile srv/itam-service.cds` and `npm test` with Node.js 22 on pull requests. Tests include authorization isolation, departmental operations, request approval, lifecycle history, report generation and direct maintenance updates. Browser/UI smoke testing and a real XSUAA/HANA integration test remain necessary before production deployment.

## Boundaries and follow-up

- Request approval is administrative acknowledgement, not automatic lifecycle completion.
- Managers may update only fields explicitly permitted by their API; do not expose arbitrary ledger/asset status edits.
- Real HANA backfill, UI browser testing, CI/CD release gating and performance/load tests must be completed with the target deployment.
