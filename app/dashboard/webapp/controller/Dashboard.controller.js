sap.ui.define(
    [
        "sap/ui/core/mvc/Controller",
        "sap/ui/model/json/JSONModel",
        "sap/ui/core/format/NumberFormat",
        "sap/m/MessageBox"
    ],
    function (Controller, JSONModel, NumberFormat, MessageBox) {
        "use strict";

        const amountFormat = NumberFormat.getFloatInstance({ maxFractionDigits: 2, groupingEnabled: true });

        const emptyFilters = () => ({ status: "", category: "", location: "", dateFrom: "", dateTo: "" });

        return Controller.extend("itam.dashboard.controller.Dashboard", {

            onInit: function () {
                this.getView().setModel(new JSONModel({}), "kpi");
                this.getView().setModel(new JSONModel({ busy: false, filters: emptyFilters(), rows: [] }), "view");
                this.loadDashboard();
            },

            i18n: function (key, args) {
                return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
            },

            // KPIs come from the function AssetManagerService.getDashboard(...) with the same filters
            // that the reports use (FR-026)
            loadDashboard: function () {
                const view = this.getView().getModel("view");
                const filters = view.getProperty("/filters");
                const binding = this.getOwnerComponent().getModel().bindContext("/getDashboard(...)");

                Object.keys(filters).forEach((name) => {
                    if (filters[name]) binding.setParameter(name, filters[name]);
                });

                view.setProperty("/busy", true);
                binding.execute()
                    .then(() => {
                        const data = binding.getBoundContext().getObject();
                        this.getView().getModel("kpi").setData(data);
                        view.setProperty("/rows", this.tableRows(data));
                    })
                    .catch((error) => MessageBox.error(this.i18n("loadError", [error.message])))
                    .finally(() => view.setProperty("/busy", false));
            },

            // text / table equivalent of all chart values (NFR-011)
            tableRows: function (data) {
                const rows = [];
                const add = (group, list) => (list || []).forEach((entry) =>
                    rows.push({ group: group, label: entry.label, count: entry.count, value: entry.value }));
                add(this.i18n("groupStatus"), data.byStatus);
                add(this.i18n("groupCategory"), data.byCategory);
                add(this.i18n("groupLocation"), data.byLocation);
                return rows;
            },

            onApply: function () {
                this.loadDashboard();
            },

            onClear: function () {
                this.getView().getModel("view").setProperty("/filters", emptyFilters());
                this.loadDashboard();
            },

            onRefresh: function () {
                this.loadDashboard();
            },

            // ---------------- drill-down into the asset list (Asset Overview app) ----------------

            openAssets: function (status) {
                const filters = this.getView().getModel("view").getProperty("/filters");
                const params = [];
                if (status || filters.status) params.push("STATUS=" + encodeURIComponent(status || filters.status));
                if (filters.location) params.push("LOCATION=" + encodeURIComponent(filters.location));
                window.location.hash = "#Asset-overview" + (params.length ? "?" + params.join("&") : "");
            },

            onNavigate: function (event) {
                this.openAssets(event.getSource().data("status"));
            },

            onStatusSegment: function (event) {
                const segment = (event.getParameter("selectedSegments") || [])[0];
                if (segment) this.openAssets(segment.data("code"));
            },

            // ---------------- formatters ----------------

            formatCount: function (value) {
                return value === null || value === undefined ? "–" : String(value);
            },

            formatAmount: function (value) {
                return value === null || value === undefined ? "–" : amountFormat.format(Number(value));
            },

            formatGenerated: function (value) {
                return value ? this.i18n("generatedAt", [new Date(value).toLocaleString()]) : "";
            }
        });
    }
);
