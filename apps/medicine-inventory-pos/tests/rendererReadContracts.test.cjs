const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const { afterEach, beforeEach, describe, it } = require("node:test");
const ts = require("typescript");
const { createFixture, invokeRead, state } = require("./rendererReadFixture.cjs");

const originalModuleLoad = Module._load;
Module._load = function loadWithTauriReadMock(request, parent, isMain) {
  if (request === "@tauri-apps/api/core") {
    return {
      invoke: async (command, args = {}) => invokeRead(command, args),
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
let fixture;

beforeEach(() => {
  fixture = createFixture();
});

afterEach(() => {
  fixture?.close();
  fixture = null;
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
      rackLocation: "Rack-East",
      minStockAlert: 4,
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
    assert.deepEqual(Object.keys(results[0]), ["medicine", "available_stock", "fefo_batch"]);
    assert.deepEqual(Object.keys(results[0].medicine), [
      "id",
      "name",
      "generic_name",
      "company",
      "rack_location",
      "min_stock_alert",
      "gst_rate_basis_points",
      "created_at",
    ]);
    assert.deepEqual(await searchMedicines("no such medicine"), []);
    assert.deepEqual(
      (await searchMedicines("Alpha", 1)).map((row) => row.medicine.id),
      [1],
    );
    await assert.rejects(searchMedicines("Alpha", 0), /Search limit must be between 1 and 100/);
  });

  it("prioritizes exact barcode matches and exact-barcode batches", async () => {
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
      [["Zeta", 2], ["Alpha", 3]],
    );
    assert.deepEqual(await searchMedicines("ABSENT-CODE"), []);
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
      gross_profit: 105,
      total_invoices: 5,
      cash_revenue: 110,
      cash_invoices: 1,
      card_upi_revenue: 65,
      card_upi_invoices: 2,
      other_revenue: 35,
      other_invoices: 2,
      profit_unavailable_invoices: 1,
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
        gross_profit: 0,
        total_invoices: 0,
        cash_revenue: 0,
        cash_invoices: 0,
        card_upi_revenue: 0,
        card_upi_invoices: 0,
        other_revenue: 0,
        other_invoices: 0,
        profit_unavailable_invoices: 0,
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