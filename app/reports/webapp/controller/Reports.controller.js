sap.ui.define(
    [
        "sap/ui/core/mvc/Controller",
        "sap/ui/model/json/JSONModel",
        "sap/m/Column",
        "sap/m/ColumnListItem",
        "sap/m/Text",
        "sap/m/Label",
        "sap/m/Dialog",
        "sap/m/Button",
        "sap/m/TextArea",
        "sap/m/VBox",
        "sap/m/MessageToast"
    ],
    function (Controller, JSONModel, Column, ColumnListItem, Text, Label, Dialog, Button, TextArea, VBox, MessageToast) {
        "use strict";

        const FILTERS = ["status", "category", "department", "location", "dateFrom", "dateTo"];

        const emptyFilters = () => ({
            reportType: "ASSET_INVENTORY", status: "", category: "", department: "", location: "", dateFrom: "", dateTo: ""
        });

        // unique key per e-mail request: a retry with the same key never sends twice (NFR-009)
        const newRequestId = () => (window.crypto && window.crypto.randomUUID
            ? window.crypto.randomUUID()
            : String(Date.now()) + Math.random().toString(16).slice(2));

        return Controller.extend("itam.reports.controller.Reports", {

            onInit: function () {
                this.getView().setModel(new JSONModel({
                    busy: false,
                    filters: emptyFilters(),
                    preview: {},
                    previewTitle: "",
                    limitText: "",
                    export: {},
                    message: {},
                    email: { recipients: "", requestId: "" }
                }), "view");
                this.onPreview();
            },

            i18n: function (key, args) {
                return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
            },

            state: function () {
                return this.getView().getModel("view");
            },

            // deferred OData operation with the current report type + filters
            operation: function (name, extra) {
                const filters = this.state().getProperty("/filters");
                const binding = this.getOwnerComponent().getModel().bindContext("/" + name + "(...)");
                binding.setParameter("reportType", filters.reportType);
                FILTERS.forEach((filter) => {
                    if (filters[filter]) binding.setParameter(filter, filters[filter]);
                });
                Object.keys(extra || {}).forEach((key) => binding.setParameter(key, extra[key]));
                return binding;
            },

            run: function (binding) {
                const state = this.state();
                state.setProperty("/busy", true);
                return binding.execute()
                    .then(() => binding.getBoundContext().getObject())
                    .finally(() => state.setProperty("/busy", false));
            },

            message: function (type, text) {
                this.state().setProperty("/message", { type: type, text: text });
            },

            // ---------------- preview (exactly the data that goes into the PDF) ----------------

            onPreview: function () {
                const state = this.state();
                state.setProperty("/export", {});
                this.run(this.operation("previewReport"))
                    .then((preview) => {
                        state.setProperty("/preview", preview);
                        state.setProperty("/previewTitle", this.i18n("previewTitle", [preview.title, preview.rowCount]));
                        state.setProperty("/limitText", preview.rows.length < preview.rowCount
                            ? this.i18n("previewLimited", [preview.rows.length, preview.rowCount]) : "");
                        this.renderTable(preview);
                    })
                    .catch((error) => this.message("Error", error.message));
            },

            renderTable: function (preview) {
                const table = this.byId("previewTable");
                table.removeAllColumns();
                table.unbindItems();

                preview.columns.forEach((name, index) => table.addColumn(new Column({
                    header: new Label({ text: name, wrapping: true }),
                    minScreenWidth: index < 4 ? "" : "Tablet",
                    demandPopin: index >= 4
                })));

                table.setModel(new JSONModel({ rows: preview.rows }), "preview");
                table.bindItems({
                    path: "preview>/rows",
                    factory: (id, context) => new ColumnListItem(id, {
                        cells: context.getProperty("cells").map((value) => new Text({ text: value }))
                    })
                });
            },

            onClear: function () {
                this.state().setProperty("/filters", emptyFilters());
                this.onPreview();
            },

            // ---------------- export + download (FR-022, FR-024) ----------------

            onExport: function () {
                return this.run(this.operation("exportReport"))
                    .then((result) => {
                        this.state().setProperty("/export", result);
                        this.message("Success", this.i18n("exported",
                            [result.fileName, result.rowCount, new Date(result.expiresAt).toLocaleTimeString()]));
                        return result;
                    })
                    .catch((error) => {
                        this.message("Error", this.i18n("exportFailed", [error.message]));
                        throw error;
                    });
            },

            onDownload: function () {
                const result = this.state().getProperty("/export");
                if (!result?.downloadUrl) {
                    this.message("Warning", "Export the report before downloading its PDF.");
                    return;
                }
                const opened = window.open(result.downloadUrl, "_blank", "noopener");
                if (!opened) {
                    this.message("Warning", "Your browser blocked the PDF tab. Allow popups for BAS and try downloading again.");
                }
            },

            // ---------------- e-mail (FR-023) ----------------

            onOpenEmail: function () {
                const state = this.state();
                state.setProperty("/email", { recipients: "", requestId: newRequestId() });

                if (!this.emailDialog) {
                    this.emailDialog = new Dialog({
                        title: this.i18n("emailTitle"),
                        contentWidth: "28rem",
                        content: new VBox({
                            items: [
                                new Label({ text: this.i18n("emailRecipients"), required: true, labelFor: this.createId("recipients") }),
                                new TextArea(this.createId("recipients"), {
                                    value: "{view>/email/recipients}", width: "100%", rows: 3,
                                    placeholder: "name@company.com, other@company.com"
                                }),
                                new Text({ text: this.i18n("emailHint") })
                            ]
                        }).addStyleClass("sapUiSmallMargin"),
                        beginButton: new Button({ text: this.i18n("send"), type: "Emphasized", press: () => this.onSendEmail() }),
                        endButton: new Button({ text: this.i18n("cancel"), press: () => this.emailDialog.close() })
                    });
                    this.getView().addDependent(this.emailDialog);
                }
                this.emailDialog.open();
            },

            onSendEmail: function () {
                const email = this.state().getProperty("/email");
                if (!email.recipients.trim()) {
                    MessageToast.show(this.i18n("emailInvalid"));
                    return;
                }

                this.run(this.operation("emailReport", { recipients: email.recipients, requestId: email.requestId }))
                    .then((result) => {
                        if (result.status === "SENT") {
                            this.message("Success", this.i18n("emailSent", [result.recipients]));
                            this.emailDialog.close();
                        } else if (result.status === "SIMULATED") {
                            this.message("Warning", result.message || "E-mail was logged locally; it was not sent.");
                            this.emailDialog.close();
                        } else if (result.status === "DUPLICATE") {
                            this.message("Information", result.message || this.i18n("emailDuplicate", [""]));
                            this.emailDialog.close();
                        } else {
                            // keep the dialog (and the request id) so "Send" can be retried safely
                            this.message("Error", result.message || this.i18n("emailFailed", ["Unknown delivery error"]));
                        }
                    })
                    .catch((error) => this.message("Error", this.i18n("emailFailed", [error.message])));
            }
        });
    }
);
