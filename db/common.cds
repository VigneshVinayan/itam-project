namespace itam.common;

type Guid        : UUID;
type PhoneNumber : String(32);
type Email       : String(255);
type String32    : String(32);
type String64    : String(64);
type String255   : String(255);
type String1000  : String(1000);

type AmountT : Decimal(15,2);

type EmployeeStatus : String(10) enum {
    active   = 'ACTIVE';
    inactive = 'INACTIVE';
};

// Asset lifecycle: AVAILABLE -> ASSIGNED -> AVAILABLE -> MAINTENANCE -> AVAILABLE -> RETIRED -> ARCHIVED
type AssetStatus : String(12) enum {
    available   = 'AVAILABLE';
    assigned    = 'ASSIGNED';
    maintenance = 'MAINTENANCE';
    retired     = 'RETIRED';
    archived    = 'ARCHIVED';
};

type AssignmentStatus : String(12) enum {
    active      = 'ACTIVE';
    transferred = 'TRANSFERRED';
    returned    = 'RETURNED';
};

// Every lifecycle event written to the ownership ledger
type LedgerAction : String(24) enum {
    created             = 'CREATED';
    assigned            = 'ASSIGNED';
    transferred         = 'TRANSFERRED';
    returned            = 'RETURNED';
    maintenanceStarted  = 'MAINTENANCE_STARTED';
    maintenanceComplete = 'MAINTENANCE_COMPLETED';
    retired             = 'RETIRED';
    archived            = 'ARCHIVED';
};

type MaintenanceType : String(12) enum {
    repair  = 'REPAIR';
    service = 'SERVICE';
    upgrade = 'UPGRADE';
};

type MaintenanceStatus : String(12) enum {
    open      = 'OPEN';
    completed = 'COMPLETED';
};

type DisposalMethod : String(12) enum {
    recycle  = 'RECYCLE';
    donate   = 'DONATE';
    resell   = 'RESELL';
    destroy  = 'DESTROY';
    retain   = 'RETAIN';
};

type ReportType : String(24) enum {
    inventory   = 'ASSET_INVENTORY';
    assignments = 'ASSIGNMENTS';
    maintenance = 'MAINTENANCE';
    history     = 'LIFECYCLE_HISTORY';
};

type ReportAction : String(10) enum {
    export   = 'EXPORT';
    download = 'DOWNLOAD';
    email    = 'EMAIL';
};

type ReportOutcome : String(10) enum {
    simulated = 'SIMULATED'; // no provider configured: log only, not delivered
    success = 'SUCCESS';
    failed  = 'FAILED';
    denied  = 'DENIED';
};
