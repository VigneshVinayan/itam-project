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
      const comment = new TextArea({ width: '100%', rows: 2, placeholder: 'Assignment remarks' });
      const requestNote = new TextArea({ width: '100%', rows: 2, placeholder: 'Maintenance issue or approval note' });
      const due = new DatePicker({ valueFormat: 'yyyy-MM-dd', displayFormat: 'medium', width: '100%' });
      const location = new Input({ placeholder: 'Asset location' });
      const assetName = new Input({ placeholder: 'Asset name / model' });
      const pending = new List({ headerText: 'Department requests' });
      let assetRows = [];
      let employeeRows = [];
      let assignmentRows = [];
      let requestRows = [];
      const assetSummary = new Text({ text: 'Select an asset to see its status and current holder.', wrapping: true });
      const nextStep = new Text({ text: '', wrapping: true, visible: false });

      const updateAssetSummary = () => {
        const selected = assetRows.find(a => a.NODE_KEY === assets.getSelectedKey());
        if (!selected) {
          assetSummary.setText('No asset selected.');
          return;
        }
        const assignment = assignmentRows.find(a =>
          a.ASSET_NODE_KEY === selected.NODE_KEY && a.ASSIGNMENT_STATUS === 'ACTIVE');
        const holder = assignment
          ? employeeRows.find(e => e.NODE_KEY === assignment.EMPLOYEE_NODE_KEY)?.FULL_NAME || 'Employee record unavailable'
          : 'None';
        assetSummary.setText('Status: ' + selected.STATUS + ' | Current holder: ' + holder);
      };

      const requestLabel = item => {
        const employee = employeeRows.find(e => e.NODE_KEY === item.REQUESTED_BY_NODE_KEY)?.FULL_NAME || 'Unknown employee';
        const tag = assetRows.find(a => a.NODE_KEY === item.ASSET_NODE_KEY)?.ASSET_TAG || 'Unknown asset';
        const date = item.REQUESTED_AT ? new Date(item.REQUESTED_AT).toLocaleDateString() : 'Date unavailable';
        return employee + ' | ' + tag + ' | ' + item.REQUEST_TYPE + ' | ' + date + ' | ' + item.STATUS;
      };

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
          call('AssetRequests?$select=NODE_KEY,ASSET_NODE_KEY,REQUESTED_BY_NODE_KEY,REQUEST_TYPE,REQUESTED_AT,STATUS,DESCRIPTION&$orderby=REQUESTED_AT desc')
        ]);
        assetRows = a.value || [];
        employeeRows = e.value || [];
        assignmentRows = b.value || [];
        requestRows = r.value || [];
        populate(assets, assetRows, 'NODE_KEY', v => v.ASSET_TAG + ' — ' + v.ASSET_NAME + ' (' + v.STATUS + ')');
        updateActions();
        updateAssetSummary();
        populate(detailsAsset, assetRows, 'NODE_KEY', v => v.ASSET_TAG + ' — ' + v.ASSET_NAME);
        populate(requestAsset, assetRows, 'NODE_KEY', v => v.ASSET_TAG + ' — ' + v.ASSET_NAME);
        populate(employees, e.value || [], 'NODE_KEY', v => v.FULL_NAME);
        populate(assignments, (b.value || []).filter(v => v.ASSIGNMENT_STATUS === 'ACTIVE'), 'NODE_KEY', v => {
          const tag = assetRows.find(a => a.NODE_KEY === v.ASSET_NODE_KEY)?.ASSET_TAG || 'Asset';
          const who = employeeRows.find(e => e.NODE_KEY === v.EMPLOYEE_NODE_KEY)?.FULL_NAME || 'Employee';
          return tag + ' — ' + who;
        });
        populate(requests, requestRows.filter(v => v.STATUS === 'PENDING'), 'NODE_KEY', requestLabel);
        pending.destroyItems();
        for (const item of requestRows) {
          pending.addItem(new StandardListItem({
            title: requestLabel(item),
            description: item.DESCRIPTION || 'No description provided',
            wrapping: true
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
      const assignButton = button('Assign Asset', () => invoke('assignAsset', {
        asset: asset(), employee: employees.getSelectedKey(),
        expectedReturnDate: due.getValue() || null, remarks: remarks()
      }));
      const transferButton = button('Transfer Asset', () => invoke('transferAsset', {
        asset: asset(), toEmployee: employees.getSelectedKey(), remarks: remarks()
      }));
      const returnButton = button('Return Asset', () => invoke('returnAsset', { asset: asset(), remarks: remarks() }));
      const updateActions = () => {
        const status = assetRows.find(a => a.NODE_KEY === asset())?.STATUS;
        assignButton.setEnabled(status === 'AVAILABLE');
        transferButton.setEnabled(status === 'ASSIGNED');
        returnButton.setEnabled(status === 'ASSIGNED');
      };
      assets.attachChange(updateActions);
      assets.attachChange(updateAssetSummary);
      const page = new Page({
        title: 'Department Asset Operations',
        content: [new IconTabBar({
          expandable: false,
          items: [new IconTabFilter({ key: 'assignment', text: 'Asset Assignments', icon: 'sap-icon://laptop', content: [new VBox({
          width: '100%', items: [
            new Title({ text: 'Asset lifecycle' }),
            new Label({ text: 'Department asset', labelFor: assets }),
            assets,
            assetSummary,
            new Label({ text: 'Employee', labelFor: employees }),
            employees,
            new Label({ text: 'Expected return date', labelFor: due }),
            due,
            new Label({ text: 'Remarks or issue', labelFor: comment }),
            comment,
            assignButton,
            transferButton,
            returnButton,
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
            new Label({ text: 'Maintenance issue / review note', labelFor: requestNote }),
            requestNote,

            button('Raise Maintenance Request', () => invoke('raiseMaintenanceRequest', {
              asset: requestKey(), description: requestNote.getValue().trim()
            })),
            new Label({ text: 'Pending request', labelFor: requests }),
            requests,
            button('Approve Request', async () => {
              const item = requestRows.find(r => r.NODE_KEY === requests.getSelectedKey());
              if (!item) return MessageBox.error('Select a pending request.');
              try {
                await call('reviewAssetRequest', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-csrf-token': await token() },
                  body: JSON.stringify({
                    requestId: item.NODE_KEY, approve: true, note: requestNote.getValue().trim()
                  })
                });
                const next = item.REQUEST_TYPE === 'RETURN'
                  ? 'Next step: Open Asset Assignments and use Return Asset for the approved asset. Approval alone does not return it.'
                  : 'Next step: An authorized Admin must perform the required maintenance lifecycle action. Approval alone does not start maintenance.';
                nextStep.setText(next);
                nextStep.setVisible(true);
                await refresh();
                MessageBox.information('Request approved. ' + next);
              } catch (error) { MessageBox.error(error.message); }
            }),
            button('Reject Request', () => invoke('reviewAssetRequest', {
              requestId: requests.getSelectedKey(), approve: false, note: requestNote.getValue().trim()
            })),
            nextStep,
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
