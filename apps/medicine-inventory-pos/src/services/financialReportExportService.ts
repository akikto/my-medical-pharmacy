import ExcelJS from "exceljs";
import type { StoreSettings } from "../types";
import type { FinancialReportData, ReportTransactionRow } from "../types/financialReports";
import { formatDateTime } from "../utils/money";

type CellValue = string | number | boolean | null;

function downloadWorkbook(bytes: ExcelJS.Buffer, filename: string): void {
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFilename(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
}

function addReportHeader(
  sheet: ExcelJS.Worksheet,
  title: string,
  settings: StoreSettings,
  rangeText: string,
): void {
  const pharmacyName = settings.pharmacy_name.trim() || "MY MEDICAL";
  sheet.addRow([pharmacyName]);
  sheet.addRow([settings.address.trim()]);
  sheet.addRow(
    [
      settings.contact_number.trim() && `Phone: ${settings.contact_number.trim()}`,
      settings.drug_license_number.trim() && `Drug licence: ${settings.drug_license_number.trim()}`,
    ]
      .filter(Boolean)
      .join("  |  "),
  );
  sheet.addRow([title]);
  sheet.addRow([rangeText]);
  sheet.addRow([`Generated: ${formatDateTime(new Date().toISOString())}`]);
  sheet.addRow([]);
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: "FF14532D" } };
  sheet.getRow(4).font = { bold: true, size: 13 };
  sheet.getRow(4).alignment = { vertical: "middle" };
}

function addTable(
  sheet: ExcelJS.Worksheet,
  heading: string,
  headers: string[],
  rows: CellValue[][],
): void {
  sheet.addRow([heading]);
  const header = sheet.addRow(headers);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF166534" },
  };
  rows.forEach((row) => sheet.addRow(row));
  sheet.views = [{ state: "frozen", ySplit: header.number }];
  sheet.autoFilter = {
    from: { row: header.number, column: 1 },
    to: { row: header.number, column: headers.length },
  };
  sheet.columns = headers.map((headerText) => ({
    width: Math.max(14, Math.min(30, headerText.length + 3)),
  }));
}

function transactionRows(rows: ReportTransactionRow[]): CellValue[][] {
  return rows.map((row) => [
    row.date,
    row.kind,
    row.reference,
    row.partyName,
    row.paymentMode,
    row.status,
    row.amount,
    row.taxableAmount,
    row.gstAmount,
  ]);
}

function summaryRows(entries: Array<[string, CellValue]>): CellValue[][] {
  return entries.map(([label, value]) => [label, value]);
}

function addOneSheetExport(
  workbook: ExcelJS.Workbook,
  title: string,
  settings: StoreSettings,
  rangeText: string,
  summary: Array<[string, CellValue]>,
  tableHeading: string,
  headers: string[],
  rows: CellValue[][],
  filename: string,
): Promise<void> {
  const sheet = workbook.addWorksheet("Report", {
    properties: { defaultRowHeight: 20 },
  });
  addReportHeader(sheet, title, settings, rangeText);
  addTable(sheet, "Summary", ["Measure", "Value"], summaryRows(summary));
  sheet.addRow([]);
  addTable(sheet, tableHeading, headers, rows);
  sheet.getColumn(1).width = Math.max(18, Math.min(42, title.length + 8));
  return workbook.xlsx.writeBuffer().then((bytes) => {
    downloadWorkbook(bytes as ExcelJS.Buffer, filename);
  });
}

const transactionHeaders = [
  "Date",
  "Type",
  "Invoice / reference",
  "Customer / supplier",
  "Payment mode",
  "Status",
  "Amount",
  "Taxable amount",
  "GST",
];

function reportRangeText(
  range: { startDate: string; endDate: string },
): string {
  return `Date range: ${range.startDate} to ${range.endDate}`;
}

export async function exportFinancialReportExcel(
  report: FinancialReportData,
  settings: StoreSettings,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.pharmacy_name.trim() || "MY MEDICAL";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = false;
  const prefix = `my-medical-${safeFilename(report.reportType)}`;

  switch (report.reportType) {
    case "sales_summary": {
      const data = report.data;
      return addOneSheetExport(
        workbook,
        "Sales Summary",
        settings,
        reportRangeText(data.range),
        [
          ["Gross sales", data.grossSales],
          ["Sales returns", data.salesReturns],
          ["Cancelled / void sales", data.voidSales],
          ["Net sales", data.netSales],
          ["Taxable sales", data.taxableSales],
          ["CGST", data.cgst],
          ["SGST", data.sgst],
          ["IGST", data.igst],
          ["Output GST", data.outputGst],
          ["Cash sales", data.cashSales],
          ["UPI sales", data.upiSales],
          ["Other sales", data.otherSales],
          ["Credit / due sales", data.creditSales],
          ["Invoice count", data.invoiceCount],
          ["Returned invoices", data.returnedInvoiceCount],
          ["Return transactions", data.returnTransactionCount],
          ["Voided invoices", data.voidedInvoiceCount],
          ["Corrected invoices", data.correctionCount],
        ],
        "Invoice and return activity",
        transactionHeaders,
        transactionRows(data.rows),
        `${prefix}-${data.range.startDate}-to-${data.range.endDate}.xlsx`,
      );
    }
    case "purchase_summary": {
      const data = report.data;
      return addOneSheetExport(
        workbook,
        "Purchase Summary",
        settings,
        reportRangeText(data.range),
        [
          ["Gross purchases", data.grossPurchases],
          ["Purchase returns", data.purchaseReturns],
          ["Cancelled purchases", data.cancelledPurchases],
          ["Net purchases", data.netPurchases],
          ["Taxable purchases", data.taxablePurchases],
          ["Input CGST", data.cgst],
          ["Input SGST", data.sgst],
          ["Input IGST", data.igst],
          ["Input GST", data.inputGst],
          ["Cash supplier payments", data.cashPayments],
          ["Bank supplier payments", data.bankPayments],
          ["UPI supplier payments", data.upiPayments],
          ["Other supplier payments", data.otherPayments],
          ["Purchase invoices", data.invoiceCount],
          ["Cancelled invoices", data.cancelledInvoiceCount],
          ["Purchase return transactions", data.returnTransactionCount],
        ],
        "Purchase and payment activity",
        transactionHeaders,
        transactionRows(data.rows),
        `${prefix}-${data.range.startDate}-to-${data.range.endDate}.xlsx`,
      );
    }
    case "profit_and_loss": {
      const data = report.data;
      return addOneSheetExport(
        workbook,
        "Profit & Loss",
        settings,
        reportRangeText(data.range),
        [
          ["Gross sales", data.grossSales],
          ["Sales returns", data.salesReturns],
          ["Net sales (excluding GST)", data.netSales],
          ["COGS", data.cogs],
          ["Gross profit", data.grossProfit],
          ["Gross margin %", data.grossMarginPercent],
          ["Operating expenses", data.operatingExpenses],
          ["Net profit", data.netProfit],
          ["Net margin %", data.netMarginPercent],
          ["Cost unavailable invoices", data.costUnavailableInvoices],
        ],
        "Product contribution",
        [
          "Medicine",
          "Barcode",
          "Company",
          "Quantity sold",
          "Returned quantity",
          "Voided quantity",
          "Net quantity",
          "Gross sales",
          "Returns",
          "Voided sales",
          "Net sales",
          "Taxable sales",
          "GST",
          "COGS",
          "Gross profit",
          "Margin %",
        ],
        data.productRows.map((row) => [
          row.medicineName,
          row.barcode,
          row.company,
          row.quantitySold,
          row.returnedQuantity,
          row.voidedQuantity,
          row.netQuantity,
          row.grossSales,
          row.returns,
          row.voidedSales,
          row.netSales,
          row.taxableSales,
          row.gst,
          row.cogs,
          row.grossProfit,
          row.marginPercent,
        ]),
        `${prefix}-${data.range.startDate}-to-${data.range.endDate}.xlsx`,
      );
    }
    case "expenses": {
      const data = report.data;
      const rangeText = reportRangeText(data.range);
      const summary = workbook.addWorksheet("Expense Summary");
      addReportHeader(summary, "Expense Report", settings, rangeText);
      addTable(summary, "Overview", ["Measure", "Value"], [
        ["Total active expenses", data.totalExpenses],
        ["Active records", data.activeCount],
        ["Cancelled records", data.cancelledCount],
        ["Records in report", data.totalRows],
      ]);
      summary.addRow([]);
      addTable(summary, "Expense by category", ["Category", "Records", "Amount"], data.categoryTotals.map((row) => [
        row.categoryName, row.count, row.amount,
      ]));
      summary.addRow([]);
      addTable(summary, "Expense by payment method", ["Payment method", "Records", "Amount"], data.paymentMethodTotals.map((row) => [
        row.paymentMethod, row.count, row.amount,
      ]));
      summary.addRow([]);
      addTable(summary, "Daily expense totals", ["Date", "Records", "Amount"], data.dailyTotals.map((row) => [
        row.period, row.count, row.amount,
      ]));
      summary.addRow([]);
      addTable(summary, "Monthly expense totals", ["Month", "Records", "Amount"], data.monthlyTotals.map((row) => [
        row.period, row.count, row.amount,
      ]));

      const ledger = workbook.addWorksheet("Expense Ledger");
      addReportHeader(ledger, "Expense Ledger", settings, rangeText);
      addTable(ledger, "Expense records", [
        "Date", "Category", "Description", "Amount", "Payment method", "Reference", "Status",
      ], data.rows.map((row) => [
        row.expenseDate,
        row.categoryName,
        row.description,
        row.amount,
        row.paymentMethod,
        row.referenceNumber,
        row.status,
      ]));
      const bytes = await workbook.xlsx.writeBuffer();
      downloadWorkbook(
        bytes as ExcelJS.Buffer,
        `${prefix}-${data.range.startDate}-to-${data.range.endDate}.xlsx`,
      );
      return;
    }
    case "financial_summary": {
      const data = report.data;
      const sheet = workbook.addWorksheet("Financial Summary");
      addReportHeader(sheet, "Financial Summary", settings, reportRangeText(data.range));
      addTable(sheet, "Trading and current balances", ["Measure", "Value"], [
        ["Gross sales", data.grossSales],
        ["Sales returns", data.salesReturns],
        ["Net sales excluding GST", data.netSales],
        ["Gross purchases", data.grossPurchases],
        ["Purchase returns", data.purchaseReturns],
        ["Net purchases", data.netPurchases],
        ["COGS", data.cogs],
        ["Gross profit", data.grossProfit],
        ["Operating expenses", data.operatingExpenses],
        ["Net profit", data.netProfit],
        ["Customer outstanding (current)", data.customerOutstanding],
        ["Supplier outstanding (current)", data.supplierOutstanding],
        ["Stock valuation at cost (current)", data.stockValuation],
        ["Stock quantity (current)", data.stockQuantity],
        ["Cost unavailable invoices", data.costUnavailableInvoices],
      ]);
      const bytes = await workbook.xlsx.writeBuffer();
      downloadWorkbook(
        bytes as ExcelJS.Buffer,
        `${prefix}-${data.range.startDate}-to-${data.range.endDate}.xlsx`,
      );
      return;
    }
    case "stock_valuation": {
      const data = report.data;
      return addOneSheetExport(
        workbook,
        "Stock Valuation",
        settings,
        `As of: ${data.asOfDate}`,
        [
          ["Sellable quantity", data.sellableQuantity],
          ["Sellable value at cost", data.sellableCostValue],
          ["Sellable value at MRP", data.sellableMrpValue],
          ["Sellable value at sale rate", data.sellableSaleValue],
          ["Expired quantity", data.expiredQuantity],
          ["Expired value at cost", data.expiredCostValue],
          ["Near-expiry quantity", data.nearExpiryQuantity],
          ["Near-expiry value at cost", data.nearExpiryCostValue],
          ["Low-stock items", data.lowStockItems],
          ["Total stock quantity", data.totalStockQuantity],
          ["Total stock value at cost", data.totalStockCostValue],
          ["Total stock value at MRP", data.totalStockMrpValue],
        ],
        "Batch valuation",
        [
          "Medicine",
          "Company",
          "Barcode",
          "Batch",
          "Expiry date",
          "Status",
          "Quantity",
          "Purchase cost",
          "MRP",
          "Sale rate",
          "Cost value",
          "MRP value",
          "Sale value",
        ],
        data.rows.map((row) => [
          row.medicineName,
          row.company,
          row.barcode,
          row.batchNo,
          row.expiryDate,
          row.stockStatus,
          row.quantity,
          row.purchaseCost,
          row.mrp,
          row.saleRate,
          row.costValue,
          row.mrpValue,
          row.saleValue,
        ]),
        `${prefix}-${data.asOfDate}.xlsx`,
      );
    }
    case "product_sales": {
      const data = report.data;
      return addOneSheetExport(
        workbook,
        "Product-wise Sales",
        settings,
        reportRangeText(data.range),
        [
          ["Products", data.totalRows],
          ["Values", "Gross/net sales include GST; gross profit uses taxable sales excluding GST."],
        ],
        "Medicine sales",
        [
          "Medicine",
          "Barcode",
          "Company",
          "Quantity sold",
          "Returned quantity",
          "Voided quantity",
          "Net quantity",
          "Gross sales",
          "Returns",
          "Voided sales",
          "Net sales",
          "Taxable sales",
          "GST",
          "COGS",
          "Gross profit",
          "Margin %",
        ],
        data.rows.map((row) => [
          row.medicineName,
          row.barcode,
          row.company,
          row.quantitySold,
          row.returnedQuantity,
          row.voidedQuantity,
          row.netQuantity,
          row.grossSales,
          row.returns,
          row.voidedSales,
          row.netSales,
          row.taxableSales,
          row.gst,
          row.cogs,
          row.grossProfit,
          row.marginPercent,
        ]),
        `${prefix}-${data.range.startDate}-to-${data.range.endDate}.xlsx`,
      );
    }
    case "company_sales": {
      const data = report.data;
      return addOneSheetExport(
        workbook,
        "Company-wise Sales",
        settings,
        reportRangeText(data.range),
        [
          ["Companies", data.totalRows],
          ["Values", "Gross/net sales include GST; gross profit uses taxable sales excluding GST."],
        ],
        "Company sales",
        [
          "Company",
          "Quantity sold",
          "Returned quantity",
          "Voided quantity",
          "Net quantity",
          "Gross sales",
          "Returns",
          "Voided sales",
          "Net sales",
          "GST",
          "COGS",
          "Gross profit",
          "Margin %",
        ],
        data.rows.map((row) => [
          row.company,
          row.quantitySold,
          row.returnedQuantity,
          row.voidedQuantity,
          row.netQuantity,
          row.grossSales,
          row.returns,
          row.voidedSales,
          row.netSales,
          row.gst,
          row.cogs,
          row.grossProfit,
          row.marginPercent,
        ]),
        `${prefix}-${data.range.startDate}-to-${data.range.endDate}.xlsx`,
      );
    }
    case "customer_due": {
      const data = report.data;
      return addOneSheetExport(
        workbook,
        "Customer Due",
        settings,
        `${reportRangeText(data.range)}; outstanding is current lifetime balance`,
        [["Customers", data.totalRows]],
        "Customer balances",
        [
          "Customer",
          "Phone",
          "Credit in range",
          "Collected in range",
          "Current outstanding",
          "Last transaction",
        ],
        data.rows.map((row) => [
          row.customerName,
          row.phone,
          row.totalCredit,
          row.totalPaid,
          row.outstandingBalance,
          row.lastTransactionDate,
        ]),
        `${prefix}-${data.range.startDate}-to-${data.range.endDate}.xlsx`,
      );
    }
    case "supplier_due": {
      const data = report.data;
      return addOneSheetExport(
        workbook,
        "Supplier Due",
        settings,
        `${reportRangeText(data.range)}; outstanding is current lifetime balance`,
        [["Suppliers", data.totalRows]],
        "Supplier balances",
        [
          "Supplier",
          "Contact person",
          "Phone",
          "Purchases in range",
          "Returns in range",
          "Payments in range",
          "Current outstanding",
          "Last transaction",
        ],
        data.rows.map((row) => [
          row.supplierName,
          row.contactPerson,
          row.phone,
          row.totalPurchases,
          row.purchaseReturns,
          row.payments,
          row.outstandingBalance,
          row.lastTransactionDate,
        ]),
        `${prefix}-${data.range.startDate}-to-${data.range.endDate}.xlsx`,
      );
    }
    case "gst": {
      const data = report.data;
      const sheet = workbook.addWorksheet("GST Summary");
      addReportHeader(sheet, "GST Report", settings, reportRangeText(data.range));
      addTable(sheet, "GST totals", ["Measure", "Value"], summaryRows([
        ["Taxable sales", data.taxableSales],
        ["Output CGST", data.outputCgst],
        ["Output SGST", data.outputSgst],
        ["Output IGST", data.outputIgst],
        ["Total output GST", data.totalOutputGst],
        ["Taxable purchases", data.taxablePurchases],
        ["Input CGST", data.inputCgst],
        ["Input SGST", data.inputSgst],
        ["Input IGST", data.inputIgst],
        ["Total input GST", data.totalInputGst],
        ["Net GST position", data.netGstPosition],
        ["Same-state output taxable", data.sameStateOutputTaxable],
        ["Interstate output taxable", data.interstateOutputTaxable],
        ["Same-state input taxable", data.sameStateInputTaxable],
        ["Interstate input taxable", data.interstateInputTaxable],
      ]));
      const detailsHeaders = [
        "Date",
        "Type",
        "Invoice",
        "Customer / supplier",
        "Tax type",
        "Taxable amount",
        "CGST",
        "SGST",
        "IGST",
        "Total GST",
      ];
      for (const [name, rows] of [
        ["Sales GST Details", data.salesRows],
        ["Purchase GST Details", data.purchaseRows],
      ] as const) {
        const detailSheet = workbook.addWorksheet(name);
        addReportHeader(detailSheet, name, settings, reportRangeText(data.range));
        addTable(
          detailSheet,
          name,
          detailsHeaders,
          rows.map((row) => [
            row.date,
            row.kind,
            row.invoiceNo,
            row.partyName,
            row.taxType,
            row.taxableAmount,
            row.cgst,
            row.sgst,
            row.igst,
            row.totalGst,
          ]),
        );
      }
      const bytes = await workbook.xlsx.writeBuffer();
      downloadWorkbook(
        bytes as ExcelJS.Buffer,
        `${prefix}-${data.range.startDate}-to-${data.range.endDate}.xlsx`,
      );
      return;
    }
  }
}