sap.ui.define([
    'sap/ui/core/UIComponent', 'sap/m/App', 'sap/m/Page', 'sap/m/VBox',
    'sap/m/Label', 'sap/m/Select', 'sap/ui/core/Item', 'sap/m/TextArea',
    'sap/m/Button', 'sap/m/List', 'sap/m/StandardListItem',
    'sap/m/MessageToast', 'sap/m/MessageBox', 'sap/m/Title'
], function (UIComponent, App, Page, VBox, Label, Select, Item, TextArea,
             Button, List, StandardListItem, MessageToast, MessageBox, Title) {
    'use strict';

    const ROOT = '/odata/v4/user/';
    async function json(url, options) {
        const response = await fetch(ROOT + url, { credentials: 'same-origin', ...options });
        if (!response.ok) {
            let body = {};
            try { body = await response.json(); } catch (e) { /* text response */ }
            throw new Error(body.error?.message || 'HTTP ' + response.status);
        }
        return response.json();
    }
    async function csrf() {
        const response = await fetch(ROOT, {
            method: 'GET', credentials: 'same-origin',
            headers: { 'x-csrf-token': 'Fetch' }
        });
        if (!response.ok) throw new Error('Cannot retrieve CSRF token');
        return response.headers.get('x-csrf-token');
    }

    return UIComponent.extend('itam.myrequests.Component', {
        metadata: { manifest: 'json' },
        createContent: function () {
            const choice = new Select({ width: '100%' });
            const note = new TextArea({
                width: '100%', rows: 3, placeholder: 'Describe the reason or maintenance issue'
            });
            const list = new List({ headerText: 'My requests' });
            const refresh = async () => {
                const identity = await fetch('/odata/v4/app/whoAmI()', { credentials: 'same-origin' });
                if (identity.ok) {
                    const who = await identity.json();
                    if (!who.employee) {
                        MessageBox.warning('This login is not linked to an Employee record. Ask an Admin to set the Employee email to your exact login, or use a linked mock user in the hybrid profile.');
                        return;
                    }
                }
                const [assets, requests] = await Promise.all([
                    json('Assets?$select=NODE_KEY,ASSET_TAG,ASSET_NAME'),
                    json('AssetRequests?$orderby=REQUESTED_AT desc&$top=30')
                ]);
                choice.destroyItems();
                for (const a of assets.value || []) {
                    choice.addItem(new Item({ key: a.NODE_KEY, text: a.ASSET_TAG + ' — ' + a.ASSET_NAME }));
                }
                list.destroyItems();
                for (const r of requests.value || []) {
                    list.addItem(new StandardListItem({
                        title: r.REQUEST_TYPE + ' — ' + r.STATUS,
                        description: r.DESCRIPTION || r.REQUESTED_AT
                    }));
                }
            };
            const submit = async type => {
                if (!choice.getSelectedKey()) {
                    MessageBox.error('Select one of your assigned assets.');
                    return;
                }
                const description = note.getValue().trim();
                if (type === 'Maintenance' && !description) {
                    MessageBox.error('Please describe the maintenance issue.');
                    return;
                }
                try {
                    const token = await csrf();
                    await json(type === 'Return' ? 'submitReturnRequest' : 'submitMaintenanceRequest', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
                        body: JSON.stringify({ asset: choice.getSelectedKey(), description: description })
                    });
                    MessageToast.show(type + ' request submitted');
                    note.setValue('');
                    await refresh();
                } catch (e) {
                    MessageBox.error(e.message.includes('No employee matches the current login')
                        ? 'Your login has no matching Employee in HANA. Ask an Admin to create or correct your Employee email, or check the hybrid login user.'
                        : e.message);
                }
            };
            const page = new Page({
                title: 'My Asset Requests',
                content: [new VBox({
                    width: '100%', renderType: 'Bare',
                    items: [
                        new Title({ text: 'Request an asset return or maintenance' }),
                        new Label({ text: 'Assigned asset', labelFor: choice }),
                        choice,
                        new Label({ text: 'Reason / issue', labelFor: note }),
                        note,
                        new Button({ text: 'Request Return', press: () => submit('Return') }),
                        new Button({ text: 'Request Maintenance', press: () => submit('Maintenance') }),
                        new Button({ text: 'Refresh Requests', press: () => refresh().catch(e => MessageBox.error(e.message)) }),
                        list
                    ]
                }).addStyleClass('sapUiContentPadding sapUiSmallMargin')]
            });
            refresh().catch(e => MessageBox.error(e.message));
            return new App({ pages: [page] });
        }
    });
});
