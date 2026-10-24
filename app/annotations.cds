using { itam.db as db } from '../db/schema';
using { AssetAdminService, AssetManagerService, AssetUserService } from '../srv/itam-service';

// ==================================================
// FIELD LABELS (i18n, FR-019) - on the database entities, so every service inherits them
// ==================================================

annotate db.transaction.Assets with {
    NODE_KEY                @UI.Hidden;
    ASSET_TAG               @title: '{i18n>AssetTag}';
    SERIAL_NUMBER           @title: '{i18n>SerialNumber}';
    ASSET_NAME              @title: '{i18n>AssetName}';
    LOCATION                @title: '{i18n>Location}';
    PURCHASE_DATE           @title: '{i18n>PurchaseDate}';
    PURCHASE_COST           @title: '{i18n>PurchaseCost}'  @Measures.ISOCurrency: CURRENCY_CODE;
    CURRENCY_CODE           @title: '{i18n>Currency}';
    WARRANTY_END            @title: '{i18n>WarrantyEnd}';
    STATUS                  @title: '{i18n>Status}';
    FIRST_DISTRIBUTION_DATE @title: '{i18n>FirstDistributionDate}';
    RETIRED_DATE            @title: '{i18n>RetiredDate}';
    RETIREMENT_REASON       @title: '{i18n>RetirementReason}';
    CONDITION               @title: '{i18n>Condition}';
    DISPOSAL_METHOD         @title: '{i18n>DisposalMethod}';
    MANAGING_DEPARTMENT     @title: 'Managing Department' @Common.Text: MANAGING_DEPARTMENT.NAME @Common.TextArrangement: #TextOnly;
    CATEGORY                @title: '{i18n>Category}'       @Common.Text: CATEGORY.NAME            @Common.TextArrangement: #TextOnly;
    VENDOR                  @title: '{i18n>Vendor}'         @Common.Text: VENDOR.NAME              @Common.TextArrangement: #TextOnly;
    CURRENT_HOLDER          @title: '{i18n>CurrentHolder}'  @Common.Text: CURRENT_HOLDER.FULL_NAME @Common.TextArrangement: #TextOnly;
};

annotate db.master.Departments with {
    NODE_KEY    @UI.Hidden;
    NAME        @title: 'Department Name';
    COST_CENTER @title: 'Cost Center';
    IS_ACTIVE   @title: 'Active';
};

annotate AssetAdminService.Departments with @(
    UI.HeaderInfo: {
        TypeName: 'Department',
        TypeNamePlural: 'Departments',
        Title: { Value: NAME }
    },
    UI.SelectionFields: [NAME, IS_ACTIVE],
    UI.LineItem: [
        { Value: NAME },
        { Value: COST_CENTER },
        { Value: IS_ACTIVE }
    ],
    UI.Facets: [{ $Type: 'UI.ReferenceFacet', Label: 'Department', Target: '@UI.FieldGroup#General' }],
    UI.FieldGroup #General: { Data: [
        { Value: NAME },
        { Value: COST_CENTER },
        { Value: IS_ACTIVE }
    ]}
);

annotate db.master.Employees with {
    NODE_KEY    @UI.Hidden;
    EMPLOYEE_NO @title: '{i18n>EmployeeNo}';
    FULL_NAME   @title: '{i18n>FullName}';
    EMAIL       @title: '{i18n>Email}'  @Communication.IsEmailAddress;
    PHONE       @title: '{i18n>Phone}'  @Communication.IsPhoneNumber;
    DEPARTMENT  @title: '{i18n>Department}';
    LOCATION    @title: '{i18n>Location}';
    STATUS      @title: '{i18n>Status}';
};

annotate db.master.AssetCategories with {
    NODE_KEY        @UI.Hidden;
    NAME            @title: '{i18n>Name}';
    DESCRIPTION     @title: '{i18n>Description}';
    LIFESPAN_MONTHS @title: '{i18n>LifespanMonths}';
    IS_ACTIVE       @title: '{i18n>IsActive}';
};

annotate db.master.Vendors with {
    NODE_KEY       @UI.Hidden;
    NAME           @title: '{i18n>Name}';
    CONTACT_PERSON @title: '{i18n>ContactPerson}';
    EMAIL          @title: '{i18n>Email}'  @Communication.IsEmailAddress;
    PHONE          @title: '{i18n>Phone}'  @Communication.IsPhoneNumber;
    IS_ACTIVE      @title: '{i18n>IsActive}';
};

annotate db.transaction.AssetAssignments with {
    NODE_KEY             @UI.Hidden;
    ASSIGNED_DATE        @title: '{i18n>AssignedDate}';
    EXPECTED_RETURN_DATE @title: '{i18n>ExpectedReturnDate}';
    ACTUAL_RETURN_DATE   @title: '{i18n>ActualReturnDate}';
    ASSIGNMENT_STATUS    @title: '{i18n>AssignmentStatus}';
    REMARKS              @title: '{i18n>Remarks}';
    ASSET                @title: '{i18n>Asset}'    @Common.Text: ASSET.ASSET_TAG     @Common.TextArrangement: #TextOnly;
    EMPLOYEE             @title: '{i18n>Employee}' @Common.Text: EMPLOYEE.FULL_NAME  @Common.TextArrangement: #TextOnly;
};

annotate db.transaction.OwnershipLedgers with {
    NODE_KEY        @UI.Hidden;
    ACTION          @title: '{i18n>Action}';
    TRANSITION_DATE @title: '{i18n>TransitionDate}';
    FROM_STATUS     @title: '{i18n>FromStatus}';
    TO_STATUS       @title: '{i18n>ToStatus}';
    REMARKS         @title: '{i18n>Remarks}';
    ACTOR           @title: '{i18n>Actor}';
    RECORDED_AT     @title: '{i18n>RecordedAt}';
    ASSET           @title: '{i18n>Asset}'        @Common.Text: ASSET.ASSET_TAG           @Common.TextArrangement: #TextOnly;
    FROM_EMPLOYEE   @title: '{i18n>FromEmployee}' @Common.Text: FROM_EMPLOYEE.FULL_NAME   @Common.TextArrangement: #TextOnly;
    TO_EMPLOYEE     @title: '{i18n>ToEmployee}'   @Common.Text: TO_EMPLOYEE.FULL_NAME     @Common.TextArrangement: #TextOnly;
};

annotate db.transaction.MaintenanceRecords with {
    NODE_KEY       @UI.Hidden;
    TYPE           @title: '{i18n>MaintenanceType}';
    DESCRIPTION          @title: '{i18n>Issue}';
    REPORTED_DATE  @title: '{i18n>ReportedDate}';
    COMPLETED_DATE @title: '{i18n>CompletedDate}';
    STATUS         @title: '{i18n>Status}';
    OUTCOME     @title: '{i18n>Resolution}';
    ASSET          @title: '{i18n>Asset}'         @Common.Text: ASSET.ASSET_TAG      @Common.TextArrangement: #TextOnly;
    SERVICE_VENDOR @title: '{i18n>ServiceVendor}' @Common.Text: SERVICE_VENDOR.NAME  @Common.TextArrangement: #TextOnly;
};

annotate db.transaction.ArchiveRecords with {
    NODE_KEY             @UI.Hidden;
    ARCHIVED_AT          @title: '{i18n>ArchivedAt}';
    ARCHIVED_BY          @title: '{i18n>ArchivedBy}';
    REASON               @title: '{i18n>Reason}';
    DISPOSAL_CERT_NO @title: '{i18n>ComplianceReference}';
    DISPOSAL_METHOD      @title: '{i18n>DisposalMethod}';
};

annotate db.reporting.ReportLogs with {
    NODE_KEY     @UI.Hidden;
    REPORT_TYPE  @title: '{i18n>ReportType}';
    ACTION       @title: '{i18n>ReportAction}';
    FILTERS      @title: '{i18n>Filters}';
    RECIPIENTS   @title: '{i18n>Recipients}';
    ROW_COUNT    @title: '{i18n>RowCount}';
    OUTCOME      @title: '{i18n>Outcome}';
    MESSAGE      @title: '{i18n>Message}';
    REQUEST_ID   @title: '{i18n>RequestId}';
    REQUESTED_BY @title: '{i18n>RequestedBy}';
    REQUESTED_AT @title: '{i18n>RequestedAt}';
};

annotate db.codes.AssetStatuses    with { code @title: '{i18n>Status}'          @Common.Text: text @Common.TextArrangement: #TextOnly; };
annotate db.codes.MaintenanceTypes with { code @title: '{i18n>MaintenanceType}' @Common.Text: text @Common.TextArrangement: #TextOnly; };
annotate db.codes.DisposalMethods  with { code @title: '{i18n>DisposalMethod}'  @Common.Text: text @Common.TextArrangement: #TextOnly; };

// ==================================================
// ADMIN: VALUE HELPS (only active categories / vendors / employees can be picked, FR-016/017)
// ==================================================

annotate AssetAdminService.Assets with {
    CATEGORY @Common.ValueList: { CollectionPath: 'Categories', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: CATEGORY_NODE_KEY, ValueListProperty: 'NODE_KEY' },
                 { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'NAME' },
                 { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'LIFESPAN_MONTHS' },
                 { $Type: 'Common.ValueListParameterConstant', ValueListProperty: 'IS_ACTIVE', Constant: 'true' }
             ]};
    VENDOR   @Common.ValueList: { CollectionPath: 'Vendors', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: VENDOR_NODE_KEY, ValueListProperty: 'NODE_KEY' },
                 { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'NAME' },
                 { $Type: 'Common.ValueListParameterConstant', ValueListProperty: 'IS_ACTIVE', Constant: 'true' }
             ]};
    CURRENT_HOLDER @Common.ValueList: { CollectionPath: 'Employees', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: CURRENT_HOLDER_NODE_KEY, ValueListProperty: 'NODE_KEY' },
                 { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'FULL_NAME' },
                 { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'DEPARTMENT' }
             ]};
    STATUS   @Common.ValueListWithFixedValues
             @Common.ValueList: { CollectionPath: 'AssetStatuses', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: STATUS, ValueListProperty: 'code' }
             ]};
    DISPOSAL_METHOD @Common.ValueListWithFixedValues
             @Common.ValueList: { CollectionPath: 'DisposalMethods', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: DISPOSAL_METHOD, ValueListProperty: 'code' }
             ]};
    ASSET_TAG     @mandatory;
    SERIAL_NUMBER @mandatory;
    PURCHASE_DATE @mandatory;
    CATEGORY      @mandatory;
};

annotate AssetAdminService.Assets actions {
    assignAsset(
        employee @title: '{i18n>Employee}' @mandatory
                 @Common.ValueList: { CollectionPath: 'Employees', Parameters: [
                     { $Type: 'Common.ValueListParameterOut', LocalDataProperty: employee, ValueListProperty: 'NODE_KEY' },
                     { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'FULL_NAME' },
                     { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'DEPARTMENT' },
                     { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'LOCATION' },
                     { $Type: 'Common.ValueListParameterConstant', ValueListProperty: 'STATUS', Constant: 'ACTIVE' }
                 ]},
        distributionDate   @title: '{i18n>DistributionDate}',
        expectedReturnDate @title: '{i18n>ExpectedReturnDate}',
        remarks            @title: '{i18n>Remarks}'
    );
    transferAsset(
        toEmployee @title: '{i18n>NewEmployee}' @mandatory
                   @Common.ValueList: { CollectionPath: 'Employees', Parameters: [
                       { $Type: 'Common.ValueListParameterOut', LocalDataProperty: toEmployee, ValueListProperty: 'NODE_KEY' },
                       { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'FULL_NAME' },
                       { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'DEPARTMENT' },
                       { $Type: 'Common.ValueListParameterConstant', ValueListProperty: 'STATUS', Constant: 'ACTIVE' }
                   ]},
        transferDate @title: '{i18n>TransferDate}',
        remarks      @title: '{i18n>Remarks}'
    );
    returnAsset(
        returnDate @title: '{i18n>ReturnDate}',
        remarks    @title: '{i18n>Remarks}' @UI.MultiLineText
    );
    sendToMaintenance(
        vendor @title: '{i18n>ServiceVendor}' @mandatory
               @Common.ValueList: { CollectionPath: 'Vendors', Parameters: [
                   { $Type: 'Common.ValueListParameterOut', LocalDataProperty: vendor, ValueListProperty: 'NODE_KEY' },
                   { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'NAME' },
                   { $Type: 'Common.ValueListParameterConstant', ValueListProperty: 'IS_ACTIVE', Constant: 'true' }
               ]},
        type   @title: '{i18n>MaintenanceType}'
               @Common.ValueListWithFixedValues
               @Common.ValueList: { CollectionPath: 'MaintenanceTypes', Parameters: [
                   { $Type: 'Common.ValueListParameterOut', LocalDataProperty: type, ValueListProperty: 'code' }
               ]},
        issue        @title: '{i18n>Issue}' @mandatory @UI.MultiLineText,
        reportedDate @title: '{i18n>ReportedDate}'
    );
    completeMaintenance(
        completedDate @title: '{i18n>CompletedDate}',
        resolution    @title: '{i18n>Resolution}' @UI.MultiLineText
    );
    retireAsset(
        reason         @title: '{i18n>RetirementReason}' @mandatory @UI.MultiLineText,
        retiredDate    @title: '{i18n>RetiredDate}',
        condition      @title: '{i18n>Condition}',
        disposalMethod @title: '{i18n>DisposalMethod}'
                       @Common.ValueListWithFixedValues
                       @Common.ValueList: { CollectionPath: 'DisposalMethods', Parameters: [
                           { $Type: 'Common.ValueListParameterOut', LocalDataProperty: disposalMethod, ValueListProperty: 'code' }
                       ]}
    );
    archiveAsset(
        reason              @title: '{i18n>Reason}' @mandatory @UI.MultiLineText,
        complianceReference @title: '{i18n>ComplianceReference}'
    );
};

// ==================================================
// ADMIN: ASSETS APP (List Report + Object Page + lifecycle actions)
// ==================================================

annotate AssetAdminService.Assets with { STATUS_CRITICALITY @UI.Hidden; };

annotate AssetAdminService.Assets with @(
    UI.HeaderInfo: {
        TypeName       : '{i18n>Asset}',
        TypeNamePlural : '{i18n>Assets}',
        TypeImageUrl   : 'sap-icon://laptop',
        Title          : { Value: ASSET_TAG },
        Description    : { Value: ASSET_NAME }
    },
    // FR-018: search and filter by asset no., serial, category, status, owner, vendor, location
    UI.SelectionFields: [ ASSET_TAG, SERIAL_NUMBER, CATEGORY_NODE_KEY, STATUS, CURRENT_HOLDER_NODE_KEY, VENDOR_NODE_KEY, MANAGING_DEPARTMENT_NODE_KEY, LOCATION ],
    UI.PresentationVariant: { SortOrder: [{ Property: ASSET_TAG }], Visualizations: ['@UI.LineItem'] },
    UI.LineItem: [
        { $Type: 'UI.DataFieldForAction', Action: 'AssetAdminService.assignAsset',         Label: '{i18n>AssignAsset}' },
        { $Type: 'UI.DataFieldForAction', Action: 'AssetAdminService.transferAsset',       Label: '{i18n>TransferAsset}' },
        { $Type: 'UI.DataFieldForAction', Action: 'AssetAdminService.returnAsset',         Label: '{i18n>ReturnAsset}' },
        { Value: ASSET_TAG,               ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '7rem' } },
        { Value: ASSET_NAME,              ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '14rem' } },
        { Value: SERIAL_NUMBER, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '9rem' } },
        { Value: CATEGORY_NODE_KEY, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '8rem' } },
        { Value: STATUS, Criticality: STATUS_CRITICALITY, CriticalityRepresentation: #WithIcon, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '9rem' } },
        { Value: CURRENT_HOLDER_NODE_KEY, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '9rem' } },
        { Value: LOCATION, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '7rem' } },
        { Value: PURCHASE_DATE, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '8rem' } },
        { Value: VENDOR_NODE_KEY, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '12rem' } }
    ],
    UI.DataPoint #Status:  { Value: STATUS, Criticality: STATUS_CRITICALITY, Title: '{i18n>Status}' },
    UI.DataPoint #Holder:  { Value: CURRENT_HOLDER.FULL_NAME, Title: '{i18n>CurrentHolder}' },
    UI.DataPoint #FirstDistribution: { Value: FIRST_DISTRIBUTION_DATE, Title: '{i18n>FirstDistributionDate}' },
    UI.HeaderFacets: [
        { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Status' },
        { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Holder' },
        { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#FirstDistribution' }
    ],
    UI.Identification: [
        { $Type: 'UI.DataFieldForAction', Action: 'AssetAdminService.assignAsset',         Label: '{i18n>AssignAsset}' },
        { $Type: 'UI.DataFieldForAction', Action: 'AssetAdminService.transferAsset',       Label: '{i18n>TransferAsset}' },
        { $Type: 'UI.DataFieldForAction', Action: 'AssetAdminService.returnAsset',         Label: '{i18n>ReturnAsset}' },
        { $Type: 'UI.DataFieldForAction', Action: 'AssetAdminService.sendToMaintenance',   Label: '{i18n>SendToMaintenance}' },
        { $Type: 'UI.DataFieldForAction', Action: 'AssetAdminService.completeMaintenance', Label: '{i18n>CompleteMaintenance}' },
        { $Type: 'UI.DataFieldForAction', Action: 'AssetAdminService.retireAsset',         Label: '{i18n>RetireAsset}' },
        { $Type: 'UI.DataFieldForAction', Action: 'AssetAdminService.archiveAsset',        Label: '{i18n>ArchiveAsset}' }
    ],
    UI.FieldGroup #General: { Data: [
        { Value: ASSET_TAG },
        { Value: SERIAL_NUMBER },
        { Value: ASSET_NAME },
        { Value: CATEGORY_NODE_KEY },
        { Value: LOCATION }
    ]},
    UI.FieldGroup #Procurement: { Data: [
        { Value: PURCHASE_DATE },
        { Value: PURCHASE_COST },
        { Value: VENDOR_NODE_KEY },
        { Value: WARRANTY_END }
    ]},
    UI.FieldGroup #CurrentState: { Data: [
        { Value: STATUS, Criticality: STATUS_CRITICALITY, CriticalityRepresentation: #WithIcon },
        { Value: CURRENT_HOLDER_NODE_KEY },
        { Value: FIRST_DISTRIBUTION_DATE }
    ]},
    UI.FieldGroup #Retirement: { Data: [
        { Value: RETIRED_DATE },
        { Value: RETIREMENT_REASON },
        { Value: CONDITION },
        { Value: DISPOSAL_METHOD }
    ]},
    UI.Facets: [
        { $Type: 'UI.CollectionFacet', ID: 'Overview', Label: '{i18n>General}', Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '{i18n>General}',      Target: '@UI.FieldGroup#General' },
            { $Type: 'UI.ReferenceFacet', Label: '{i18n>Procurement}',  Target: '@UI.FieldGroup#Procurement' },
            { $Type: 'UI.ReferenceFacet', Label: '{i18n>CurrentState}', Target: '@UI.FieldGroup#CurrentState' }
        ]},
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>Assignments}', Target: 'ASSIGNMENTS/@UI.LineItem' },
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>Maintenance}', Target: 'MAINTENANCE/@UI.LineItem' },
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>History}',     Target: 'HISTORY/@UI.LineItem' },
        { $Type: 'UI.CollectionFacet', ID: 'RetirementArchive', Label: '{i18n>Retirement}', Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '{i18n>Retirement}', Target: '@UI.FieldGroup#Retirement' },
            { $Type: 'UI.ReferenceFacet', Label: '{i18n>Archive}',    Target: 'ARCHIVE/@UI.LineItem' }
        ]}
    ]
);

// buttons are only enabled when the transition is allowed (the server checks again)
annotate AssetAdminService.Assets actions {
    assignAsset @(
        Core.OperationAvailable: { $edmJson: { $And: [
            { $Path: 'in/IsActiveEntity' }, { $Eq: [ { $Path: 'in/STATUS' }, 'AVAILABLE' ] } ] } },
        Common.SideEffects: { TargetEntities: ['in', 'in/ASSIGNMENTS', 'in/HISTORY'] }
    );
    transferAsset @(
        Core.OperationAvailable: { $edmJson: { $And: [
            { $Path: 'in/IsActiveEntity' }, { $Eq: [ { $Path: 'in/STATUS' }, 'ASSIGNED' ] } ] } },
        Common.SideEffects: { TargetEntities: ['in', 'in/ASSIGNMENTS', 'in/HISTORY'] }
    );
    returnAsset @(
        Core.OperationAvailable: { $edmJson: { $And: [
            { $Path: 'in/IsActiveEntity' }, { $Eq: [ { $Path: 'in/STATUS' }, 'ASSIGNED' ] } ] } },
        Common.SideEffects: { TargetEntities: ['in', 'in/ASSIGNMENTS', 'in/HISTORY'] }
    );
    sendToMaintenance @(
        Core.OperationAvailable: { $edmJson: { $And: [
            { $Path: 'in/IsActiveEntity' }, { $Eq: [ { $Path: 'in/STATUS' }, 'AVAILABLE' ] } ] } },
        Common.SideEffects: { TargetEntities: ['in', 'in/MAINTENANCE', 'in/HISTORY'] }
    );
    completeMaintenance @(
        Core.OperationAvailable: { $edmJson: { $And: [
            { $Path: 'in/IsActiveEntity' }, { $Eq: [ { $Path: 'in/STATUS' }, 'MAINTENANCE' ] } ] } },
        Common.SideEffects: { TargetEntities: ['in', 'in/MAINTENANCE', 'in/HISTORY'] }
    );
    retireAsset @(
        Core.OperationAvailable: { $edmJson: { $And: [
            { $Path: 'in/IsActiveEntity' }, { $Eq: [ { $Path: 'in/STATUS' }, 'AVAILABLE' ] } ] } },
        Common.SideEffects: { TargetEntities: ['in', 'in/HISTORY'] }
    );
    archiveAsset @(
        Core.OperationAvailable: { $edmJson: { $And: [
            { $Path: 'in/IsActiveEntity' }, { $Eq: [ { $Path: 'in/STATUS' }, 'RETIRED' ] } ] } },
        Common.SideEffects: { TargetEntities: ['in', 'in/ARCHIVE', 'in/HISTORY'] }
    );
};

annotate AssetAdminService.Assignments with { STATUS_CRITICALITY @UI.Hidden; };

annotate AssetAdminService.Assignments with @(
    UI.PresentationVariant: { SortOrder: [{ Property: ASSIGNED_DATE, Descending: true }], Visualizations: ['@UI.LineItem'] },
    UI.LineItem: [
        { Value: EMPLOYEE_NODE_KEY },
        { Value: ASSIGNED_DATE },
        { Value: EXPECTED_RETURN_DATE },
        { Value: ACTUAL_RETURN_DATE },
        { Value: ASSIGNMENT_STATUS, Criticality: STATUS_CRITICALITY },
        { Value: REMARKS }
    ]
);

annotate AssetAdminService.Maintenance with { STATUS_CRITICALITY @UI.Hidden; };

annotate AssetAdminService.Maintenance with @(
    UI.PresentationVariant: { SortOrder: [{ Property: REPORTED_DATE, Descending: true }], Visualizations: ['@UI.LineItem'] },
    UI.LineItem: [
        { Value: TYPE },
        { Value: DESCRIPTION },
        { Value: SERVICE_VENDOR_NODE_KEY },
        { Value: REPORTED_DATE },
        { Value: COMPLETED_DATE },
        { Value: STATUS, Criticality: STATUS_CRITICALITY, CriticalityRepresentation: #WithIcon },
        { Value: OUTCOME }
    ]
);

annotate AssetAdminService.History with @(
    UI.PresentationVariant: { SortOrder: [{ Property: RECORDED_AT, Descending: true }], Visualizations: ['@UI.LineItem'] },
    UI.LineItem: [
        { Value: TRANSITION_DATE },
        { Value: ACTION },
        { Value: FROM_EMPLOYEE_NODE_KEY },
        { Value: TO_EMPLOYEE_NODE_KEY },
        { Value: FROM_STATUS },
        { Value: TO_STATUS },
        { Value: REMARKS },
        { Value: ACTOR }
    ]
);

annotate AssetAdminService.Archive with @(
    UI.LineItem: [
        { Value: ARCHIVED_AT },
        { Value: ARCHIVED_BY },
        { Value: REASON },
        { Value: DISPOSAL_CERT_NO },
        { Value: DISPOSAL_METHOD }
    ]
);

// ==================================================
// ADMIN: EMPLOYEES / CATEGORIES / VENDORS APPS
// ==================================================

annotate AssetAdminService.Employees with @(
    UI.HeaderInfo: {
        TypeName       : '{i18n>Employee}',
        TypeNamePlural : '{i18n>Employees}',
        TypeImageUrl   : 'sap-icon://employee',
        Title          : { Value: FULL_NAME },
        Description    : { Value: EMPLOYEE_NO }
    },
    UI.SelectionFields: [ FULL_NAME, DEPARTMENT_NODE_KEY, LOCATION, STATUS ],
    UI.PresentationVariant: { SortOrder: [{ Property: EMPLOYEE_NO }], Visualizations: ['@UI.LineItem'] },
    UI.LineItem: [
        { Value: EMPLOYEE_NO },
        { Value: FULL_NAME },
        { Value: EMAIL },
        // Show the human-readable name, never the generated UUID.
        { Value: DEPARTMENT.NAME, Label: '{i18n>Department}' },
        { Value: LOCATION },
        { Value: STATUS }
    ],
    UI.FieldGroup #General: { Data: [
        { Value: EMPLOYEE_NO },
        { Value: FULL_NAME },
        { Value: DEPARTMENT_NODE_KEY },
        { Value: LOCATION },
        { Value: STATUS }
    ]},
    UI.FieldGroup #Contact: { Data: [
        { Value: EMAIL },
        { Value: PHONE }
    ]},
    UI.Facets: [
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>General}', Target: '@UI.FieldGroup#General' },
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>Contact}', Target: '@UI.FieldGroup#Contact' }
    ]
) {
    // Bind the editable field to the real scalar FK so FE can render a ComboBox.
    DEPARTMENT_NODE_KEY @title: '{i18n>Department}'
                        @Common.Text: DEPARTMENT.NAME
                        @Common.TextArrangement: #TextOnly
                        @Common.ValueListWithFixedValues
                        @Common.ValueList: {
        CollectionPath: 'Departments',
        Parameters: [
            { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: DEPARTMENT_NODE_KEY, ValueListProperty: 'NODE_KEY' },
            { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'NAME' },
            { $Type: 'Common.ValueListParameterConstant', ValueListProperty: 'IS_ACTIVE', Constant: 'true' }
        ]
    };
    FULL_NAME @mandatory;
    EMAIL     @mandatory;
    STATUS    @Common.QuickInfo: 'ACTIVE or INACTIVE';
};

annotate AssetAdminService.Categories with @(
    UI.HeaderInfo: {
        TypeName       : '{i18n>Category}',
        TypeNamePlural : '{i18n>Categories}',
        TypeImageUrl   : 'sap-icon://product',
        Title          : { Value: NAME },
        Description    : { Value: DESCRIPTION }
    },
    UI.SelectionFields: [ NAME, IS_ACTIVE ],
    UI.LineItem: [
        { Value: NAME },
        { Value: DESCRIPTION },
        { Value: LIFESPAN_MONTHS },
        { Value: IS_ACTIVE }
    ],
    UI.FieldGroup #General: { Data: [
        { Value: NAME },
        { Value: DESCRIPTION },
        { Value: LIFESPAN_MONTHS },
        { Value: IS_ACTIVE }
    ]},
    UI.Facets: [
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>General}', Target: '@UI.FieldGroup#General' }
    ]
) {
    NAME            @mandatory;
    LIFESPAN_MONTHS @mandatory;
};

annotate AssetAdminService.Vendors with @(
    UI.HeaderInfo: {
        TypeName       : '{i18n>Vendor}',
        TypeNamePlural : '{i18n>Vendors}',
        TypeImageUrl   : 'sap-icon://supplier',
        Title          : { Value: NAME },
        Description    : { Value: CONTACT_PERSON }
    },
    UI.SelectionFields: [ NAME, IS_ACTIVE ],
    UI.LineItem: [
        { Value: NAME },
        { Value: CONTACT_PERSON },
        { Value: EMAIL },
        { Value: PHONE },
        { Value: IS_ACTIVE }
    ],
    UI.FieldGroup #General: { Data: [
        { Value: NAME },
        { Value: CONTACT_PERSON },
        { Value: EMAIL },
        { Value: PHONE },
        { Value: IS_ACTIVE }
    ]},
    UI.Facets: [
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>General}', Target: '@UI.FieldGroup#General' }
    ]
) {
    NAME @mandatory;
};

annotate AssetAdminService.ReportLogs with @(
    UI.PresentationVariant: { SortOrder: [{ Property: REQUESTED_AT, Descending: true }], Visualizations: ['@UI.LineItem'] },
    UI.LineItem: [
        { Value: REQUESTED_AT },
        { Value: REQUESTED_BY },
        { Value: REPORT_TYPE },
        { Value: ACTION },
        { Value: ROW_COUNT },
        { Value: RECIPIENTS },
        { Value: OUTCOME }
    ]
);

// ==================================================
// MANAGER: ASSET OVERVIEW APP (read-only operational view)
// ==================================================

annotate AssetManagerService.Assets with { STATUS_CRITICALITY @UI.Hidden; };

annotate AssetManagerService.Assets with {
    CATEGORY @Common.ValueList: { CollectionPath: 'Categories', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: CATEGORY_NODE_KEY, ValueListProperty: 'NODE_KEY' },
                 { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'NAME' }
             ]};
    VENDOR   @Common.ValueList: { CollectionPath: 'Vendors', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: VENDOR_NODE_KEY, ValueListProperty: 'NODE_KEY' },
                 { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'NAME' }
             ]};
    CURRENT_HOLDER @Common.ValueList: { CollectionPath: 'Employees', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: CURRENT_HOLDER_NODE_KEY, ValueListProperty: 'NODE_KEY' },
                 { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'FULL_NAME' }
             ]};
    STATUS   @Common.ValueListWithFixedValues
             @Common.ValueList: { CollectionPath: 'AssetStatuses', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: STATUS, ValueListProperty: 'code' }
             ]};
};

annotate AssetManagerService.Assets with @(
    UI.HeaderInfo: {
        TypeName       : '{i18n>Asset}',
        TypeNamePlural : '{i18n>Assets}',
        TypeImageUrl   : 'sap-icon://laptop',
        Title          : { Value: ASSET_TAG },
        Description    : { Value: ASSET_NAME }
    },
    UI.SelectionFields: [ ASSET_TAG, SERIAL_NUMBER, CATEGORY_NODE_KEY, STATUS, CURRENT_HOLDER_NODE_KEY, VENDOR_NODE_KEY, MANAGING_DEPARTMENT_NODE_KEY, LOCATION ],
    UI.PresentationVariant: { SortOrder: [{ Property: ASSET_TAG }], Visualizations: ['@UI.LineItem'] },
    UI.LineItem: [
        { Value: ASSET_TAG, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '7rem' } },
        { Value: ASSET_NAME, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '14rem' } },
        { Value: CATEGORY_NODE_KEY, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '8rem' } },
        { Value: STATUS, Criticality: STATUS_CRITICALITY, CriticalityRepresentation: #WithIcon, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '9rem' } },
        { Value: CURRENT_HOLDER_NODE_KEY, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '9rem' } },
        { Value: LOCATION, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '7rem' } },
        { Value: PURCHASE_DATE, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '8rem' } },
        { Value: PURCHASE_COST, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '9rem' } }
    ],
    UI.DataPoint #Status: { Value: STATUS, Criticality: STATUS_CRITICALITY, Title: '{i18n>Status}' },
    UI.HeaderFacets: [
        { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Status' }
    ],
    UI.FieldGroup #General: { Data: [
        { Value: ASSET_TAG },
        { Value: SERIAL_NUMBER },
        { Value: ASSET_NAME },
        { Value: CATEGORY_NODE_KEY },
        { Value: LOCATION },
        { Value: CURRENT_HOLDER_NODE_KEY },
        { Value: FIRST_DISTRIBUTION_DATE }
    ]},
    UI.FieldGroup #Procurement: { Data: [
        { Value: PURCHASE_DATE },
        { Value: PURCHASE_COST },
        { Value: VENDOR_NODE_KEY },
        { Value: WARRANTY_END }
    ]},
    UI.Facets: [
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>General}',     Target: '@UI.FieldGroup#General' },
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>Procurement}', Target: '@UI.FieldGroup#Procurement' },
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>Assignments}', Target: 'ASSIGNMENTS/@UI.LineItem' },
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>Maintenance}', Target: 'MAINTENANCE/@UI.LineItem' },
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>History}',     Target: 'HISTORY/@UI.LineItem' }
    ]
);

annotate AssetManagerService.Assignments with @(UI.LineItem: [
    { Value: EMPLOYEE_NODE_KEY },
    { Value: ASSIGNED_DATE },
    { Value: EXPECTED_RETURN_DATE },
    { Value: ACTUAL_RETURN_DATE },
    { Value: ASSIGNMENT_STATUS }
]);

annotate AssetManagerService.Maintenance with @(UI.LineItem: [
    { Value: TYPE },
    { Value: DESCRIPTION },
    { Value: SERVICE_VENDOR_NODE_KEY },
    { Value: REPORTED_DATE },
    { Value: COMPLETED_DATE },
    { Value: STATUS }
]);

annotate AssetManagerService.History with @(UI.LineItem: [
    { Value: TRANSITION_DATE },
    { Value: ACTION },
    { Value: FROM_EMPLOYEE_NODE_KEY },
    { Value: TO_EMPLOYEE_NODE_KEY },
    { Value: TO_STATUS },
    { Value: REMARKS },
    { Value: ACTOR }
]);

// ==================================================
// USER: HARDWARE INVENTORY APP + MY ASSIGNMENTS / MY HISTORY (read-only, FR-002, FR-015)
// ==================================================

annotate AssetUserService.Assets with { STATUS_CRITICALITY @UI.Hidden; };

annotate AssetUserService.Assets with {
    CATEGORY @Common.ValueList: { CollectionPath: 'Categories', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: CATEGORY_NODE_KEY, ValueListProperty: 'NODE_KEY' },
                 { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'NAME' }
             ]};
    CURRENT_HOLDER @Common.ValueList: { CollectionPath: 'Employees', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: CURRENT_HOLDER_NODE_KEY, ValueListProperty: 'NODE_KEY' },
                 { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'FULL_NAME' }
             ]};
    STATUS   @Common.ValueListWithFixedValues
             @Common.ValueList: { CollectionPath: 'AssetStatuses', Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: STATUS, ValueListProperty: 'code' }
             ]};
};

annotate AssetUserService.Assets with @(
    UI.HeaderInfo: {
        TypeName       : '{i18n>Asset}',
        TypeNamePlural : '{i18n>HardwareInventory}',
        TypeImageUrl   : 'sap-icon://laptop',
        Title          : { Value: ASSET_TAG },
        Description    : { Value: ASSET_NAME }
    },
    UI.SelectionFields: [ ASSET_TAG, SERIAL_NUMBER, CATEGORY_NODE_KEY, STATUS, CURRENT_HOLDER_NODE_KEY, LOCATION ],
    UI.PresentationVariant: { SortOrder: [{ Property: ASSET_TAG }], Visualizations: ['@UI.LineItem'] },
    UI.LineItem: [
        { Value: ASSET_TAG, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '7rem' } },
        { Value: ASSET_NAME, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '14rem' } },
        { Value: CATEGORY_NODE_KEY, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '8rem' } },
        { Value: STATUS, Criticality: STATUS_CRITICALITY, CriticalityRepresentation: #WithIcon, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '9rem' } },
        { Value: CURRENT_HOLDER_NODE_KEY, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '9rem' } },
        { Value: LOCATION, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '7rem' } }
    ],
    UI.FieldGroup #General: { Data: [
        { Value: ASSET_TAG },
        { Value: SERIAL_NUMBER },
        { Value: ASSET_NAME },
        { Value: CATEGORY_NODE_KEY },
        { Value: STATUS, Criticality: STATUS_CRITICALITY, CriticalityRepresentation: #WithIcon },
        { Value: CURRENT_HOLDER_NODE_KEY },
        { Value: LOCATION },
        { Value: PURCHASE_DATE },
        { Value: WARRANTY_END }
    ]},
    UI.Facets: [
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>General}', Target: '@UI.FieldGroup#General' }
    ]
);

annotate AssetUserService.AssetAssignments with {
    STATUS_CRITICALITY @UI.Hidden;
    EMPLOYEE_EMAIL     @UI.Hidden;
    ASSET_TAG          @title: '{i18n>AssetTag}';
    ASSET_NAME         @title: '{i18n>AssetName}';
};

annotate AssetUserService.AssetAssignments with @(
    UI.HeaderInfo: {
        TypeName       : '{i18n>Assignment}',
        TypeNamePlural : '{i18n>MyAssignments}',
        TypeImageUrl   : 'sap-icon://laptop',
        Title          : { Value: ASSET_TAG },
        Description    : { Value: ASSET_NAME }
    },
    UI.SelectionFields: [ ASSIGNMENT_STATUS ],
    UI.PresentationVariant: { SortOrder: [{ Property: ASSIGNED_DATE, Descending: true }], Visualizations: ['@UI.LineItem'] },
    UI.LineItem: [
        { Value: ASSET_TAG },
        { Value: ASSET_NAME },
        { Value: ASSIGNED_DATE },
        { Value: EXPECTED_RETURN_DATE },
        { Value: ACTUAL_RETURN_DATE },
        { Value: ASSIGNMENT_STATUS, Criticality: STATUS_CRITICALITY }
    ],
    UI.FieldGroup #General: { Data: [
        { Value: ASSET_TAG },
        { Value: ASSET_NAME },
        { Value: ASSIGNED_DATE },
        { Value: EXPECTED_RETURN_DATE },
        { Value: ACTUAL_RETURN_DATE },
        { Value: ASSIGNMENT_STATUS },
        { Value: REMARKS }
    ]},
    UI.Facets: [
        { $Type: 'UI.ReferenceFacet', Label: '{i18n>Assignment}', Target: '@UI.FieldGroup#General' }
    ]
);

annotate AssetUserService.AssetHistory with {
    FROM_EMAIL @UI.Hidden;
    TO_EMAIL   @UI.Hidden;
    ASSET_TAG  @title: '{i18n>AssetTag}';
    ASSET_NAME @title: '{i18n>AssetName}';
};

annotate AssetUserService.AssetHistory with @(
    UI.HeaderInfo: {
        TypeName       : '{i18n>HistoryEntry}',
        TypeNamePlural : '{i18n>MyHistory}',
        Title          : { Value: ASSET_TAG },
        Description    : { Value: ACTION }
    },
    UI.PresentationVariant: { SortOrder: [{ Property: TRANSITION_DATE, Descending: true }], Visualizations: ['@UI.LineItem'] },
    UI.LineItem: [
        { Value: TRANSITION_DATE },
        { Value: ASSET_TAG },
        { Value: ASSET_NAME },
        { Value: ACTION },
        { Value: FROM_EMPLOYEE_NODE_KEY },
        { Value: TO_EMPLOYEE_NODE_KEY },
        { Value: REMARKS }
    ]
);


 // Employee self-service profile: explicit columns are required by Fiori Elements.
 // Keep the profile read-only and do not expose other employees.
annotate AssetUserService.Employees with @(
    UI.HeaderInfo: {
        TypeName: 'My Profile',
        TypeNamePlural: 'My Profile',
        Title: { Value: FULL_NAME },
        Description: { Value: EMAIL }
    },
    UI.LineItem: [
        { Value: FULL_NAME, Label: 'Full Name' },
        { Value: EMAIL, Label: 'Email' },
        { Value: DEPARTMENT.NAME, Label: 'Department' },
        { Value: LOCATION, Label: 'Location' }
    ],
    UI.FieldGroup #General: { Data: [
        { Value: FULL_NAME, Label: 'Full Name' },
        { Value: EMAIL, Label: 'Email' },
        { Value: DEPARTMENT.NAME, Label: 'Department' },
        { Value: LOCATION, Label: 'Location' }
    ]},
    UI.Facets: [
        { $Type: 'UI.ReferenceFacet', Label: 'Employee Details', Target: '@UI.FieldGroup#General' }
    ]
);
