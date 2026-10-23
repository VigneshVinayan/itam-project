namespace itam.db;

using { managed } from '@sap/cds/common';
using { itam.common as common } from './common';

// Master data: employees, hardware categories, vendors
context master {

    // The login e-mail (XSUAA) links a user to an employee
    entity Departments : managed {
        key NODE_KEY : common.Guid;
        NAME        : common.String64;
        COST_CENTER : common.String64;
        IS_ACTIVE   : Boolean default true;
    }

    entity Employees : managed {

        key NODE_KEY : common.Guid;

        EMPLOYEE_NO : common.String32;
        FULL_NAME   : common.String255;
        EMAIL       : common.Email;
        PHONE       : common.PhoneNumber;
        // Explicit writable FK for the Employee form; same HANA column as the former generated FK.
        DEPARTMENT_NODE_KEY : common.Guid;
        DEPARTMENT : Association to Departments on DEPARTMENT.NODE_KEY = DEPARTMENT_NODE_KEY;
        LOCATION    : common.String64;
        STATUS      : common.EmployeeStatus default 'ACTIVE';
    }

    entity AssetCategories : managed {

        key NODE_KEY : common.Guid;

        NAME            : common.String64;
        DESCRIPTION     : common.String255;
        LIFESPAN_MONTHS : Integer;
        IS_ACTIVE       : Boolean default true;   // inactive = not selectable for new assets
    }

    // Suppliers (procurement) and service providers (maintenance)
    entity Vendors : managed {

        key NODE_KEY : common.Guid;

        NAME           : common.String255;
        CONTACT_PERSON : common.String64;
        EMAIL          : common.Email;
        PHONE          : common.PhoneNumber;
        IS_ACTIVE      : Boolean default true;
    }
}

// Code lists for drop-downs (value helps with fixed values)
context codes {

    entity AssetStatuses {
        key code : common.AssetStatus;
            text : common.String64;
    }

    entity MaintenanceTypes {
        key code : common.MaintenanceType;
            text : common.String64;
    }

    entity DisposalMethods {
        key code : common.DisposalMethod;
            text : common.String64;
    }

    entity ReportTypes {
        key code : common.ReportType;
            text : common.String64;
    }
}
