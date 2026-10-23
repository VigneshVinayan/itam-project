namespace itam.db;

using { managed } from '@sap/cds/common';
using { itam.common as common } from './common';
using { itam.db.master } from './master';

// Asset -> Assignments (who had it, when)
//       -> OwnershipLedgers (immutable lifecycle history)
//       -> MaintenanceRecords
//       -> ArchiveRecords (retirement / disposal evidence)

context transaction {

    entity Assets : managed {

        key NODE_KEY : common.Guid;

        ASSET_TAG     : common.String32;      // unique
        SERIAL_NUMBER : common.String64;      // unique
        ASSET_NAME    : common.String255;     // make / model
        LOCATION      : common.String64;

        // procurement
        PURCHASE_DATE : Date;
        PURCHASE_COST : common.AmountT;
        CURRENCY_CODE : String(3) default 'INR';
        WARRANTY_END  : Date;

        // current state (maintained by the lifecycle actions only)
        STATUS                  : common.AssetStatus default 'AVAILABLE';
        FIRST_DISTRIBUTION_DATE : Date;

        // retirement
        RETIRED_DATE      : Date;
        RETIREMENT_REASON : common.String255;
        CONDITION         : common.String64;
        DISPOSAL_METHOD   : common.DisposalMethod;

        // Department accountable for this asset, including while AVAILABLE.
        MANAGING_DEPARTMENT : Association to master.Departments;
        CATEGORY       : Association to master.AssetCategories;
        VENDOR         : Association to master.Vendors;
        CURRENT_HOLDER : Association to master.Employees;

        ASSIGNMENTS : Association to many AssetAssignments
                      on ASSIGNMENTS.ASSET = $self;

        HISTORY : Association to many OwnershipLedgers
                  on HISTORY.ASSET = $self;

        MAINTENANCE : Association to many MaintenanceRecords
                      on MAINTENANCE.ASSET = $self;

        ARCHIVE : Association to many ArchiveRecords
                  on ARCHIVE.ASSET = $self;
    }

    // One possession period of an asset
    entity AssetAssignments {

        key NODE_KEY : common.Guid;

        ASSIGNED_DATE        : Date;
        EXPECTED_RETURN_DATE : Date;
        ACTUAL_RETURN_DATE   : Date;
        ASSIGNMENT_STATUS    : common.AssignmentStatus default 'ACTIVE';
        REMARKS              : common.String255;

        ASSET    : Association to Assets;
        EMPLOYEE    : Association to master.Employees;
        ASSIGNED_BY : Association to master.Employees;
    }

    // User-submitted requests do not directly mutate the asset lifecycle.
    // Authorized managers/admins review them before lifecycle actions execute.
    entity AssetRequests : managed {
        key NODE_KEY : common.Guid;
        REQUEST_TYPE : String(20); // RETURN or MAINTENANCE
        STATUS       : String(20) default 'PENDING';
        DESCRIPTION  : common.String255;
        REQUESTED_AT : Timestamp;
        RESOLVED_AT  : Timestamp;
        DECISION_NOTE : common.String255;
        ASSET        : Association to Assets;
        REQUESTED_BY : Association to master.Employees;
        RESOLVED_BY  : Association to master.Employees;
    }

    // Immutable: rows are only ever inserted (see srv/ledger-guard.js)
    entity OwnershipLedgers {

        key NODE_KEY : common.Guid;

        ACTION          : common.LedgerAction;
        TRANSITION_DATE : Date;
        FROM_STATUS     : common.AssetStatus;
        TO_STATUS       : common.AssetStatus;
        REMARKS         : common.String255;
        ACTOR           : common.String255;     // login of the user who did it
        RECORDED_AT     : Timestamp;

        ASSET         : Association to Assets;
        FROM_EMPLOYEE : Association to master.Employees;
        TO_EMPLOYEE   : Association to master.Employees;
    }

    entity MaintenanceRecords {

        key NODE_KEY : common.Guid;

        TYPE           : common.MaintenanceType;
        DESCRIPTION    : common.String255;
        REPORTED_DATE  : Date;
        COMPLETED_DATE : Date;
        STATUS         : common.MaintenanceStatus default 'OPEN';
        OUTCOME        : common.String255;
        REPORTED_BY         : Association to master.Employees;
        COST                : common.AmountT;
        COVERED_BY_WARRANTY : Boolean default false;
        NEXT_DUE_DATE       : Date;

        ASSET          : Association to Assets;
        SERVICE_VENDOR : Association to master.Vendors;
    }

    // Compliance evidence: an archived asset is never physically deleted
    entity ArchiveRecords {

        key NODE_KEY : common.Guid;

        ARCHIVED_AT          : Timestamp;
        ARCHIVED_BY          : common.String255;
        REASON               : common.String255;
        DISPOSAL_CERT_NO     : common.String64;
        DISPOSAL_METHOD      : common.DisposalMethod;

        ASSET : Association to Assets;
    }
}

// Reports: generated PDF files and the audit log of export / download / e-mail
context reporting {

    // Generated PDF, downloadable by the requester until EXPIRES_AT
    entity ReportFiles {

        key NODE_KEY : common.Guid;

        REPORT_TYPE  : common.ReportType;
        FILE_NAME    : common.String255;
        ROW_COUNT    : Integer;
        FILTERS      : common.String1000;   // JSON of the applied filters
        REQUESTED_BY : common.String255;
        CREATED_AT   : Timestamp;
        EXPIRES_AT   : Timestamp;

        @Core.MediaType: 'application/pdf'
        @Core.ContentDisposition.Filename: FILE_NAME
        CONTENT : LargeBinary;
    }

    // Audit trail (no report contents are stored here)
    entity ReportLogs {

        key NODE_KEY : common.Guid;

        REPORT_TYPE  : common.ReportType;
        ACTION       : common.ReportAction;
        FILTERS      : common.String1000;
        RECIPIENTS   : common.String1000;
        ROW_COUNT    : Integer;
        OUTCOME      : common.ReportOutcome;
        MESSAGE      : common.String255;
        REQUEST_ID   : common.String64;     // idempotency key for e-mails
        REQUESTED_BY : common.String255;
        REQUESTED_AT : Timestamp;

        FILE : Association to ReportFiles;
    }
}
