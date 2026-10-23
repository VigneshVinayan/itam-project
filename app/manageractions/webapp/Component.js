sap.ui.define([
  'sap/ui/core/UIComponent', 'sap/m/App', 'sap/m/Page', 'sap/m/VBox',
  'sap/m/Label', 'sap/m/Select', 'sap/ui/core/Item', 'sap/m/TextArea',
  'sap/m/Input', 'sap/m/DatePicker', 'sap/m/Button', 'sap/m/Title',
  'sap/m/MessageToast', 'sap/m/MessageBox', 'sap/m/List', 'sap/m/StandardListItem',
  'sap/m/IconTabBar', 'sap/m/IconTabFilter', 'sap/m/Text'
], function (UIComponent, App, Page, VBox, Label, Select, Item, TextArea, Input,
             DatePicker, Button, Title, MessageToast, MessageBox, List, StandardListItem,
             IconTabBar, IconTabFilter, Text) {
  'use strict';
  const ROOT = '/odata/v4/manager/';
  async function call(path, options) {
    const response = await fetch(ROOT + path, { credentials: 'same-origin', ...options });
    if (!response.ok) {
      let body = {};
      try { body = await response.json(); } catch (e) { /* no JSON */ }
      throw new Error(body.error?.message || 'HTTP ' + response.status);
    }
    return response.json();
  }
  async function token() {
    const response = await fetch(ROOT, { credentials: 'same-origin', headers: { 'x-csrf-token': 'Fetch' } });
    if (!response.ok) throw new Error('Cannot retrieve security token');
    return response.headers.get('x-csrf-token');
  }
  return UIComponent.extend('itam.manageractions.Component', {
    metadata: { manifest: 'json' },
    createContent: function () {
      const assets = new Select({ width: '100%' });
      const employees = new Select({ width: '100%' });
      const detailsAsset = new Select({ width: '100%' });
      const requestAsset = new Select({ width: '100%' });
      const assignments = new Select({ width: '100%' });
      const requests = new Select({ width: '100%' });
      const comment = new TextArea({ width: '100%', rows: 2, placeholder: 'Reason / remarks / maintenance issue' });
      const due = new DatePicker({ valueFormat: 'yyyy-MM-dd', displayFormat: 'medium', width: '100%' });
      const location = new Input({ placeholder: 'Asset location' });
      const assetName = new Input({ placeholder: 'Asset name / model' });
      const pending = new List({ headerText: 'Department requests' });
      let assetRows = [];
      let employeeRows = [];

      const populate = (select, data, key, label) => {
        const selected = select.getSelectedKey();
        select.destroyItems();
        for (const item of data) {
          select.addItem(new Item({ key: item[key], text: label(item) }));
        }
        if (selected && select.getItemByKey(selected)) select.setSelectedKey(selected);
      };
      const refresh = async () => {
        const [a, e, b, r] = await Promise.all([
          call('Assets?$select=NODE_KEY,ASSET_TAG,ASSET_NAME,STATUS,LOCATION'),
          call('Employees?$select=NODE_KEY,FULL_NAME'),
          call('Assignments?$select=NODE_KEY,ASSET_NODE_KEY,EMPLOYEE_NODE_KEY,ASSIGNMENT_STATUS'),
          call('AssetRequests?$select=NODE_KEY,REQUEST_TYPE,STATUS,DESCRIPTION&$orderby=REQUESTED_AT desc')
        ]);
        assetRows = a.value || [];
        employeeRows = e.value || [];
        populate(assets, assetRows, 'NODE_KEY', v => v.ASSET_TAG + ' — ' + v.ASSET_NAME + ' (' + v.STATUS + ')');
        populate(detailsAsset, assetRows, 'NODE_KEY', v => v.ASSET_TAG + ' — ' + v.ASSET_NAME);
        populate(requestAsset, assetRows, 'NODE_KEY', v => v.ASSET_TAG + ' — ' + v.ASSET_NAME);
        populate(employees, e.value || [], 'NODE_KEY', v => v.FULL_NAME);
        populate(assignments, (b.value || []).filter(v => v.ASSIGNMENT_STATUS === 'ACTIVE'), 'NODE_KEY', v => {
          const tag = assetRows.find(a => a.NODE_KEY === v.ASSET_NODE_KEY)?.ASSET_TAG || 'Asset';
          const who = employeeRows.find(e => e.NODE_KEY === v.EMPLOYEE_NODE_KEY)?.FULL_NAME || 'Employee';
          return tag + ' — ' + who;
        });
        populate(requests, (r.value || []).filter(v => v.STATUS === 'PENDING'), 'NODE_KEY',
          v => v.REQUEST_TYPE + ': ' + (v.DESCRIPTION || v.NODE_KEY));
        pending.destroyItems();
        for (const item of r.value || []) {
          pending.addItem(new StandardListItem({
            title: item.REQUEST_TYPE + ' — ' + item.STATUS,
            description: item.DESCRIPTION || item.NODE_KEY
          }));
        }
        const selected = (a.value || []).find(v => v.NODE_KEY === detailsAsset.getSelectedKey());
        if (selected) { location.setValue(selected.LOCATION || ''); assetName.setValue(selected.ASSET_NAME || ''); }
      };
      const invoke = async (action, payload) => {
        try {
          await call(action, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': await token() },
            body: JSON.stringify(payload)
          });
          MessageToast.show('Operation successful');
          await refresh();
        } catch (error) { MessageBox.error(error.message); }
      };
      const button = (title, handler) => new Button({ text: title, press: handler });
      const asset = () => assets.getSelectedKey();
      const detailKey = () => detailsAsset.getSelectedKey();
      const requestKey = () => requestAsset.getSelectedKey();
      const updateDetail = () => {
        const selected = assetRows.find(v => v.NODE_KEY === detailKey());
        location.setValue(selected?.LOCATION || '');
        assetName.setValue(selected?.ASSET_NAME || '');
      };
      const remarks = () => comment.getValue().trim();
      const page = new Page({
        title: 'Department Asset Operations',
        content: [new IconTabBar({
          expandable: false,
          items: [new IconTabFilter({ key: 'assignment', text: 'Asset Assignments', icon: 'sap-icon://laptop', content: [new VBox({
          width: '100%', items: [
            new Title({ text: 'Asset lifecycle' }),
            new Label({ text: 'Department asset', labelFor: assets }),
            assets,
            new Label({ text: 'Employee', labelFor: employees }),
            employees,
            new Label({ text: 'Expected return date', labelFor: due }),
            due,
            new Label({ text: 'Remarks or issue', labelFor: comment }),
            comment,
            button('Assign Asset', () => invoke('assignAsset', {
              asset: asset(), employee: employees.getSelectedKey(),
              expectedReturnDate: due.getValue() || null, remarks: remarks()
            })),
            button('Transfer Asset', () => invoke('transferAsset', {
              asset: asset(), toEmployee: employees.getSelectedKey(), remarks: remarks()
            })),
            button('Return Asset', () => invoke('returnAsset', { asset: asset(), remarks: remarks() })),
            new Label({ text: 'Active assignment', labelFor: assignments }),
            assignments,
            button('Update Assignment', () => invoke('updateAssignment', {
              assignment: assignments.getSelectedKey(),
              expectedReturnDate: due.getValue() || null, remarks: remarks()
            })),
          ] }).addStyleClass('sapUiContentPadding'),
          ] }), new IconTabFilter({ key: 'details', text: 'Asset Details', icon: 'sap-icon://edit', content: [new VBox({ items: [
            new Text({ text: 'Only name and location of departmental assets can be edited here.' }),
            new Label({ text: 'Select department asset', labelFor: assets }),
            detailsAsset,
            new Title({ text: 'Asset details' }),
            new Label({ text: 'Name', labelFor: assetName }),
            assetName,
            new Label({ text: 'Location', labelFor: location }),
            location,
            button('Save Asset Details', async () => {
              if (!detailKey()) return MessageBox.error('Select an asset');
              try {
                const csrf = await token();
                await call('Assets(' + detailKey() + ')', {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
                  body: JSON.stringify({ ASSET_NAME: assetName.getValue(), LOCATION: location.getValue() })
                });
                MessageToast.show('Asset updated');
                await refresh();
              } catch (err) { MessageBox.error(err.message); }
            }),
          ] }).addStyleClass('sapUiContentPadding')
          ] }), new IconTabFilter({ key: 'requests', text: 'Employee Requests', icon: 'sap-icon://approvals', content: [new VBox({ items: [
            new Title({ text: 'Maintenance and request review' }),
            new Label({ text: 'Asset for maintenance', labelFor: requestAsset }),
            requestAsset,
            new Label({ text: 'Maintenance issue / review note', labelFor: comment }),

            button('Raise Maintenance Request', () => invoke('raiseMaintenanceRequest', {
              asset: requestKey(), description: remarks()
            })),
            new Label({ text: 'Pending request', labelFor: requests }),
            requests,
            button('Approve Request', () => invoke('reviewAssetRequest', {
              requestId: requests.getSelectedKey(), approve: true, note: remarks()
            })),
            button('Reject Request', () => invoke('reviewAssetRequest', {
              requestId: requests.getSelectedKey(), approve: false, note: remarks()
            })),
            button('Refresh', () => refresh().catch(err => MessageBox.error(err.message))),
            pending
          ] }).addStyleClass('sapUiContentPadding')
          ] })]
        })]
      });
      detailsAsset.attachChange(updateDetail);
      assets.attachChange(() => {
        const id = asset();
        if (!id) return;
        // Asset fields on other tabs have their own selection state.
      });
      refresh().catch(err => MessageBox.error(err.message));
      return new App({ pages: [page] });
    }
  });
});
