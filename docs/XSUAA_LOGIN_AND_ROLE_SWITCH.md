# SAP BTP login and role-based Fiori access (XSUAA)

This project uses **SAP Authorization and Trust Management (XSUAA)** for
**hybrid** and **deployed** environments. Do not use the temporary
`admin@itam-demo.com/admin` browser Basic Auth accounts in XSUAA mode.

## Important URLs

- **CAP HANA API**: BAS port **4004**. This is the backend and does **not**
  display SAP login or implement `/do/logout`.
- **SAP Approuter**: BAS port **5000**, started separately. This is the
  application entry point for SAP sign-in, role-aware Fiori tiles and
  `/do/logout`. The Approuter forwards authenticated tokens to CAP.

## SAP BTP setup (once)

1. In the SAP BTP subaccount, enable Cloud Foundry and the XSUAA
   `application` service plan. Sign in to your CF org/space.
2. Ensure `xs-security.json` has the Admin, Manager, User templates.
   Create or update an XSUAA instance:
   ```sh
   cf create-service xsuaa application itam-hybrid-auth -c xs-security.json
   # If it already exists: cf update-service itam-hybrid-auth -c xs-security.json
   ```
3. Bind XSUAA to your hybrid CAP runtime:
   ```sh
   npx cds bind -2 itam-hybrid-auth
   ```
   Do not commit `.cdsrc-private.json` or service keys.
4. Assign SAP **role collections** through BTP Cockpit → Security →
   Role Collections / Users (depending on the cockpit UI). A role collection
   must grant `$XSAPPNAME.Admin`, `Manager`, or `User` for the
   XSUAA app created in your space.
5. The signed-in SAP identity must match the e-mail of the employee in
   the existing HANA `Employees` entity for user/manager record scoping.
   Maintain this through Admin employee management; do not overwrite
   HANA seed data just to make a demo account work.

## Start in BAS (two terminals)

Your HANA connection/binding must already be working. These commands do
not deploy/migrate the HANA database.

Terminal A:
```sh
npm install
npx cds env get requires.auth --profile hybrid
npx cds watch --profile hybrid
```
The auth kind must be `xsuaa`. If binding credentials are missing, fix
`cds bind` first. An API visit to port 4004 without a bearer token
may return 401; this is expected.

Terminal B:
```sh
npm install --prefix .deploy/app-router
PORT=5000 npx cds bind --exec --profile hybrid -- npm start --prefix .deploy/app-router
```
Open the BAS port **5000** URL, not the port 4004 URL, to use SAP login
and logout. Ensure the SAP Approuter's backend destination resolves to
the running CAP service on 4004.

## Verify account and role

Inside the port 5000 session, open `/odata/v4/app/whoAmI()` and verify
`isAdmin`, `isManager`, `isUser` and `employee`.

- **Admin**: lifecycle/master-data pages, dashboard, reports and
  Department Operations.
- **Manager**: Dashboard, Reports, Asset Overview, Department Operations
  (department-scoped access only).
- **User**: My Hardware, My Assignments, My Profile, Asset Requests,
  My Asset History (employee-scoped access).
- SAP role-collection assignments, not a client-side dropdown, determine
  authorization; hiding a tile never grants or removes access.

## Switching between SAP roles/accounts

Select **Sign Out** from the Fiori profile menu on **port 5000**.
The Approuter logout endpoint ends its session. SAP Identity Provider SSO
may automatically log in the same SAP identity; use an identity-provider
logout/account chooser or a separate browser profile when necessary.

To see strictly one role's pages, test with **different SAP identities**
assigned distinct role collections. Assigning Admin + Manager + User to
one SAP identity grants the union of those roles; do not pretend that a
frontend role selector securely revokes the backend's granted privileges.

## BAS local configuration cautions

If `git stash` contains your previous `package.json`, `mta.yaml` or
`package-lock.json`, **do not blindly `stash pop`**. Compare and
preserve environment settings. The source `package.json` specifies
`@sap/xssec`; run `npm install` and retain the generated
`package-lock.json` changes in BAS until reconciled.

Production deployments require a bound XSUAA instance and a working
Approuter; a passing CI test that uses mocked authentication does not
prove end-to-end SAP account login.
