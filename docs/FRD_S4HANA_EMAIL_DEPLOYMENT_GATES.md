# FRD v1.3 — scoped release through S/4HANA integrations

This branch preserves `feature/departments-er-alignment` and does not modify
the experimental two-level Employee → Manager → Admin approval process.

## FRD alignment

- **Asset, employee, department, category, vendor and lifecycle CRUD (FR-001–018,
  027–028)**: Existing CAP endpoints and regression tests are retained.
- **Role access (FR-013–015, 025)**: CAP authorization is already implemented.
  Real XSUAA / SAP BTP role-collection validation is still required. Avoid using
  the default `auth: dummy` profile for production.
- **Dashboard + PDF reports (FR-021–026)**: Existing dashboard/report APIs and
  PDF authorization tests retained. Real-world 5,000-row and browser verification
  are still required.
- **Email (FR-023/INT-05)**: Existing `mail-api` connector supports a configured
  REST mail provider. Without one it returns **SIMULATED** (never delivered).
  To enable real delivery, configure a BTP Destination and a named CAP remote
  service `cds.requires.mail-api` in deployment-specific configuration, then
  bind the Destination service and test provider-specific payload/response.
  Do **not** embed mail service credentials in the repository.
- **S/4HANA (INT-01)**: `srv/integrations/s4hana.js` adds an opt-in read-only
  OData V2 PO/GR client with bounded paging, accompanied by isolated tests.
  This is not a deployed 15-minute ingestion job.

## What is required to turn INT-01 into a working integration

1. Obtain an accessible S/4HANA system and BTP Destination
   (`S4HANA_QAS` first). Confirm the exact OData V2 services, entity-set
   names, scopes and service-user authorization.
2. Configure a named CAP remote service `s4hana` using the approved
   destination. Do not commit passwords or service keys.
3. Call `previewS4Purchasing({ cds, purchaseOrderEntitySet, goodsReceiptEntitySet })`
   with the system's approved relative entity-set paths and validate the data.
   Note: this reader refuses absolute `__next` URLs until the target host
   and continuation policy are explicitly approved.
4. Agree on fields, identifiers, incremental watermark, reconciliation rules,
   retries and idempotency for PO/GR synchronization.
5. Implement a separate background job at 15-minute cadence in a suitable
   BTP scheduler / Job Scheduling service. Do not run uncontrolled timers
   inside every CAP web-app instance.
6. Add HANA staging or audited upsert logic **only after** approval of the
   mapping and safe migration plan; test on QAS before production.

## What is deliberately not claimed as completed

- Actual BTP role assignments and XSUAA SSO.
- Real mail service and secure PDF delivery with provider acceptance.
- S/4HANA production connectivity, 15-minute scheduler, PO/GR persistence.
- FRD INT-02/03/04 (DIM, invoice status, vendor notification).
- NFR performance, availability, data-residency and security acceptance.

The existing CAP tests and the new connector tests are automated checks,
not substitutes for the above environment-dependent acceptance evidence.
