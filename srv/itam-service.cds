using { itam.db as database } from '../db/schema';

// Login via XSUAA. The login e-mail ($user) links a user to an Employees record.
// Three roles (FRD: Security & Authorization):
//   Admin   - asset lifecycle and master data; also dashboard and reports
//   Manager - dashboard, reports (PDF export / download / e-mail) and read-only operational data
//   User    - hardware inventory, own assignments and own asset history

// ==================================================
// Launchpad helper: who is logged in, numbers for the tiles
// ==================================================

@path: '/odata/v4/app'
@impl: 'srv/app-service.js'
@requires: 'authenticated-user'
service AppService {

    type WhoAmI {
        user      : String;
        name      : String;
        email     : String;
        origin    : String;          // identity provider used for the login
        isAdmin   : Boolean;
        isManager : Boolean;
        isUser    : Boolean;
        scopes    : many String;     // roles inside the XSUAA token
        employee  : String;          // Employees record linked by e-mail
    }

    function whoAmI() returns WhoAmI;

    type TileKpis {
        myAssets         : Integer;          // assets currently held by the logged-in employee
        availableAssets  : Integer;
        assignedAssets   : Integer;          // Admin / Manager only (others: null)
        inMaintenance    : Integer;
        overdueReturns   : Integer;
        retiredAssets    : Integer;
        employees        : Integer;
        categories       : Integer;
        vendors          : Integer;
    }

    function tileKpis() returns TileKpis;
}

// ==================================================
// Admin: lifecycle + master data (FRD: AssetAdminService)
// ==================================================

@path: '/odata/v4/admin'
@impl: 'srv/admin-service.js'
@requires: 'Admin'
service AssetAdminService {

    @odata.draft.enabled
    entity Assets as projection on database.transaction.Assets {
        *,
        // CRITICALITY = colour in Fiori (1 red, 2 orange, 3 green, 5 blue, 0 grey)
        case
            when STATUS = 'AVAILABLE'   then 3
            when STATUS = 'ASSIGNED'    then 5
            when STATUS = 'MAINTENANCE' then 2
            when STATUS = 'RETIRED'     then 1
            else 0
        end as STATUS_CRITICALITY : Integer
    } actions {

        action assignAsset(
            employee           : UUID,
            distributionDate   : Date,
            expectedReturnDate : Date,
            remarks            : String(255)
        ) returns String;

        action transferAsset(
            toEmployee   : UUID,
            transferDate : Date,
            remarks      : String(255)
        ) returns String;

        action returnAsset(
            returnDate : Date,
            remarks    : String(255)
        ) returns String;

        action sendToMaintenance(
            vendor       : UUID,
            type         : String(12),
            issue        : String(255),
            reportedDate : Date
        ) returns String;

        action completeMaintenance(
            completedDate : Date,
            resolution    : String(255)
        ) returns String;

        action retireAsset(
            reason         : String(255),
            retiredDate    : Date,
            condition      : String(64),
            disposalMethod : String(12)
        ) returns String;

        action archiveAsset(
            reason              : String(255),
            complianceReference : String(64)
        ) returns String;
    };

    @odata.draft.enabled
    entity Departments as projection on database.master.Departments;

    @odata.draft.enabled
    entity Employees as projection on database.master.Employees;

    @odata.draft.enabled
    entity Categories as projection on database.master.AssetCategories;

    @odata.draft.enabled
    entity Vendors as projection on database.master.Vendors;

    @restrict: [{ grant: 'READ' }, { grant: 'UPDATE' }]
    entity Assignments as projection on database.transaction.AssetAssignments {
        *,
        case when ASSIGNMENT_STATUS = 'ACTIVE' then 5 else 0 end as STATUS_CRITICALITY : Integer
    };

    @readonly
    entity History as projection on database.transaction.OwnershipLedgers;

    @readonly
    entity AssetRequests as projection on database.transaction.AssetRequests;

    @restrict: [{ grant: 'READ' }, { grant: 'CREATE' }, { grant: 'UPDATE' }]
    entity Maintenance as projection on database.transaction.MaintenanceRecords {
        *,
        case when STATUS = 'OPEN' then 2 else 3 end as STATUS_CRITICALITY : Integer
    };

    @readonly
    entity Archive as projection on database.transaction.ArchiveRecords;

    @readonly entity AssetStatuses    as projection on database.codes.AssetStatuses;
    @readonly entity MaintenanceTypes as projection on database.codes.MaintenanceTypes;
    @readonly entity DisposalMethods  as projection on database.codes.DisposalMethods;

    // audit trail of report export / download / e-mail
    @readonly
    entity ReportLogs as projection on database.reporting.ReportLogs excluding { FILE };
}

// ==================================================
// Manager (and Admin): dashboard, reports, read-only operations (FRD: AssetManagerService)
// ==================================================

@path: '/odata/v4/manager'
@impl: 'srv/manager-service.js'
@requires: ['Manager', 'Admin']
service AssetManagerService {

    @restrict: [
        { grant: 'READ', to: ['Manager', 'Admin'] },
        { grant: 'UPDATE', to: ['Manager', 'Admin'] }
    ]
    entity Assets as projection on database.transaction.Assets {
        *,
        case
            when STATUS = 'AVAILABLE'   then 3
            when STATUS = 'ASSIGNED'    then 5
            when STATUS = 'MAINTENANCE' then 2
            when STATUS = 'RETIRED'     then 1
            else 0
        end as STATUS_CRITICALITY : Integer
    };

    // Safe lifecycle actions preserve assignments and immutable ledger history.
    action assignAsset(asset : UUID, employee : UUID, expectedReturnDate : Date, remarks : String(255)) returns String;
    action transferAsset(asset : UUID, toEmployee : UUID, remarks : String(255)) returns String;
    action returnAsset(asset : UUID, remarks : String(255)) returns String;
    action updateAssignment(assignment : UUID, expectedReturnDate : Date, remarks : String(255)) returns String;

    @readonly
    entity AssetRequests as projection on database.transaction.AssetRequests;

    // Managers can approve or reject requests from employees in their department.
    // Approval records a decision only; the lifecycle action is executed separately.
    action reviewAssetRequest(requestId : UUID, approve : Boolean, note : String(255)) returns String;
    action raiseMaintenanceRequest(asset : UUID, description : String(255)) returns UUID;

    @restrict: [{ grant: 'READ', to: ['Manager', 'Admin'] }, { grant: 'UPDATE', to: ['Manager', 'Admin'] }]
    entity Assignments as projection on database.transaction.AssetAssignments;
    @readonly entity History     as projection on database.transaction.OwnershipLedgers;
    @readonly entity Maintenance as projection on database.transaction.MaintenanceRecords;
    @readonly entity Departments as projection on database.master.Departments;
    @readonly entity Categories  as projection on database.master.AssetCategories;
    @readonly entity Vendors     as projection on database.master.Vendors;
    @readonly entity AssetStatuses as projection on database.codes.AssetStatuses;
    @readonly entity ReportTypes   as projection on database.codes.ReportTypes;

    @readonly
    entity Employees as projection on database.master.Employees {
        NODE_KEY, EMPLOYEE_NO, FULL_NAME, DEPARTMENT, LOCATION, STATUS
    };

    // generated PDFs: only the requester can download, only until EXPIRES_AT
    @readonly
    @restrict: [{ grant: 'READ', where: 'REQUESTED_BY = $user' }]
    entity ReportFiles as projection on database.reporting.ReportFiles;

    // ---------------- Dashboard (FR-021, FR-026) ----------------

    type CountBy {
        code  : String;
        label : String;
        count : Integer;
        value : Decimal(15,2);
    }

    type Dashboard {
        totalAssets       : Integer;
        available         : Integer;
        assigned          : Integer;
        inMaintenance     : Integer;
        retired           : Integer;
        archived          : Integer;
        utilisationPct    : Decimal(5,2);     // assigned / (assets in service)
        overdueReturns    : Integer;          // active assignment past its expected return date
        openMaintenance   : Integer;
        endOfLifeSoon     : Integer;          // purchase date + category lifespan within 90 days (or passed)
        totalValue        : Decimal(15,2);    // purchase cost of all non-archived assets
        currency          : String;
        byStatus          : many CountBy;
        byCategory        : many CountBy;
        byLocation        : many CountBy;
        generatedAt       : Timestamp;
    }

    function getDashboard(
        status   : String,
        category : UUID,
        location : String,
        dateFrom : Date,
        dateTo   : Date,
        department : UUID
    ) returns Dashboard;

    // ---------------- Reports (FR-022 .. FR-024, FR-026) ----------------

    type ReportRow {
        cells : many String;
    }

    type ReportPreview {
        reportType  : String;
        title       : String;
        filters     : String;
        generatedAt : Timestamp;
        columns     : many String;
        rows        : many ReportRow;
        rowCount    : Integer;
    }

    function previewReport(
        reportType : String,
        status     : String,
        category   : UUID,
        location   : String,
        dateFrom   : Date,
        dateTo     : Date,
        department : UUID
    ) returns ReportPreview;

    type ExportResult {
        fileId      : UUID;
        fileName    : String;
        rowCount    : Integer;
        downloadUrl : String;
        expiresAt   : Timestamp;
    }

    action exportReport(
        reportType : String,
        status     : String,
        category   : UUID,
        location   : String,
        dateFrom   : Date,
        dateTo     : Date,
        department : UUID
    ) returns ExportResult;

    type EmailResult {
        status     : String;     // SENT | FAILED | DUPLICATE
        message    : String;
        requestId  : String;
        recipients : String;
        fileId     : UUID;
    }

    action emailReport(
        reportType : String,
        status     : String,
        category   : UUID,
        location   : String,
        dateFrom   : Date,
        dateTo     : Date,
        department : UUID,
        recipients : String,     // comma-separated
        requestId  : String      // idempotency key: same key = no second e-mail
    ) returns EmailResult;
}

// ==================================================
// User: inventory + own assignments / history (FRD: AssetUserService)
// ==================================================

@path: '/odata/v4/user'
@impl: 'srv/user-service.js'
@requires: 'User'
service AssetUserService {

    // A user sees only assets assigned to their identity.
    @readonly
    @restrict: [{ grant: 'READ', where: 'HOLDER_EMAIL = $user' }]
    entity Assets as projection on database.transaction.Assets {
        NODE_KEY, ASSET_TAG, SERIAL_NUMBER, ASSET_NAME, LOCATION, STATUS,
        PURCHASE_DATE, WARRANTY_END, FIRST_DISTRIBUTION_DATE,
        CATEGORY, CURRENT_HOLDER,
        CURRENT_HOLDER.EMAIL as HOLDER_EMAIL : String(255),
        case
            when STATUS = 'AVAILABLE'   then 3
            when STATUS = 'ASSIGNED'    then 5
            when STATUS = 'MAINTENANCE' then 2
            when STATUS = 'RETIRED'     then 1
            else 0
        end as STATUS_CRITICALITY : Integer
    } where STATUS != 'ARCHIVED';

    @readonly
    @restrict: [{ grant: 'READ', where: 'REQUESTED_BY_EMAIL = $user' }]
    entity AssetRequests as projection on database.transaction.AssetRequests {
        *, REQUESTED_BY.EMAIL as REQUESTED_BY_EMAIL : String(255)
    };

    // Submits a request; no direct asset-state change is permitted.
    action submitReturnRequest(asset : UUID, description : String(255)) returns UUID;
    action submitMaintenanceRequest(asset : UUID, description : String(255)) returns UUID;

    // only own assignments
    @readonly
    @restrict: [{ grant: 'READ', where: 'EMPLOYEE_EMAIL = $user' }]
    entity AssetAssignments as projection on database.transaction.AssetAssignments {
        *,
        EMPLOYEE.EMAIL   as EMPLOYEE_EMAIL : String(255),
        ASSET.ASSET_TAG  as ASSET_TAG,
        ASSET.ASSET_NAME as ASSET_NAME,
        case when ASSIGNMENT_STATUS = 'ACTIVE' then 5 else 0 end as STATUS_CRITICALITY : Integer
    };

    // only history entries where the user was the giver or the receiver
    @readonly
    @restrict: [{ grant: 'READ', where: 'FROM_EMAIL = $user or TO_EMAIL = $user' }]
    entity AssetHistory as projection on database.transaction.OwnershipLedgers {
        *,
        FROM_EMPLOYEE.EMAIL as FROM_EMAIL : String(255),
        TO_EMPLOYEE.EMAIL   as TO_EMAIL   : String(255),
        ASSET.ASSET_TAG  as ASSET_TAG,
        ASSET.ASSET_NAME as ASSET_NAME
    };

    @readonly
    entity Categories as projection on database.master.AssetCategories { NODE_KEY, NAME };

    @readonly
    @restrict: [{ grant: 'READ', where: 'EMAIL = $user' }]
    entity Employees as projection on database.master.Employees { NODE_KEY, FULL_NAME, EMAIL, DEPARTMENT, LOCATION };

    @readonly
    entity Departments as projection on database.master.Departments { NODE_KEY, NAME };

    @readonly
    entity AssetStatuses as projection on database.codes.AssetStatuses;
}

// ==================================================
// Fields maintained by the system (not editable)
// ==================================================

annotate AssetAdminService.Assets with {
    STATUS                  @readonly;
    CURRENT_HOLDER          @readonly;
    FIRST_DISTRIBUTION_DATE @readonly;
    RETIRED_DATE            @readonly;
    RETIREMENT_REASON       @readonly;
    CONDITION               @readonly;
    DISPOSAL_METHOD         @readonly;
};

annotate AssetAdminService.Employees with {
    STATUS @assert.range;
};

// archived / audit records can never be deleted
annotate AssetAdminService.Assets with @Capabilities.DeleteRestrictions.Deletable: false;
