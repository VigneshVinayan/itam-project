# Run in SAP Business Application Studio and deploy to SAP BTP

Step-by-step guide for the IT Asset Lifecycle Manager. There are three ways to run it, each building on the previous one:

| Mode | Database | Login | Needs BTP services? | Use it for |
|---|---|---|---|---|
| **A. Local** (`cds watch`) | SQLite in memory (sample data) | test users (browser pop-up) | no | trying the app, development |
| **B. Hybrid** (`cds watch --profile hybrid` + approuter) | SAP HANA Cloud | SAP login (XSUAA) | HANA Cloud + XSUAA | testing with the real database and roles |
| **C. Deployed** (`mbt build` + `cf deploy`) | SAP HANA Cloud | SAP login (XSUAA) | HANA Cloud + XSUAA + CF runtime | a public URL for all users |

---

## 0. Prerequisites (once)

1. **SAP BTP account**: a trial (https://account.hanatrial.ondemand.com) or free-tier account.
2. **Subaccount with Cloud Foundry enabled** and a space (for example `dev`).
   Note the **API endpoint** from *Subaccount → Overview*, for example `https://api.cf.us10-001.hana.ondemand.com`.
3. **Entitlements** in the subaccount (*Entitlements → Edit*):

   | Service | Plan |
   |---|---|
   | SAP HANA Cloud | `hana-free` (free tier) or `hana` (trial), plus `tools` |
   | SAP HANA Schemas & HDI Containers | `hdi-shared` |
   | Authorization and Trust Management Service (XSUAA) | `application` |
   | Cloud Foundry Runtime | at least 1 GB memory |
   | SAP Business Application Studio | subscription |

4. **SAP HANA Cloud instance** (needed for B and C):
   - Open *SAP HANA Cloud Central* (subscribe to *SAP HANA Cloud* with plan `tools` if it is not listed).
   - *Create Instance → SAP HANA Database*: set a password and *Allowed connections: Allow all IP addresses*.
   - *Instance Mapping*: map it to your Cloud Foundry **org and space** (or create it directly in the space).
   - Wait until the status is **Running**. Trial / free-tier instances **stop every night**; start them again in HANA Cloud Central.
5. **Users**: everyone who logs in needs an SAP account (free at https://accounts.sap.com) and must be added to the subaccount (*Security → Users*).

---

## 1. Create the BAS dev space (once)

1. Open **SAP Business Application Studio** from the subaccount (*Instances and Subscriptions*).
2. *Create Dev Space* → name `itam` → type **Full Stack Cloud Application** → *Create Dev Space* → start it and open it.
3. Open a terminal (*Terminal → New Terminal*) and check Node.js:
   ```bash
   node -v        # must be v22 or higher (the approuter needs it)
   ```
   If it is lower: `nvm install 22 && nvm use 22`.

---

## 2. Get the code

```bash
cd ~/projects
# after the pull request is merged:
git clone https://github.com/VigneshVinayan/SAP-2026-Project.git itam
# before that, use the feature branch (private repo: BAS asks for your GitHub user + a personal access token as password):
# git clone -b feature/it-asset-lifecycle-manager https://github.com/saurabh-1907/ITAM.git itam
cd itam
npm install
```

---

## A. Run locally (no BTP services needed)

```bash
cds watch
```

1. BAS shows a pop-up for port **4004**. Choose **Open in a New Tab**.
2. Add `/index.html` to the URL if the launchpad does not open by itself.
3. The browser asks for a user and password. Use one of the test users:

   | User | Password | Role | Tiles |
   |---|---|---|---|
   | `admin@itam-demo.com` | `admin` | Admin | Dashboard, Reports, Manage Assets, Employees, Categories, Vendors, Audit Log |
   | `manager@itam-demo.com` | `manager` | Manager | Dashboard, Reports, Asset Overview |
   | `ravi.kumar@itam-demo.com` | `user` | User | Hardware Inventory, My Assignments, My Asset History |

   To switch user, open the URL in a new private / incognito window (the browser remembers the login).

Data lives in memory: every restart resets it to the sample data in `db/data`. E-mails are not sent, only written to
the terminal log (`[mail] - (no mail-api configured) ...`).

Run the automated tests at any time:
```bash
npm test          # 40 tests
```

---

## B. Run in hybrid mode (SAP HANA Cloud + XSUAA login)

The CAP server runs in BAS but uses the real HANA database and the real SAP login.

### B1. Log in to Cloud Foundry
```bash
cf login -a https://api.cf.us10-001.hana.ondemand.com     # your API endpoint from step 0
# choose your org and the space (e.g. dev)
```
(Or *View → Command Palette → CF: Login to Cloud Foundry*.)

### B2. Put your own login e-mails into the sample data
A login is linked to an employee by e-mail. Open `db/data/itam.db-master.Employees.csv` and replace
`admin@itam-demo.com`, `manager@itam-demo.com` and `ravi.kumar@itam-demo.com` with the e-mail addresses
of your SAP accounts (lower case). The roles come from XSUAA (step B5), not from this file.

### B3. Create the XSUAA instance and bind it (once)
```bash
cf create-service xsuaa application itam-hybrid-auth -c xs-security.json
cds bind auth --to itam-hybrid-auth
```

### B4. Deploy the tables and sample data to HANA and start the server
```bash
cds build --production
cds deploy --to hana          # creates the HDI container 'itam-application-db' and binds it
cds watch --profile hybrid
```
The bindings are stored in `.cdsrc-private.json` (git-ignored). Port 4004 alone now answers **401**, which is expected:
the login happens in the approuter.

### B5. Give yourself the roles (once)
BTP cockpit → *Subaccount → Security → Users* → select your user → *Assign Role Collection* →
**ITAM_Admin**, **ITAM_Manager** and/or **ITAM_User**. Log out and log in again after a change.

### B6. Start the approuter (second terminal), which is where you log in
Run it from the **project root**, because the XSUAA binding is stored there:
```bash
npm install --prefix .deploy/app-router
cds bind --exec --profile hybrid -- npm start --prefix .deploy/app-router
```
Open port **5000** (*Open in a New Tab*). You get the SAP login page and then the Fiori launchpad with the tiles of your role.
Log out with `<url>/do/logout`.

After model changes (`db/*.cds` or CSV): `cds build --production && cds deploy --to hana` again.

---

## C. Deploy to Cloud Foundry (public URL)

### C1. Build and deploy
```bash
cd ~/projects/itam
git pull                 # latest code
npm install
cf login                 # if not logged in (step B1)
mbt build                # creates mta_archives/itam-application_1.0.0.mtar
cf deploy mta_archives/itam-application_1.0.0.mtar
```
(Or right-click `mta.yaml` → *Build MTA Project*, then right-click the `.mtar` → *Deploy MTA Archive*.)

`cf deploy` creates or updates:

| Name | What |
|---|---|
| `itam-application-db` | HDI container (`hdi-shared`); tables and sample data are deployed by `itam-application-db-deployer` |
| `itam-application-auth` | XSUAA instance (`application`) with the role collections |
| `itam-application-srv` | CAP server (Node.js, 512 MB) incl. the Fiori apps |
| `itam-application` | Approuter (256 MB), **the app URL** |

### C2. Open the app
```bash
cf apps                  # copy the route of 'itam-application'
```
Open `https://<that route>` to reach the SAP login and the launchpad.

### C3. Assign roles
BTP cockpit → *Security → Role Collections*: the deployment creates collections with the org and space in the name:
- **ITAM_Admin (<org>-<space>)**
- **ITAM_Manager (<org>-<space>)**
- **ITAM_User (<org>-<space>)**

Open a collection → *Edit* → add users (identity provider *Default identity provider*, the user's e-mail) → *Save*.
Every user should also exist in **Employees** with the same e-mail. Maintain them in the *Employees* app as Admin, or put them into the CSV before deploying.

### C4. Update after code changes
```bash
git pull && npm install && mbt build && cf deploy mta_archives/itam-application_1.0.0.mtar
```

### C5. Remove everything
```bash
cf undeploy itam-application --delete-services --delete-service-keys
cf delete-service itam-hybrid-auth     # the hybrid XSUAA instance from step B3
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `cds deploy --to hana` / app start fails with a connection error | HANA Cloud instance is stopped (trial: every night). Start it in HANA Cloud Central, then `cf restart itam-application-srv` |
| `cf deploy` fails with *quota* / *memory* | free some memory in the space (`cf apps`, `cf stop <app>`) or raise the CF Runtime entitlement |
| Launchpad shows no tiles / only some tiles | role collection missing. Assign it (C3), then log out (`/do/logout`) and log in again. `…/odata/v4/app/whoAmI()` shows the roles the server sees |
| "My Assignments" is empty | your login e-mail is not the e-mail of an Employee. Fix it in the Employees app (Admin) |
| Port 4004 answers 401 in hybrid mode | expected. Use the approuter on port 5000 |
| Server errors | `cf logs itam-application-srv --recent` |

## Optional: real e-mail delivery

Without further configuration the *E-Mail PDF* button only logs the mail (`srv/mail-service.js`). To send real mails,
an HTTP e-mail or notification API must be reachable through a BTP Destination. This is **not set up in `mta.yaml`** yet. It needs:
1. a Destination (for example `ITAM_MAIL_API`) in the subaccount pointing to the mail API,
2. the Destination service bound to `itam-application-srv` and the `@sap-cloud-sdk/http-client` package added,
3. in `package.json` → `cds.requires`:
   ```json
   "mail-api": { "kind": "rest", "credentials": { "destination": "ITAM_MAIL_API", "path": "/send" } }
   ```
