const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");
const ts = require("typescript");
const { createFixture, invokeRead, state } = require("./rendererReadFixture.cjs");

const backupServiceState = {
  saveSelection: null,
  openSelection: null,
  saveOptions: null,
  openOptions: null,
  invocations: [],
};

const originalModuleLoad = Module._load;
Module._load = function loadWithTauriReadMock(request, parent, isMain) {
  if (request === "@tauri-apps/api/core") {
    return {
      invoke: async (command, args = {}) => {
        if (
          command === "create_database_backup" ||
          command === "restore_database_backup" ||
          command === "save_medicine_import_template"
        ) {
          backupServiceState.invocations.push({ command, args });
          if (command === "save_medicine_import_template") return;
          return command === "create_database_backup"
            ? {
                path: args.destinationPath,
                photoCount: 2,
                ignoredOrphanedPhotoCount: 1,
              }
            : {
                safetyBackupPath: "/local/backups/before-restore.zip",
                sourceFormat: "legacyDatabaseOnly",
                restoredPhotoCount: 2,
                ignoredOrphanedPhotoCount: 0,
              };
        }
        return invokeRead(command, args);
      },
    };
  }
  if (request === "@tauri-apps/plugin-dialog") {
    return {
      open: async (options) => {
        backupServiceState.openOptions = options;
        return backupServiceState.openSelection;
      },
      save: async (options) => {
        backupServiceState.saveOptions = options;
        return backupServiceState.saveSelection;
      },
    };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

require.extensions[".ts"] = (loadedModule, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  loadedModule._compile(compiled.outputText, filename);
};

require.extensions[".tsx"] = (loadedModule, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  loadedModule._compile(compiled.outputText, filename);
};

const {
  getInventoryMedicines,
  getMedicineBatches,
  searchMedicines,
  getFefoBatch,
  getSellableBatches,
  allocateFefoStock,
  getLowStockAlerts,
  getExpiryAlerts,
} = require("../src/services/inventoryService.ts");
const { getSuppliers } = require("../src/services/supplierService.ts");
const { getStoreSettings } = require("../src/services/settingsService.ts");
const { getRecentPurchases } = require("../src/services/purchaseService.ts");
const { getRecentSales, getSaleDetails } = require("../src/services/salesService.ts");
const { calculateOrderSuggestion } = require("../src/services/orderSuggestion.ts");
const { getDashboardSnapshot } = require("../src/services/dashboardService.ts");
const {
  getSalesReport,
  getSalesReportSummary,
} = require("../src/services/reportsService.ts");
const {
  buildWeek,
  formatCompactMoney,
  getWeekRange,
} = require("../src/components/dashboard/weeklySalesModel.ts");
const {
  normalizeBarcode,
  parseSalePriceDraft,
  resolveBarcodeLookup,
} = require("../src/components/pos/posBillingModel.ts");
const {
  buildBarcodeLabelSources,
  parseBarcodeLabelQuantity,
  maximumBarcodeLabelQuantity,
} = require("../src/services/barcodeLabelService.ts");
const {
  downloadMedicineImportTemplate,
  buildStockWorkbookBuffer,
  filterStockExportRows,
} = require("../src/services/inventoryWorkbookService.ts");
const {
  getReceiptPageRule,
  isReceiptWidth,
} = require("../src/components/pos/receiptPrintModel.ts");
const { ReceiptPrint } = require("../src/components/pos/ReceiptPrint.tsx");
const {
  exportFinancialReportExcel,
} = require("../src/services/financialReportExportService.ts");
const {
  createDatabaseBackup,
  restoreDatabaseBackup,
  selectBackupDestination,
  selectRestoreSource,
} = require("../src/services/backupService.ts");
const ExcelJS = require("exceljs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
let fixture;

beforeEach(() => {
  fixture = createFixture();
  backupServiceState.saveSelection = null;
  backupServiceState.openSelection = null;
  backupServiceState.saveOptions = null;
  backupServiceState.openOptions = null;
  backupServiceState.invocations = [];
});

afterEach(() => {
  fixture?.close();
  fixture = null;
});

describe("medicine import template download", () => {
  it("saves a valid Excel workbook through the native dialog and handles cancellation", async () => {
    assert.equal(await downloadMedicineImportTemplate(), false);
    assert.deepEqual(backupServiceState.invocations, []);
    assert.equal(
      backupServiceState.saveOptions.defaultPath,
      "MY-MEDICAL-Medicine-Import-Template.xlsx",
    );
    assert.deepEqual(backupServiceState.saveOptions.filters, [
      { name: "Excel workbook", extensions: ["xlsx"] },
    ]);

    backupServiceState.saveSelection = "/local/my-medical-medicine-import-template.xlsx";
    assert.equal(await downloadMedicineImportTemplate(), true);
    assert.equal(backupServiceState.invocations[0].command, "save_medicine_import_template");
    assert.equal(
      backupServiceState.invocations[0].args.destinationPath,
      "/local/my-medical-medicine-import-template.xlsx",
    );
    assert.ok(Array.isArray(backupServiceState.invocations[0].args.workbookBytes));
    assert.deepEqual(
      backupServiceState.invocations[0].args.workbookBytes.slice(0, 4),
      [0x50, 0x4b, 0x03, 0x04],
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      Buffer.from(backupServiceState.invocations[0].args.workbookBytes),
    );
    assert.equal(workbook.getWorksheet("Medicine Import").getCell("A1").value, "Medicine ID");
    assert.equal(workbook.getWorksheet("Instructions").getCell("A1").value, "Field");
  });
});

describe("invoice print document and page settings", () => {
  const sale = {
    sale: {
      id: 81,
      invoice_no: "INV-WIN-001",
      created_at: "2026-10-05T12:00:00Z",
      customer_name: "Print Test Customer",
      customer_phone: "9876543210",
      customer_state_code: null,
      subtotal: 120,
      discount: 0,
      flat_discount: 0,
      grand_total: 120,
      payment_mode: "CASH",
      cash_tendered: 200,
      change_due: 80,
      status: "ACTIVE",
      payment_reference: null,
      notes: null,
      cancelled_at: null,
      gst_enabled: false,
    },
    items: [
      {
        id: 91,
        sale_id: 81,
        batch_id: 31,
        quantity: 2,
        unit_price: 60,
        item_discount: 0,
        total_price: 120,
        medicine_name: "Print Test Medicine",
        generic_name: null,
        batch_no: "LOT-PRINT-01",
        expiry_date: "2027-10-31",
        returned_quantity: 0,
      },
    ],
    returns: [],
    corrections: [],
    void: null,
  };

  it("renders real invoice data in the print window", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReceiptPrint, {
        autoPrint: false,
        inPrintWindow: true,
        onClose: () => {},
        sale,
      }),
    );
    assert.match(markup, /data-testid="receipt-paper"/);
    assert.match(markup, /INV-WIN-001/);
    assert.match(markup, /Print Test Customer/);
    assert.match(markup, /Print Test Medicine/);
    assert.match(markup, /LOT-PRINT-01/);
    assert.match(markup, /Grand total/);
    assert.match(markup, /Cash received/);
    assert.match(markup, /MY MEDICAL/);
    assert.doesNotMatch(markup, /PHARMACY/);
    assert.doesNotMatch(markup, /<style/);
  });

  it("preserves the selected page format and validates every supported width", () => {
    assert.equal(getReceiptPageRule("58"), "@page { size: auto; margin: 0; }");
    assert.equal(getReceiptPageRule("80"), "@page { size: auto; margin: 0; }");
    assert.equal(
      getReceiptPageRule("A4"),
      "@page { size: A4 portrait; margin: 10mm; }",
    );
    assert.equal(
      getReceiptPageRule("A5"),
      "@page { size: A5 portrait; margin: 10mm; }",
    );
    for (const width of ["58", "80", "A4", "A5"]) {
      assert.equal(isReceiptWidth(width), true);
    }
    assert.equal(isReceiptWidth("letter"), false);
  });

  it("keeps the directly mounted invoice window open after printing", () => {
    const receiptPrintSource = fs.readFileSync(
      path.join(__dirname, "../src/components/pos/ReceiptPrint.tsx"),
      "utf8",
    );
    const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.tsx"), "utf8");
    const receiptWindowSource = fs.readFileSync(
      path.join(__dirname, "../src/components/pos/ReceiptPrintWindow.tsx"),
      "utf8",
    );
    const rustSource = fs.readFileSync(
      path.join(__dirname, "../src-tauri/src/lib.rs"),
      "utf8",
    );
    assert.match(receiptPrintSource, /window\.addEventListener\("afterprint", handleAfterPrint\)/);
    assert.match(receiptPrintSource, /const resetPrintProtection = useCallback/);
    assert.match(receiptPrintSource, /await invoke\("set_receipt_print_active", \{ active: false \}\)/);
    assert.match(receiptPrintSource, /void resetPrintProtection\(\)/);
    assert.doesNotMatch(receiptPrintSource, /close_receipt_print_window/);
    assert.match(
      receiptPrintSource,
      /return inPrintWindow \? receiptDocument : createPortal\(receiptDocument, document\.body\)/,
    );
    assert.match(receiptPrintSource, /document\.head\.appendChild\(pageStyle\)/);
    assert.match(mainSource, /receiptWidth/);
    assert.match(receiptPrintSource, /paperWidth: width/);
    assert.match(receiptWindowSource, /initialWidth=\{paperWidth\}/);
    assert.match(receiptWindowSource, /className="receipt-print-host"/);
    assert.match(receiptPrintSource, /printInProgress\.current/);
    assert.match(
      receiptPrintSource,
      /disabled=\{isPrinting \|\| !settingsLoaded \|\| Boolean\(settingsLoadError\)\}/,
    );
    assert.match(receiptWindowSource, /Receipt data did not load within 15 seconds/);
    assert.match(receiptPrintSource, /storeSettings\?\.address/);
    assert.match(receiptPrintSource, /storeSettings\?\.contact_number/);
    assert.match(receiptPrintSource, /storeSettings\?\.drug_license_number/);

    const openWindowStart = rustSource.indexOf("fn open_receipt_print_window");
    const closeWindowStart = rustSource.indexOf("fn close_receipt_print_window", openWindowStart);
    const openWindowSource = rustSource.slice(openWindowStart, closeWindowStart);
    assert.match(openWindowSource, /get_webview_window\("receipt-print"\)/);
    assert.match(openWindowSource, /existing_window\s*\.eval/);
    assert.match(openWindowSource, /existing_window\s*\.set_focus/);
    assert.doesNotMatch(openWindowSource, /existing_window\s*\.close/);
  });
});

describe("consolidated pharmacy maintenance contracts", () => {
  it("reports whether saving the import workbook succeeded or was canceled", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../src/components/inventory/MedicineImportDialog.tsx"),
      "utf8",
    );
    assert.match(source, /const saved = await downloadMedicineImportTemplate\(\)/);
    assert.match(source, /Medicine import template saved\./);
    assert.match(source, /Template save canceled\. No file was created\./);
    assert.match(source, /data-testid="status-import-template"/);
  });

  it("keeps purchase inputs aligned with their headers and supports multiple lines", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../src/components/purchases/PurchasesPage.tsx"),
      "utf8",
    );
    const positions = [
      "aria-label={`Expiry date on line ${index + 1}`}",
      "aria-label={`Purchase rate on line ${index + 1}`}",
      "aria-label={`MRP on line ${index + 1}`}",
      "aria-label={`Sale rate on line ${index + 1}`}",
      "aria-label={`Quantity on line ${index + 1}`}",
      "aria-label={`GST rate override on line ${index + 1}; leave blank for medicine rate`}",
    ].map((marker) => source.indexOf(marker));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
    assert.match(source, /data-testid=\{`row-purchase-line-\$\{index \+ 1\}`\}/);
    assert.match(source, /dd-mm-yyyy/);
    assert.match(source, /Add line/);
  });

  it("offers the requested expiry horizons while keeping expired stock visible", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../src/components/medicine-views/MedicineViews.tsx"),
      "utf8",
    );
    assert.match(source, /\{ value: 5, label: "5 days" \}/);
    assert.match(source, /\{ value: 7, label: "7 days" \}/);
    assert.match(source, /\{ value: 10, label: "10 days" \}/);
    assert.match(source, /\{ value: 30, label: "1 month \(30 days\)" \}/);
    assert.match(source, /\{ value: 3650, label: "All upcoming" \}/);
    assert.match(source, /Expired batches stay visible at every horizon/);
  });

  it("shows customer activity oldest-to-newest with paid, due, and running balances", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../src/components/customers/CustomersPage.tsx"),
      "utf8",
    );
    assert.match(source, /return ledger\.filter\(\(entry\) =>/);
    assert.doesNotMatch(source, /\[\.\.\.ledger\]\.reverse\(\)/);
    assert.match(source, /Collected/);
    assert.match(source, /Balance due/);
    assert.match(source, /formatMoney\(entry\.running_balance\)/);
    assert.match(source, /button-customer-sms-reminder/);
    assert.match(source, /button-customer-whatsapp-reminder/);
  });

  it("updates only explicitly selected medicine fields in one native bulk operation", () => {
    const dialogSource = fs.readFileSync(
      path.join(__dirname, "../src/components/inventory/BulkMedicineUpdateDialog.tsx"),
      "utf8",
    );
    const serviceSource = fs.readFileSync(
      path.join(__dirname, "../src/services/inventoryService.ts"),
      "utf8",
    );
    const rustSource = fs.readFileSync(
      path.join(__dirname, "../src-tauri/src/lib.rs"),
      "utf8",
    );
    for (const field of ["company", "product_type", "strength", "rack_location", "min_stock_alert", "gst_rate_basis_points"]) {
      assert.match(dialogSource, new RegExp(`field: "${field}"`));
    }
    assert.match(dialogSource, /Only the listed fields will change/);
    assert.match(dialogSource, /transaction history will remain unchanged/);
    assert.match(serviceSource, /kind: "bulk_update_medicine_fields"/);
    assert.match(rustSource, /bulk_medicine_field_updates_are_atomic_and_leave_stock_untouched/);
  });

  it("retains the Home dashboard while switching sections and uses higher-contrast muted colors", () => {
    const appSource = fs.readFileSync(path.join(__dirname, "../src/App.tsx"), "utf8");
    const rootCss = fs.readFileSync(path.join(__dirname, "../src/index.css"), "utf8");
    const workspaceCss = fs.readFileSync(
      path.join(__dirname, "../src/components/workspace/workspace.css"),
      "utf8",
    );
    assert.match(appSource, /data-testid="retained-home-dashboard"/);
    assert.match(appSource, /isActive=\{activeSection === "home"\}/);
    assert.match(rootCss, /--muted: #56675f/);
    assert.match(workspaceCss, /\.workspace-muted\s*\{\s*color: #56675f/s);
  });
});

describe("local complete backup and restore service", () => {
  it("uses a local .zip save, supports .zip and legacy .db restore, and handles cancellation", async () => {
    assert.equal(await selectBackupDestination(), null);
    assert.deepEqual(backupServiceState.saveOptions.filters, [
      { name: "MY MEDICAL complete backup", extensions: ["zip"] },
    ]);
    assert.match(backupServiceState.saveOptions.defaultPath, /^my-medical-backup-.*\.zip$/);

    assert.equal(await selectRestoreSource(), null);
    assert.equal(backupServiceState.openOptions.directory, false);
    assert.equal(backupServiceState.openOptions.multiple, false);
    assert.deepEqual(backupServiceState.openOptions.filters, [
      { name: "MY MEDICAL backups", extensions: ["zip", "db"] },
    ]);
    backupServiceState.openSelection = "/local/complete-backup.zip";
    assert.equal(await selectRestoreSource(), "/local/complete-backup.zip");
    backupServiceState.openSelection = null;
    assert.deepEqual(backupServiceState.invocations, []);
  });

  it("normalizes a selected restore file and forwards native results", async () => {
    backupServiceState.saveSelection = "/local/manual-backup.zip";
    const destination = await selectBackupDestination();
    const backupResult = await createDatabaseBackup(destination);
    assert.deepEqual(backupResult, {
      path: "/local/manual-backup.zip",
      photoCount: 2,
      ignoredOrphanedPhotoCount: 1,
    });

    backupServiceState.openSelection = ["/local/restore-source.db"];
    const selectedSource = await selectRestoreSource();
    assert.equal(selectedSource, "/local/restore-source.db");
    const restoreResult = await restoreDatabaseBackup(selectedSource);
    assert.deepEqual(restoreResult, {
      safetyBackupPath: "/local/backups/before-restore.zip",
      sourceFormat: "legacyDatabaseOnly",
      restoredPhotoCount: 2,
      ignoredOrphanedPhotoCount: 0,
    });
    assert.deepEqual(backupServiceState.invocations, [
      {
        command: "create_database_backup",
        args: { destinationPath: "/local/manual-backup.zip" },
      },
      {
        command: "restore_database_backup",
        args: { sourcePath: "/local/restore-source.db" },
      },
    ]);
  });

  it("rejects empty paths instead of invoking native database commands", async () => {
    await assert.rejects(createDatabaseBackup("  "), /Choose a destination/);
    await assert.rejects(restoreDatabaseBackup("  "), /Choose a backup file/);
    assert.deepEqual(backupServiceState.invocations, []);
  });
});

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function offsetDate(date, days) {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return isoDate(result);
}

function mondayStartForReport(today) {
  const date = new Date(`${today}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return isoDate(date);
}

describe("renderer read contracts against an isolated SQLite fixture", () => {
  it("keeps zero-sales days in the weekly chart and formats them as ₹0", () => {
    const range = getWeekRange("2026-03-04");
    const points = buildWeek(range, [
      { sale_date: "2026-03-02", total_sales: 10, invoice_count: 1 },
    ]);

    assert.equal(points.length, 7);
    assert.equal(points[0].total, 10);
    assert.equal(points[1].total, 0);
    assert.equal(points[1].invoiceCount, 0);
    assert.equal(formatCompactMoney(points[1].total), "₹0");
  });

  it("keeps medicine list aggregates, matching, ordering, and literal search escaping", async () => {
    fixture.insertMedicine({
      id: 1,
      name: "Alpha",
      genericName: "Amoxicillin",
      company: "North Labs",
      productType: "Capsule",
      strength: "500 mg",
      composition: "Amoxicillin trihydrate",
      barcode: "0123456789012",
      uses: "Testing medicine metadata",
      adultDose: "One capsule",
      childDose: "Ask a clinician",
      photoRef: "medicine-1.jpg",
      rackLocation: "Rack-East",
      minStockAlert: 4,
      gstRateBasisPoints: 1800,
    });
    fixture.insertMedicine({ id: 2, name: "alpha", minStockAlert: 1 });
    fixture.insertMedicine({ id: 3, name: "Beta" });
    fixture.insertMedicine({ id: 4, name: "Med 100%_Ready!" });
    fixture.insertMedicine({ id: 5, name: "Med 100XXReady" });
    fixture.insertMedicine({ id: 6, name: "Zeta" });
    fixture.insertBatch({
      id: 1,
      medicineId: 1,
      batchNo: "expired",
      expiryOffset: -1,
      currentStock: 4,
      purchaseRate: 2,
    });
    fixture.insertBatch({
      id: 2,
      medicineId: 1,
      batchNo: "today",
      expiryOffset: 0,
      currentStock: 3,
      purchaseRate: 3,
    });
    fixture.insertBatch({
      id: 3,
      medicineId: 1,
      batchNo: "near-end",
      expiryOffset: 30,
      currentStock: 5,
      purchaseRate: 4,
    });
    fixture.insertBatch({
      id: 4,
      medicineId: 1,
      batchNo: "beyond-horizon",
      expiryOffset: 31,
      currentStock: 2,
      purchaseRate: 5,
    });

    const inventory = await getInventoryMedicines("");
    assert.deepEqual(
      inventory.map((row) => row.name),
      ["Alpha", "alpha", "Beta", "Med 100%_Ready!", "Med 100XXReady", "Zeta"],
    );
    assert.deepEqual(
      {
        available_stock: inventory[0].available_stock,
        expired_stock: inventory[0].expired_stock,
        near_expiry_stock: inventory[0].near_expiry_stock,
        batch_count: inventory[0].batch_count,
      },
      { available_stock: 10, expired_stock: 4, near_expiry_stock: 8, batch_count: 4 },
    );
    assert.deepEqual(
      (await getInventoryMedicines("rack-east")).map((row) => row.id),
      [1],
    );
    assert.deepEqual(
      (await getInventoryMedicines("100%_Ready!")).map((row) => row.id),
      [4],
    );
    assert.deepEqual(await getInventoryMedicines("not present"), []);

    const beforeBlankSearch = state.queryCount;
    assert.deepEqual(await searchMedicines("   "), []);
    assert.equal(state.queryCount, beforeBlankSearch);

    const results = await searchMedicines("Alpha");
    assert.deepEqual(
      results.map((row) => [row.medicine.id, row.available_stock, row.fefo_batch?.id ?? null]),
      [[1, 10, 2], [2, 0, null]],
    );
    assert.deepEqual(Object.keys(results[0]), [
      "medicine",
      "available_stock",
      "exact_barcode_match",
      "fefo_batch",
    ]);
    assert.deepEqual(Object.keys(results[0].medicine), [
      "id",
      "name",
      "generic_name",
      "company",
      "product_type",
      "strength",
      "composition",
      "barcode",
      "uses",
      "adult_dose",
      "child_dose",
      "photo_ref",
      "rack_location",
      "min_stock_alert",
      "gst_rate_basis_points",
      "created_at",
    ]);
    assert.equal(results[0].medicine.product_type, "Capsule");
    assert.equal(results[0].medicine.barcode, "0123456789012");
    assert.equal(results[0].medicine.gst_rate_basis_points, 1800);
    const masterBarcodeMatch = await searchMedicines("0123456789012");
    assert.deepEqual(
      masterBarcodeMatch.map((row) => [row.medicine.id, row.fefo_batch?.id ?? null]),
      [[1, 2]],
    );
    assert.deepEqual(await searchMedicines("no such medicine"), []);
    assert.deepEqual(
      (await searchMedicines("Alpha", 1)).map((row) => row.medicine.id),
      [1],
    );
    await assert.rejects(searchMedicines("Alpha", 0), /Search limit must be between 1 and 100/);
  });

  it("resolves exact barcodes to medicines while keeping search batches FEFO", async () => {
    fixture.insertMedicine({ id: 1, name: "Zeta" });
    fixture.insertMedicine({ id: 2, name: "Alpha" });
    fixture.insertBatch({
      id: 1,
      medicineId: 1,
      batchNo: "earlier",
      expiryOffset: 2,
      currentStock: 4,
      barcode: "OTHER",
    });
    fixture.insertBatch({
      id: 2,
      medicineId: 1,
      batchNo: "scanned",
      expiryOffset: 5,
      currentStock: 2,
      barcode: "SCAN-123",
    });
    fixture.insertBatch({
      id: 3,
      medicineId: 2,
      batchNo: "partial",
      expiryOffset: 1,
      currentStock: 3,
      barcode: "prefix-SCAN-123-suffix",
    });

    const matches = await searchMedicines("SCAN-123");
    assert.deepEqual(
      matches.map((row) => [row.medicine.name, row.fefo_batch?.id]),
      [["Zeta", 1], ["Alpha", 3]],
    );
    assert.equal(matches[0].exact_barcode_match, true);
    assert.equal(matches[1].exact_barcode_match, false);
    assert.deepEqual(
      (await getSellableBatches(matches[0].medicine.id)).map((batch) => batch.id),
      [1, 2],
    );
    assert.equal(
      resolveBarcodeLookup(matches, " scan-123 ").kind,
      "match",
    );
    assert.deepEqual(await searchMedicines("ABSENT-CODE"), []);
  });

  it("searches saved product identifiers and surfaces exact duplicate barcodes for explicit choice", async () => {
    fixture.insertMedicine({
      id: 1,
      name: "Cough relief",
      company: "Northstar",
      productType: "Syrup",
      strength: "100 mg / 5 ml",
      composition: "dextromethorphan",
      barcode: "DUP-100",
    });
    fixture.insertMedicine({
      id: 2,
      name: "Cold tablets",
      company: "Harbor Labs",
      productType: "Tablet",
      strength: "10 mg",
      composition: "cetirizine",
    });
    fixture.insertBatch({ id: 1, medicineId: 1, currentStock: 3 });
    fixture.insertBatch({
      id: 2,
      medicineId: 2,
      currentStock: 4,
      barcode: "DUP-100",
    });

    assert.equal((await searchMedicines("Northstar"))[0].medicine.id, 1);
    assert.equal((await searchMedicines("Syrup"))[0].medicine.id, 1);
    assert.equal((await searchMedicines("100 mg / 5 ml"))[0].medicine.id, 1);
    assert.equal((await searchMedicines("dextromethorphan"))[0].medicine.id, 1);

    const exactMatches = await searchMedicines("dup-100");
    const resolution = resolveBarcodeLookup(exactMatches, " dup-100 ");
    assert.equal(normalizeBarcode(" dup-100 "), "DUP-100");
    assert.equal(resolution.kind, "ambiguous");
    if (resolution.kind === "ambiguous") {
      assert.deepEqual(
        resolution.matches.map((match) => match.medicine.id).sort(),
        [1, 2],
      );
    }
  });

  it("validates invoice-only sale-price drafts to cents precision", () => {
    assert.equal(parseSalePriceDraft(" 14.2 "), 14.2);
    assert.equal(parseSalePriceDraft("0"), 0);
    assert.equal(parseSalePriceDraft("14.239"), null);
    assert.equal(parseSalePriceDraft(""), null);
    assert.equal(parseSalePriceDraft("₹14"), null);
  });

  it("orders batches and allocates sellable stock by FEFO, including empty and insufficient cases", async () => {
    fixture.insertMedicine({ id: 1, name: "FEFO medicine" });
    fixture.insertMedicine({ id: 2, name: "No batches" });
    fixture.insertBatch({
      id: 1,
      medicineId: 1,
      batchNo: "expired",
      expiryOffset: -1,
      currentStock: 8,
    });
    fixture.insertBatch({
      id: 2,
      medicineId: 1,
      batchNo: "a-first",
      expiryOffset: 2,
      currentStock: 1,
    });
    fixture.insertBatch({
      id: 5,
      medicineId: 1,
      batchNo: "B-next",
      expiryOffset: 2,
      currentStock: 2,
    });
    fixture.insertBatch({
      id: 3,
      medicineId: 1,
      batchNo: "later",
      expiryOffset: 4,
      currentStock: 4,
    });
    fixture.insertBatch({
      id: 4,
      medicineId: 1,
      batchNo: "zero",
      expiryOffset: 5,
      currentStock: 0,
    });

    assert.deepEqual(
      (await getMedicineBatches(1)).map((batch) => batch.id),
      [1, 2, 5, 3, 4],
    );
    assert.equal((await getFefoBatch(1)).id, 2);
    assert.deepEqual(
      (await getSellableBatches(1)).map((batch) => batch.id),
      [2, 5, 3],
    );
    const allocation = await allocateFefoStock(1, 4);
    assert.deepEqual(
      allocation.map(({ batch, quantity }) => [batch.id, quantity]),
      [[2, 1], [5, 2], [3, 1]],
    );
    await assert.rejects(
      allocateFefoStock(1, 10),
      /Insufficient unexpired stock\. 7 unit\(s\) are available\./,
    );
    assert.equal(await getFefoBatch(2), null);
    assert.deepEqual(await getSellableBatches(2), []);
    assert.deepEqual(await getSellableBatches(99), []);
  });

  it("counts all unexpired stock for low-stock alerts and caps expiry alerts at the selected horizon", async () => {
    fixture.insertMedicine({ id: 1, name: "Low medicine", minStockAlert: 14 });
    fixture.insertMedicine({ id: 2, name: "Zero medicine", minStockAlert: 0 });
    fixture.insertMedicine({ id: 3, name: "Healthy medicine", minStockAlert: 1 });
    fixture.insertBatch({
      id: 1,
      medicineId: 1,
      batchNo: "expired",
      expiryOffset: -1,
      currentStock: 7,
    });
    fixture.insertBatch({
      id: 2,
      medicineId: 1,
      batchNo: "today",
      expiryOffset: 0,
      currentStock: 2,
    });
    fixture.insertBatch({
      id: 3,
      medicineId: 1,
      batchNo: "horizon",
      expiryOffset: 30,
      currentStock: 3,
    });
    fixture.insertBatch({
      id: 4,
      medicineId: 1,
      batchNo: "outside",
      expiryOffset: 31,
      currentStock: 9,
    });
    fixture.insertBatch({
      id: 5,
      medicineId: 1,
      batchNo: "empty",
      expiryOffset: 10,
      currentStock: 0,
    });
    fixture.insertBatch({
      id: 6,
      medicineId: 3,
      batchNo: "healthy-today",
      expiryOffset: 0,
      currentStock: 2,
    });

    assert.deepEqual(
      (await getLowStockAlerts()).map((alert) => [alert.name, alert.available_stock]),
      [["Zero medicine", 0], ["Low medicine", 14]],
    );
    const alerts = await getExpiryAlerts(30);
    assert.deepEqual(
      alerts.map((alert) => [
        alert.batch.id,
        alert.medicine_name,
        alert.days_until_expiry,
        alert.status,
      ]),
      [
        [1, "Low medicine", -1, "expired"],
        [6, "Healthy medicine", 0, "expiring"],
        [2, "Low medicine", 0, "expiring"],
        [3, "Low medicine", 30, "expiring"],
      ],
    );
    assert.deepEqual(
      (await getExpiryAlerts(7)).map((alert) => alert.batch.id),
      [1, 6, 2],
    );
  });

  it("searches suppliers safely and applies defaults to absent and partial settings", async () => {
    fixture.insertSupplier({ id: 1, name: "Acme 100% Pharmacy", phone: null });
    fixture.insertSupplier({ id: 2, name: "Acme Pharmacy", address: null });
    fixture.insertSupplier({ id: 3, name: "Zeta Medical" });

    assert.deepEqual(
      (await getSuppliers("Acme")).map((supplier) => supplier.name),
      ["Acme 100% Pharmacy", "Acme Pharmacy"],
    );
    assert.deepEqual(
      (await getSuppliers("%")).map((supplier) => supplier.name),
      ["Acme 100% Pharmacy"],
    );
    assert.equal((await getSuppliers("not found")).length, 0);
    assert.equal((await getSuppliers("Acme"))[0].phone, null);
    assert.equal((await getSuppliers("Acme"))[1].address, null);

    const defaults = await getStoreSettings();
    assert.deepEqual(defaults, {
      pharmacy_name: "",
      address: "",
      contact_number: "",
      drug_license_number: "",
      receipt_footer_note:
        "Thank you for choosing us. Please retain this receipt for your records.",
      upi_id: "",
      upi_display_name: "",
      gst_enabled: false,
      gst_default_rate_basis_points: null,
      gst_pricing_mode: "EXCLUSIVE",
      gst_pharmacy_state_code: "",
    });
    fixture.insertSetting("pharmacy_name", "Fixture Pharmacy");
    fixture.insertSetting("unrecognized_key", "ignored");
    assert.deepEqual(await getStoreSettings(), {
      ...defaults,
      pharmacy_name: "Fixture Pharmacy",
    });
    assert.throws(
      () => fixture.insertSetting("address", null),
      /NOT NULL constraint failed: app_settings.setting_value/,
    );
  });

  it("orders recent purchases and sales, preserves nulls, counts lines, and looks up invoices", async () => {
    fixture.insertSupplier({ id: 1, name: "Supplier One" });
    fixture.insertMedicine({
      id: 1,
      name: "Medicine One",
      genericName: null,
    });
    fixture.insertBatch({
      id: 1,
      medicineId: 1,
      batchNo: "B-1",
      currentStock: 10,
      expiryOffset: 100,
    });
    const today = fixture.dateAt();
    const yesterday = fixture.dateAt(-1);

    fixture.insertPurchase({
      id: 1,
      supplierId: 1,
      totalAmount: 8,
      purchaseDate: yesterday,
    });
    fixture.insertPurchase({
      id: 2,
      supplierId: 1,
      totalAmount: 10,
      purchaseDate: today,
    });
    fixture.insertPurchase({
      id: 3,
      supplierId: null,
      totalAmount: 12,
      purchaseDate: today,
    });
    fixture.insertPurchaseItem({ id: 1, purchaseId: 1, batchId: 1, quantity: 2 });
    fixture.insertPurchaseItem({ id: 2, purchaseId: 2, batchId: 1, quantity: 3 });
    fixture.insertPurchaseItem({ id: 3, purchaseId: 2, batchId: 1, quantity: 4 });

    const purchases = await getRecentPurchases(2);
    assert.deepEqual(
      purchases.map((purchase) => [
        purchase.id,
        purchase.supplier_name,
        purchase.item_count,
        purchase.total_units,
      ]),
      [[3, null, 0, 0], [2, "Supplier One", 2, 7]],
    );
    await assert.rejects(getRecentPurchases(0), /limit must be between 1 and 50/);

    fixture.insertSale({
      id: 1,
      invoiceNo: "INV-1",
      createdAt: fixture.timestampAt(yesterday, "12:00:00"),
      subtotal: 20,
      grandTotal: 20,
    });
    fixture.insertSale({
      id: 2,
      invoiceNo: "INV-2",
      customerName: null,
      createdAt: fixture.timestampAt(today, "15:00:00"),
      subtotal: 30,
      grandTotal: 30,
    });
    fixture.insertSale({
      id: 3,
      invoiceNo: "INV-3",
      createdAt: fixture.timestampAt(today, "15:00:00"),
      subtotal: 40,
      grandTotal: 40,
    });
    fixture.insertSaleItem({
      id: 9,
      saleId: 2,
      batchId: 1,
      quantity: 1,
      unitPrice: 10,
      purchaseRateAtSale: 2,
    });
    fixture.insertSaleItem({
      id: 8,
      saleId: 2,
      batchId: 1,
      quantity: 2,
      unitPrice: 10,
      purchaseRateAtSale: 2,
    });

    const sales = await getRecentSales(2);
    assert.deepEqual(
      sales.map(({ sale, item_count }) => [sale.id, sale.invoice_no, item_count]),
      [[3, "INV-3", 0], [2, "INV-2", 2]],
    );
    await assert.rejects(getRecentSales(101), /limit must be between 1 and 100/);

    const details = await getSaleDetails(" INV-2 ");
    assert.equal(details.sale.customer_name, null);
    assert.deepEqual(
      details.items.map((item) => [item.id, item.medicine_name, item.generic_name, item.batch_no]),
      [[8, "Medicine One", null, "B-1"], [9, "Medicine One", null, "B-1"]],
    );
    assert.equal(await getSaleDetails("missing invoice"), null);
    await assert.rejects(getSaleDetails("  "), /Enter an invoice number/);
  });

  it("uses SQLite local dates for today's dashboard, inventory totals, purchases, and top sellers", async () => {
    fixture.insertMedicine({ id: 1, name: "Top Seller", minStockAlert: 1 });
    fixture.insertMedicine({ id: 2, name: "Low Stock", minStockAlert: 5 });
    fixture.insertMedicine({ id: 3, name: "Empty", minStockAlert: 0 });
    fixture.insertBatch({
      id: 1,
      medicineId: 1,
      batchNo: "current",
      expiryOffset: 5,
      purchaseRate: 4,
      currentStock: 5,
    });
    fixture.insertBatch({
      id: 2,
      medicineId: 1,
      batchNo: "expired",
      expiryOffset: -5,
      purchaseRate: 100,
      currentStock: 20,
    });
    fixture.insertBatch({
      id: 3,
      medicineId: 2,
      batchNo: "low",
      expiryOffset: 10,
      purchaseRate: 3,
      currentStock: 2,
    });
    fixture.insertSupplier({ id: 1, name: "Supplier" });
    fixture.insertSetting("pharmacy_name", "Fixture Pharmacy");
    const today = fixture.dateAt();
    const yesterday = fixture.dateAt(-1);
    const thirtyOneDaysAgo = fixture.dateAt(-31);
    fixture.insertPurchase({
      id: 1,
      supplierId: 1,
      totalAmount: 30,
      purchaseDate: today,
    });
    fixture.insertPurchase({
      id: 2,
      supplierId: 1,
      totalAmount: 900,
      purchaseDate: yesterday,
    });

    fixture.insertSale({
      id: 1,
      invoiceNo: "TODAY",
      subtotal: 110,
      flatDiscount: 10,
      grandTotal: 100,
      paymentMode: "CASH",
      cashTendered: 100,
      createdAt: fixture.timestampAt(today, "13:00:00"),
    });
    fixture.insertSaleItem({
      id: 1,
      saleId: 1,
      batchId: 1,
      quantity: 2,
      unitPrice: 55,
      totalPrice: 110,
      purchaseRateAtSale: 3,
    });
    fixture.insertSale({
      id: 2,
      invoiceNo: "YESTERDAY",
      subtotal: 40,
      grandTotal: 40,
      createdAt: fixture.timestampAt(yesterday, "10:00:00"),
    });
    fixture.insertSaleItem({
      id: 2,
      saleId: 2,
      batchId: 1,
      quantity: 4,
      unitPrice: 10,
      totalPrice: 40,
      purchaseRateAtSale: 20,
    });
    fixture.insertSale({
      id: 3,
      invoiceNo: "OUTSIDE-30-DAYS",
      subtotal: 100,
      grandTotal: 100,
      createdAt: fixture.timestampAt(thirtyOneDaysAgo, "10:00:00"),
    });
    fixture.insertSaleItem({
      id: 3,
      saleId: 3,
      batchId: 1,
      quantity: 10,
      unitPrice: 10,
      totalPrice: 100,
      purchaseRateAtSale: 1,
    });

    const dashboard = await getDashboardSnapshot();
    assert.equal(dashboard.date, today);
    assert.deepEqual(dashboard.inventory, {
      total_medicines: 3,
      stock_value_at_cost: 26,
      in_stock_medicines: 1,
      low_stock_medicines: 1,
      out_of_stock_medicines: 1,
      total_suppliers: 1,
    });
    assert.deepEqual(dashboard.purchases_today, { total_amount: 30, invoice_count: 1 });
    assert.deepEqual(
      {
        revenue: dashboard.sales_today.total_revenue,
        gross_profit: dashboard.sales_today.gross_profit,
        invoice_count: dashboard.sales_today.total_invoices,
        cash_revenue: dashboard.sales_today.cash_revenue,
      },
      { revenue: 100, gross_profit: 94, invoice_count: 1, cash_revenue: 100 },
    );
    assert.deepEqual(
      dashboard.top_selling_medicines.map((medicine) => [
        medicine.name,
        medicine.quantity_sold,
        medicine.line_sales_before_invoice_discount,
      ]),
      [["Top Seller", 6, 150]],
    );
    assert.deepEqual(
      dashboard.low_stock_alerts.map((alert) => [alert.name, alert.available_stock]),
      [["Empty", 0], ["Low Stock", 2]],
    );
    assert.equal(dashboard.store_settings.pharmacy_name, "Fixture Pharmacy");
    assert.deepEqual(
      dashboard.recent_sales.map(({ sale }) => sale.invoice_no),
      ["TODAY", "YESTERDAY", "OUTSIDE-30-DAYS"],
    );
  });

  it("reports inclusive date ranges, payment buckets, and sale-time gross profit snapshots", async () => {
    fixture.insertMedicine({ id: 1, name: "Report medicine" });
    fixture.insertBatch({
      id: 1,
      medicineId: 1,
      purchaseRate: 999,
      currentStock: 1,
      expiryOffset: 100,
    });
    const today = fixture.dateAt();
    const start = fixture.dateAt(-2);
    const yesterday = fixture.dateAt(-1);
    const tomorrow = fixture.dateAt(1);

    fixture.insertSale({
      id: 1,
      invoiceNo: "CASH",
      subtotal: 120,
      flatDiscount: 10,
      grandTotal: 110,
      paymentMode: "CASH",
      createdAt: fixture.timestampAt(yesterday),
    });
    fixture.insertSaleItem({
      id: 1,
      saleId: 1,
      batchId: 1,
      quantity: 2,
      unitPrice: 60,
      totalPrice: 120,
      purchaseRateAtSale: 20,
    });
    fixture.insertSale({
      id: 2,
      invoiceNo: "UPI",
      subtotal: 50,
      grandTotal: 50,
      paymentMode: "UPI",
      createdAt: fixture.timestampAt(today),
    });
    fixture.insertSaleItem({
      id: 2,
      saleId: 2,
      batchId: 1,
      quantity: 4,
      unitPrice: 12.5,
      totalPrice: 50,
      purchaseRateAtSale: 5,
    });
    fixture.insertSale({
      id: 3,
      invoiceNo: "CARD",
      subtotal: 15,
      grandTotal: 15,
      paymentMode: "CARD",
      createdAt: fixture.timestampAt(today),
    });
    fixture.insertSaleItem({
      id: 3,
      saleId: 3,
      batchId: 1,
      quantity: 1,
      unitPrice: 15,
      totalPrice: 15,
      purchaseRateAtSale: 10,
    });
    fixture.insertSale({
      id: 4,
      invoiceNo: "CREDIT",
      subtotal: 25,
      grandTotal: 25,
      paymentMode: "CREDIT",
      createdAt: fixture.timestampAt(today),
    });
    fixture.insertSale({
      id: 5,
      invoiceNo: "OTHER",
      subtotal: 10,
      grandTotal: 10,
      paymentMode: "OTHER",
      createdAt: fixture.timestampAt(today),
    });
    fixture.insertSaleItem({
      id: 4,
      saleId: 5,
      batchId: 1,
      quantity: 1,
      unitPrice: 10,
      totalPrice: 10,
      purchaseRateAtSale: null,
    });
    fixture.insertSale({
      id: 6,
      invoiceNo: "OUTSIDE-RANGE",
      subtotal: 999,
      grandTotal: 999,
      paymentMode: "CASH",
      createdAt: fixture.timestampAt(tomorrow),
    });

    const report = await getSalesReport(start, today);
    assert.deepEqual(report.summary, {
      total_revenue: 210,
      gross_sales: 210,
      returned_total: 0,
      voided_total: 0,
      net_revenue: 210,
      gross_profit: 105,
      net_gross_profit: 105,
      total_invoices: 5,
      cash_revenue: 110,
      net_cash_revenue: 110,
      cash_invoices: 1,
      card_upi_revenue: 65,
      net_card_upi_revenue: 65,
      card_upi_invoices: 2,
      other_revenue: 35,
      net_other_revenue: 35,
      other_invoices: 2,
      profit_unavailable_invoices: 1,
      net_profit_unavailable_invoices: 1,
    });
    assert.deepEqual(
      report.sales.map((sale) => [sale.invoice_no, sale.grand_total]),
      [["OTHER", 10], ["CREDIT", 25], ["CARD", 15], ["UPI", 50], ["CASH", 110]],
    );
    assert.deepEqual(await getSalesReportSummary(start, today), report.summary);
    await assert.rejects(
      getSalesReport("2026-02-30", today),
      /Choose a valid report date range/,
    );
  });

  it("includes and excludes the Monday-week and calendar-month report boundaries", async () => {
    const today = fixture.dateAt();
    const weekStart = mondayStartForReport(today);
    const monthStart = `${today.slice(0, 7)}-01`;
    const records = [
      { id: 1, invoiceNo: "WEEK-START", date: weekStart, amount: 10 },
      { id: 2, invoiceNo: "BEFORE-WEEK", date: offsetDate(weekStart, -1), amount: 1 },
      { id: 3, invoiceNo: "TODAY", date: today, amount: 20 },
      { id: 4, invoiceNo: "AFTER-TODAY", date: offsetDate(today, 1), amount: 100 },
      { id: 5, invoiceNo: "MONTH-START", date: monthStart, amount: 30 },
      { id: 6, invoiceNo: "BEFORE-MONTH", date: offsetDate(monthStart, -1), amount: 3 },
    ];
    for (const record of records) {
      fixture.insertSale({
        id: record.id,
        invoiceNo: record.invoiceNo,
        subtotal: record.amount,
        grandTotal: record.amount,
        createdAt: fixture.timestampAt(record.date),
      });
    }

    const expectedFor = (startDate, endDate) => {
      const included = records
        .filter((record) => record.date >= startDate && record.date <= endDate)
        .sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id);
      return {
        revenue: included.reduce((total, record) => total + record.amount, 0),
        invoices: included.map((record) => record.invoiceNo),
      };
    };

    const week = await getSalesReport(weekStart, today);
    const expectedWeek = expectedFor(weekStart, today);
    assert.equal(week.summary.total_revenue, expectedWeek.revenue);
    assert.deepEqual(
      week.sales.map((sale) => sale.invoice_no),
      expectedWeek.invoices,
    );

    const month = await getSalesReport(monthStart, today);
    const expectedMonth = expectedFor(monthStart, today);
    assert.equal(month.summary.total_revenue, expectedMonth.revenue);
    assert.deepEqual(
      month.sales.map((sale) => sale.invoice_no),
      expectedMonth.invoices,
    );
  });

  it("returns zero summaries and empty arrays without exposing arbitrary SQL reads", async () => {
    const today = fixture.dateAt();
    assert.deepEqual(await getInventoryMedicines(""), []);
    assert.deepEqual(await getSuppliers(""), []);
    assert.deepEqual(await getRecentPurchases(), []);
    assert.deepEqual(await getRecentSales(), []);
    assert.deepEqual(await getSalesReport(today, today), {
      summary: {
        total_revenue: 0,
        gross_sales: 0,
        returned_total: 0,
        voided_total: 0,
        net_revenue: 0,
        gross_profit: 0,
        net_gross_profit: 0,
        total_invoices: 0,
        cash_revenue: 0,
        net_cash_revenue: 0,
        cash_invoices: 0,
        card_upi_revenue: 0,
        net_card_upi_revenue: 0,
        card_upi_invoices: 0,
        other_revenue: 0,
        net_other_revenue: 0,
        other_invoices: 0,
        profit_unavailable_invoices: 0,
        net_profit_unavailable_invoices: 0,
      },
      sales: [],
    });

    const dashboard = await getDashboardSnapshot();
    assert.equal(dashboard.date, today);
    assert.deepEqual(dashboard.inventory, {
      total_medicines: 0,
      stock_value_at_cost: 0,
      in_stock_medicines: 0,
      low_stock_medicines: 0,
      out_of_stock_medicines: 0,
      total_suppliers: 0,
    });
    assert.deepEqual(dashboard.purchases_today, { total_amount: 0, invoice_count: 0 });
    assert.deepEqual(dashboard.top_selling_medicines, []);
    assert.deepEqual(dashboard.low_stock_alerts, []);
    assert.deepEqual(dashboard.expiry_alerts, []);

    const serviceDirectory = require("node:path").join(__dirname, "../src/services");
    for (const file of fs.readdirSync(serviceDirectory).filter((name) => name.endsWith(".ts"))) {
      const source = fs.readFileSync(require("node:path").join(serviceDirectory, file), "utf8");
      assert.doesNotMatch(source, /\bselectSql\b|Database\.select/);
    }
    assert.ok(state.invocations.length > 0);
    for (const { command, args } of state.invocations) {
      assert.match(command, /^[a-z][a-z0-9_]+$/);
      assert.equal(
        Object.keys(args).some((key) => /^(query|sql|statement|statements)$/i.test(key)),
        false,
      );
    }
    assert.throws(
      () => invokeRead("execute_sql_transaction", { query: "UPDATE medicines" }),
      /Unsupported typed native read command/,
    );
  });
});

describe("inventory order quantity suggestions", () => {
  it("uses the reorder floor when sales history is insufficient and excludes expired stock", () => {
    assert.deepEqual(
      calculateOrderSuggestion({
        sellableStock: 0,
        reorderLevel: 5,
        soldUnits30Days: 0,
        salesDays30Days: 0,
        pendingOrderQuantity: 0,
      }),
      {
        targetStock: 10,
        suggestedAdditionalQuantity: 10,
        limitedSalesHistory: true,
        suggestionCapped: false,
      },
    );
  });

  it("subtracts pending orders from a target based on recent usage", () => {
    assert.deepEqual(
      calculateOrderSuggestion({
        sellableStock: 2,
        reorderLevel: 5,
        soldUnits30Days: 15,
        salesDays30Days: 9,
        pendingOrderQuantity: 4,
      }),
      {
        targetStock: 15,
        suggestedAdditionalQuantity: 9,
        limitedSalesHistory: false,
        suggestionCapped: false,
      },
    );
  });

  it("suggests nothing when sellable stock already meets the target", () => {
    assert.deepEqual(
      calculateOrderSuggestion({
        sellableStock: 20,
        reorderLevel: 5,
        soldUnits30Days: 8,
        salesDays30Days: 10,
        pendingOrderQuantity: 0,
      }),
      {
        targetStock: 10,
        suggestedAdditionalQuantity: 0,
        limitedSalesHistory: false,
        suggestionCapped: false,
      },
    );
  });

  it("caps suggestions at the order-list limit and rejects invalid stock values", () => {
    assert.deepEqual(
      calculateOrderSuggestion({
        sellableStock: 0,
        reorderLevel: 1_000_000_000,
        soldUnits30Days: 0,
        salesDays30Days: 0,
        pendingOrderQuantity: 0,
      }),
      {
        targetStock: 2_000_000_000,
        suggestedAdditionalQuantity: 1_000_000_000,
        limitedSalesHistory: true,
        suggestionCapped: true,
      },
    );
    assert.throws(
      () =>
        calculateOrderSuggestion({
          sellableStock: -1,
          reorderLevel: 1,
          soldUnits30Days: 0,
          salesDays30Days: 0,
          pendingOrderQuantity: 0,
        }),
      /Sellable stock must be a non-negative whole number/,
    );
  });
});

describe("barcode label preparation", () => {
  it("uses saved batch barcodes first and the saved medicine barcode as fallback", () => {
    const medicine = {
      id: 1,
      name: "Test medicine",
      barcode: "MASTER-123",
      strength: "250 mg",
      product_type: "Capsule",
    };
    const sources = buildBarcodeLabelSources(
      [medicine, { ...medicine, id: 2, name: "No barcode", barcode: null }],
      [[
        {
          id: 10,
          medicine_id: 1,
          batch_no: "BATCH-A",
          barcode: "BATCH-10",
          expiry_date: "2027-01-01",
          purchase_rate: 2,
          mrp: 3,
          sale_rate: 2.5,
          current_stock: 4,
        },
        {
          id: 11,
          medicine_id: 1,
          batch_no: "BATCH-B",
          barcode: null,
          expiry_date: "2027-06-01",
          purchase_rate: 2,
          mrp: 3,
          sale_rate: 2.5,
          current_stock: 4,
        },
      ], []],
    );

    assert.deepEqual(
      sources.map((source) => [source.key, source.barcode, source.batch?.batch_no ?? null]),
      [
        ["batch-1-10", "BATCH-10", "BATCH-A"],
        ["batch-1-11", "MASTER-123", "BATCH-B"],
        ["medicine-2", null, null],
      ],
    );
  });

  it("validates a bounded whole-number label quantity", () => {
    assert.equal(maximumBarcodeLabelQuantity, 500);
    assert.equal(parseBarcodeLabelQuantity("1"), 1);
    assert.equal(parseBarcodeLabelQuantity("500"), 500);
    assert.equal(parseBarcodeLabelQuantity(""), null);
    assert.equal(parseBarcodeLabelQuantity("0"), null);
    assert.equal(parseBarcodeLabelQuantity("1.5"), null);
    assert.equal(parseBarcodeLabelQuantity("501"), null);
  });
});

describe("stock export workbook", () => {
  const makeMedicine = (id, name = `Medicine ${id}`) => ({
    id,
    name,
    generic_name: null,
    company: "Example Company",
    product_type: "Tablet",
    strength: "250 mg",
    composition: null,
    barcode: `MED-${id}`,
    uses: null,
    adult_dose: null,
    child_dose: null,
    photo_ref: null,
    rack_location: "A-01",
    min_stock_alert: 5,
    gst_rate_basis_points: 500,
    created_at: "2026-01-01",
    available_stock: 12,
    expired_stock: 0,
    near_expiry_stock: 0,
    batch_count: 1,
  });

  const makeBatch = (id, medicineId, expiryDate) => ({
    id,
    medicine_id: medicineId,
    batch_no: `BATCH-${id}`,
    expiry_date: expiryDate,
    purchase_rate: 10.5,
    mrp: 15,
    sale_rate: 13,
    current_stock: 12,
    barcode: `LOT-${id}`,
  });

  it("filters expired and near-expiry batches at inclusive date boundaries", () => {
    const rows = [
      { medicine: makeMedicine(1), batch: makeBatch(1, 1, "2026-10-02") },
      { medicine: makeMedicine(2), batch: makeBatch(2, 2, "2026-10-03") },
      { medicine: makeMedicine(3), batch: makeBatch(3, 3, "2026-11-02") },
      { medicine: makeMedicine(4), batch: makeBatch(4, 4, "2026-11-03") },
      { medicine: makeMedicine(5), batch: null },
    ];
    const today = new Date(2026, 9, 3);

    assert.deepEqual(
      filterStockExportRows(rows, "expired", today).map(({ batch }) => batch.batch_no),
      ["BATCH-1"],
    );
    assert.deepEqual(
      filterStockExportRows(rows, "near-expiry", today).map(({ batch }) => batch.batch_no),
      ["BATCH-2", "BATCH-3"],
    );
    assert.equal(filterStockExportRows(rows, "all", today).length, rows.length);
  });

  it("preserves data and exports numeric cells and long medicine names", async () => {
    const longName = "Very long medicine name ".repeat(5);
    const rows = [
      {
        medicine: makeMedicine(1, longName),
        batch: makeBatch(1, 1, "2027-03-01"),
      },
    ];
    const before = structuredClone(rows);
    const buffer = await buildStockWorkbookBuffer(rows);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Stock");

    assert.deepEqual(rows, before);
    assert.equal(sheet.getCell("A2").value, longName);
    assert.equal(sheet.getCell("D2").value, "LOT-1");
    assert.equal(sheet.getCell("G2").value, 12);
    assert.equal(typeof sheet.getCell("G2").value, "number");
    assert.equal(sheet.getCell("I2").value, 15);
    assert.equal(sheet.getCell("M2").value, "Healthy");
  });

  it("creates a valid header-only workbook for empty exports and handles many rows", async () => {
    const emptyWorkbook = new ExcelJS.Workbook();
    await emptyWorkbook.xlsx.load(await buildStockWorkbookBuffer([]));
    const emptySheet = emptyWorkbook.getWorksheet("Stock");
    assert.equal(emptySheet.rowCount, 1);
    assert.equal(emptySheet.getCell("A1").value, "Medicine");
    assert.equal(emptySheet.getCell("M1").value, "Stock Status");

    const rows = Array.from({ length: 300 }, (_, index) => ({
      medicine: makeMedicine(index + 1),
      batch: makeBatch(index + 1, index + 1, "2027-03-01"),
    }));
    const manyWorkbook = new ExcelJS.Workbook();
    await manyWorkbook.xlsx.load(await buildStockWorkbookBuffer(rows));
    assert.equal(manyWorkbook.getWorksheet("Stock").rowCount, 301);
  });
});

describe("expense and financial report surfaces", () => {
  it("connects the Expenses workspace to native CRUD and exposes print/PDF controls", () => {
    const expensesPage = fs.readFileSync(
      path.join(__dirname, "../src/components/expenses/ExpensesPage.tsx"),
      "utf8",
    );
    const reportsPage = fs.readFileSync(
      path.join(__dirname, "../src/components/reports/ReportsPage.tsx"),
      "utf8",
    );

    for (const serviceCall of [
      "getExpenseCategories",
      "getExpenses",
      "saveExpense",
      "saveExpenseCategory",
      "setExpenseCategoryActive",
      "cancelExpense",
    ]) {
      assert.match(expensesPage, new RegExp(`\\b${serviceCall}\\b`));
    }
    assert.match(expensesPage, /window\.confirm/);
    assert.match(expensesPage, /status === "CANCELLED"/);
    assert.match(expensesPage, /data-testid="page-expenses"/);
    assert.match(reportsPage, /data-testid="button-print-report"/);
    assert.match(reportsPage, /window\.print\(\)/);
    assert.match(reportsPage, /\{ id: "expenses"/);
    assert.match(reportsPage, /\{ id: "financial_summary", title: "Financial Summary", group: "Overview" \}/);
    assert.match(reportsPage, /\["Trading", "Overview", "Inventory", "Analysis", "Balances", "Tax"\]/);
  });

  it("exports expense breakdowns and cancelled ledger rows as an Excel workbook", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    let downloadedBlob = null;
    let downloadedFilename = null;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob) => {
        downloadedBlob = blob;
        return "blob:expense-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: { setTimeout: (callback) => { callback(); return 0; } },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: {
        createElement: () => ({
          click: () => {},
          set download(filename) { downloadedFilename = filename; },
          set href(_href) {},
        }),
      },
    });

    try {
      const range = { startDate: "2025-03-10", endDate: "2025-03-12" };
      const settings = {
        pharmacy_name: "MY MEDICAL",
        address: "",
        contact_number: "",
        drug_license_number: "",
      };
      const report = {
        reportType: "expenses",
        data: {
          range,
          totalExpenses: 75,
          activeCount: 2,
          cancelledCount: 1,
          categoryTotals: [{ categoryName: "Rent", amount: 50, count: 1 }],
          paymentMethodTotals: [{ paymentMethod: "CASH", amount: 50, count: 1 }],
          dailyTotals: [{ period: "2025-03-10", amount: 50, count: 1 }],
          monthlyTotals: [{ period: "2025-03", amount: 75, count: 2 }],
          rows: [
            {
              id: 1,
              expenseDate: "2025-03-10",
              categoryName: "Rent",
              description: "Shop rent",
              amount: 50,
              paymentMethod: "CASH",
              referenceNumber: "RENT-1",
              status: "ACTIVE",
            },
            {
              id: 2,
              expenseDate: "2025-03-11",
              categoryName: "Rent",
              description: "Voided bill",
              amount: 90,
              paymentMethod: "UPI",
              referenceNumber: null,
              status: "CANCELLED",
            },
          ],
          totalRows: 2,
        },
      };
      await exportFinancialReportExcel(report, settings);
      assert.equal(downloadedFilename, "my-medical-expenses-2025-03-10-to-2025-03-12.xlsx");
      assert.ok(downloadedBlob instanceof Blob);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await downloadedBlob.arrayBuffer());
      const summary = workbook.getWorksheet("Expense Summary");
      const ledger = workbook.getWorksheet("Expense Ledger");
      assert.ok(summary);
      assert.ok(ledger);
      const summaryValues = summary.getSheetValues().flat().filter(Boolean);
      assert.ok(summaryValues.includes("Expense by category"));
      assert.ok(summaryValues.includes("Expense by payment method"));
      assert.ok(summaryValues.includes("Daily expense totals"));
      assert.ok(summaryValues.includes("Monthly expense totals"));
      assert.equal(ledger.getCell("G10").value, "ACTIVE");
      assert.equal(ledger.getCell("G11").value, "CANCELLED");
      assert.equal(ledger.getCell("D11").value, 90);

      const financialReport = {
        reportType: "financial_summary",
        data: {
          range,
          grossSales: 1000,
          salesReturns: 100,
          netSales: 900,
          grossPurchases: 500,
          purchaseReturns: 20,
          netPurchases: 480,
          cogs: 450,
          grossProfit: 450,
          operatingExpenses: 75,
          netProfit: 375,
          customerOutstanding: 50,
          supplierOutstanding: 30,
          stockValuation: 1500,
          stockQuantity: 20,
          costUnavailableInvoices: 0,
        },
      };
      await exportFinancialReportExcel(financialReport, settings);
      assert.equal(
        downloadedFilename,
        "my-medical-financial_summary-2025-03-10-to-2025-03-12.xlsx",
      );
      const financialWorkbook = new ExcelJS.Workbook();
      await financialWorkbook.xlsx.load(await downloadedBlob.arrayBuffer());
      const financialSheet = financialWorkbook.getWorksheet("Financial Summary");
      assert.ok(financialSheet);
      assert.equal(financialSheet.getCell("A18").value, "Operating expenses");
      assert.equal(financialSheet.getCell("B18").value, 75);
      assert.equal(financialSheet.getCell("A19").value, "Net profit");
      assert.equal(financialSheet.getCell("B19").value, 375);
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else delete globalThis.window;
      if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
      else delete globalThis.document;
      if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
      else delete URL.createObjectURL;
      if (originalRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
      else delete URL.revokeObjectURL;
    }
  });
});