# 📊 ICE Register Bot - Google Sheets Apps Script Extension

ይህ ኮድ በGoogle Sheets ላይ የተማሪዎችን መረጃ፣ የክፍያ ትዕዛዞችን፣ የሪፈራል ኮሚሽን ብር ማውጫዎችን እና የላይሰንስ ቁልፎችን አውቶሜትድ በሆነ መንገድ በ 4 ታቦች (Sheets) ለመመዝገብ ያገለግላል።

---

## 🛠️ አጠቃቀም እና አሰራር (Setup Guide)

1. አዲስ **Google Sheet** ይክፈቱ (ስሙን `ICE Core Database` ይበሉት)።
2. ከላይ ከሜኑ ውስጥ **Extensions** -> **Apps Script** የሚለውን ይጫኑ።
3. ያለውን ኮድ አጥፍተው ከስር ያለውን ሙሉ ኮድ ይለጥፉት (Paste ያድርጉ)።
4. **Deploy** -> **New deployment** ይጫኑ፦
   - **Select type**: *Web app*
   - **Execute as**: *Me*
   - **Who has access**: *Anyone*
5. የሰጣችሁን **Web App URL** ኮፒ አድርገው በ `.env` ፋይልዎ ውስጥ `GOOGLE_SHEET_URL` ላይ ያስቀምጡት።

---

## 📜 የ Google Apps Script ኮድ (Code.gs)

```javascript
// Google Sheets Database for ICE Core Trading Psychology
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Ensure Tabs Exist
    const usersSheet = getOrCreateSheet(ss, "Users", ["User ID", "Name", "Username", "Points (ETB)", "Invited By", "Joined Date"]);
    const ordersSheet = getOrCreateSheet(ss, "Orders", ["Order ID", "User ID", "Name", "Phone", "Email", "Telegram", "Package", "Price", "Method", "Tx Ref", "Receipt URL", "Status", "License Key", "Created At"]);
    const payoutsSheet = getOrCreateSheet(ss, "Payouts", ["Date", "User ID", "Name", "Amount (ETB)", "Phone", "Account Name"]);
    const licensesSheet = getOrCreateSheet(ss, "Licenses", ["License Key", "Order ID", "User ID", "Email", "Status", "Created At"]);

    const action = data.action;

    // 1. Sync User Record
    if (action === "sync_user") {
      updateOrAddRow(usersSheet, 0, data.user_id, [
        data.user_id,
        data.name || "N/A",
        data.username || "N/A",
        data.points || 0,
        data.invited_by || "N/A",
        new Date().toLocaleString()
      ]);
      return createResponse({ success: true });
    }

    // 2. New Order Recorded
    if (action === "new_order") {
      ordersSheet.appendRow([
        data.order_id,
        data.user_id,
        data.name,
        data.phone,
        data.email,
        data.telegram_username,
        data.package_type,
        data.price,
        data.payment_method,
        data.tx_ref,
        data.receipt_url,
        data.status || "PENDING",
        data.license_key || "",
        new Date().toLocaleString()
      ]);
      return createResponse({ success: true });
    }

    // 3. Order Approved
    if (action === "order_approved") {
      updateOrderApproval(ordersSheet, data.order_id, data.license_key);
      licensesSheet.appendRow([
        data.license_key,
        data.order_id,
        data.user_id,
        data.email,
        "available",
        new Date().toLocaleString()
      ]);
      return createResponse({ success: true });
    }

    // 4. Payout Request
    if (action === "payout_request") {
      payoutsSheet.appendRow([
        new Date().toLocaleString(),
        data.user_id,
        data.name,
        data.amount,
        data.phone,
        data.account_name
      ]);
      return createResponse({ success: true });
    }

    // 5. Get All Data on Server Startup
    if (action === "get_all_data") {
      const usersData = extractSheetData(usersSheet);
      const ordersData = extractSheetData(ordersSheet);
      return createResponse({ success: true, users: usersData, orders: ordersData });
    }

    return createResponse({ success: false, error: "Unknown action" });
  } catch (err) {
    return createResponse({ success: false, error: err.toString() });
  }
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#0ea5e9").setFontColor("#ffffff");
  }
  return sheet;
}

function updateOrAddRow(sheet, keyColIndex, keyValue, newRow) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyColIndex]) === String(keyValue)) {
      sheet.getRange(i + 1, 1, 1, newRow.length).setValues([newRow]);
      return;
    }
  }
  sheet.appendRow(newRow);
}

function updateOrderApproval(sheet, orderId, licenseKey) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(orderId)) {
      sheet.getRange(i + 1, 12).setValue("APPROVED");
      sheet.getRange(i + 1, 13).setValue(licenseKey);
      return;
    }
  }
}

function extractSheetData(sheet) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return {};
  const headers = rows[0];
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    const key = rows[i][0];
    if (key) {
      result[key] = {};
      headers.forEach((h, idx) => {
        result[key][h.toLowerCase().replace(/[^a-z0-9]/g, "_")] = rows[i][idx];
      });
    }
  }
  return result;
}

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
```
