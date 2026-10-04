import ExcelJS from "exceljs";
import type { InventoryFilter, MedicineBatch, MedicineInventoryRow } from "../types";

export interface MedicineImportValues {
  medicineId: number | null;
  name: string;
  genericName: string | null;
  company: string | null;
  productType: string | null;
  strength: string | null;
  composition: string | null;
  barcode: string | null;
  uses: string | null;
  adultDose: string | null;
  childDose: string | null;
  gstRateBasisPoints: number | null;
  reorderLevel: number | null;
  rackLocation: string | null;
  openingBatch: {
    batchNo: string;
    expiryDate: string;
    purchaseRateCents: number;
    mrpCents: number;
    saleRateCents: number;
    openingStock: number;
  } | null;
}

export interface ParsedMedicineImportRow {
  rowNumber: number;
  values: MedicineImportValues;
  errors: string[];
}

export interface StockExportRow {
  medicine: MedicineInventoryRow;
  batch: MedicineBatch | null;
}

const spreadsheetMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const templateHeaders = [
  "Medicine ID",
  "Medicine Name",
  "Generic Name",
  "Manufacturer/Company",
  "Product Type",
  "Strength",
  "Composition",
  "Barcode",
  "Uses",
  "Adult Dose",
  "Child Dose",
  "GST Rate (%)",
  "MRP",
  "Sale Price",
  "Purchase Price",
  "Opening Stock",
  "Reorder Level",
  "Batch Number",
  "Expiry Date",
  "Rack Location",
];

function downloadWorkbook(bytes: ExcelJS.Buffer, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: spreadsheetMime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function styleHeader(row: ExcelJS.Row): void {
  row.height = 25;
  row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF24563A" },
  };
  row.alignment = { vertical: "middle", wrapText: true };
}

export async function downloadMedicineImportTemplate(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MY MEDICAL";
  workbook.subject = "Medicine master import template";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Medicine Import", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.addRow(templateHeaders);
  styleHeader(sheet.getRow(1));
  sheet.autoFilter = `A1:${sheet.getColumn(templateHeaders.length).letter}1`;
  sheet.columns = [
    { width: 14 },
    { width: 28 },
    { width: 24 },
    { width: 24 },
    { width: 18 },
    { width: 14 },
    { width: 30 },
    { width: 20, style: { numFmt: "@" } },
    { width: 32 },
    { width: 22 },
    { width: 22 },
    { width: 15, style: { numFmt: "0.00" } },
    { width: 14, style: { numFmt: "0.00" } },
    { width: 14, style: { numFmt: "0.00" } },
    { width: 16, style: { numFmt: "0.00" } },
    { width: 16, style: { numFmt: "0" } },
    { width: 16, style: { numFmt: "0" } },
    { width: 20 },
    { width: 16, style: { numFmt: "yyyy-mm-dd" } },
    { width: 18 },
  ];
  sheet.getColumn(7).numFmt = "@";

  const instructions = workbook.addWorksheet("Instructions", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  instructions.addRows([
    ["Field", "How to use"],
    ["Medicine ID", "Leave blank to match by barcode or add a new medicine. Use an ID from a previous stock export for a stable match."],
    ["Medicine Name", "Required. The name and other fields are validated before import."],
    ["Barcode", "Optional. Barcodes are normalized locally and must be unique."],
    ["GST Rate (%)", "Optional percentage from 0 to 100, with at most two decimal places."],
    ["Batch and opening stock", "If importing any batch values, provide Batch Number, Expiry Date, MRP, Sale Price, Purchase Price, and Opening Stock together."],
    ["Opening Stock", "Imported opening stock is recorded as a local audited adjustment. No purchase invoice is created."],
    ["Update mode", "Blank optional cells keep the current value. Review every match and change before confirming."],
    ["Safety", "Only .xlsx files are accepted. Formula cells are rejected; macros are not loaded or executed. No data is sent outside this device."],
  ]);
  styleHeader(instructions.getRow(1));
  instructions.columns = [{ width: 24 }, { width: 110 }];
  instructions.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });
  const bytes = await workbook.xlsx.writeBuffer();
  downloadWorkbook(bytes, "my-medical-medicine-import-template.xlsx");
}

function cellValue(cell: ExcelJS.Cell): unknown {
  const value: unknown = cell.value;
  if (value && typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      throw new Error("Formula cells are not accepted.");
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && typeof value.text === "string") return value.text;
  }
  return value;
}

function textCell(value: unknown, label: string, errors: string[], maxLength: number): string | null {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > maxLength) errors.push(`${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function numberCell(
  value: unknown,
  label: string,
  errors: string[],
  options: { integer?: boolean; min?: number; max?: number; decimals?: number } = {},
): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) {
    errors.push(`${label} must be a valid number.`);
    return null;
  }
  if (options.integer && !Number.isSafeInteger(number)) {
    errors.push(`${label} must be a whole number.`);
    return null;
  }
  if (options.min !== undefined && number < options.min) {
    errors.push(`${label} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && number > options.max) {
    errors.push(`${label} must be no more than ${options.max}.`);
  }
  if (
    options.decimals !== undefined &&
    Math.abs(number - Number(number.toFixed(options.decimals))) > 0.000001
  ) {
    errors.push(`${label} can have at most ${options.decimals} decimal places.`);
  }
  return number;
}

function isoDateCell(value: unknown, errors: string[]): string | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  let iso: string;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    iso = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  } else {
    iso = String(value).trim();
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    errors.push("Expiry Date must be a valid YYYY-MM-DD date.");
    return null;
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    errors.push("Expiry Date must be a valid calendar date.");
    return null;
  }
  return iso;
}

function normalizedHeader(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function blankRow(row: ExcelJS.Row): boolean {
  let hasContent = false;
  row.eachCell((cell) => {
    const value = cell.value;
    if (value != null && String(value).trim() !== "") hasContent = true;
  });
  return !hasContent;
}

export async function parseMedicineImportFile(file: File): Promise<ParsedMedicineImportRow[]> {
  if (!file.name.toLocaleLowerCase().endsWith(".xlsx")) {
    throw new Error("Choose an .xlsx workbook. Legacy .xls and macro-enabled files are not accepted.");
  }
  if (file.size <= 0 || file.size > 10_000_000) {
    throw new Error("Choose an .xlsx workbook no larger than 10 MB.");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet("Medicine Import") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no readable worksheet.");

  const headerRow = sheet.getRow(1);
  const columns = new Map<string, number>();
  headerRow.eachCell((cell, columnNumber) => {
    const header = normalizedHeader(cellValue(cell));
    if (header) columns.set(header, columnNumber);
  });
  const nameColumn = columns.get("medicinename") ?? columns.get("medicine");
  if (!nameColumn) throw new Error("The first worksheet must include a Medicine Name column.");
  const column = (...names: string[]) => names.map((name) => columns.get(normalizedHeader(name))).find(Boolean);
  const parsedRows: ParsedMedicineImportRow[] = [];
  const importedBarcodes = new Map<string, number>();
  const importedIds = new Map<number, number>();
  const importedNames = new Map<string, number>();
  let parsedRowCount = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (blankRow(row)) continue;
    const errors: string[] = [];
    let hasFormula = false;
    row.eachCell((cell) => {
      try {
        cellValue(cell);
      } catch {
        hasFormula = true;
      }
    });
    if (hasFormula) errors.push("Formula cells are not accepted; enter plain values.");

    const read = (names: string[]) => {
      const index = column(...names);
      if (!index) return null;
      try {
        return cellValue(row.getCell(index));
      } catch {
        return null;
      }
    };
    const name = textCell(read(["Medicine Name", "Medicine"]), "Medicine Name", errors, 120) ?? "";
    if (!name) errors.push("Medicine Name is required.");
    const medicineId = numberCell(read(["Medicine ID"]), "Medicine ID", errors, {
      integer: true,
      min: 1,
      max: 2_147_483_647,
    });
    const genericName = textCell(read(["Generic Name"]), "Generic Name", errors, 150);
    const company = textCell(read(["Manufacturer/Company", "Company", "Manufacturer"]), "Company", errors, 120);
    const productType = textCell(read(["Product Type"]), "Product Type", errors, 80);
    const strength = textCell(read(["Strength"]), "Strength", errors, 80);
    const composition = textCell(read(["Composition"]), "Composition", errors, 500);
    const barcode = textCell(read(["Barcode"]), "Barcode", errors, 128);
    const uses = textCell(read(["Uses"]), "Uses", errors, 1000);
    const adultDose = textCell(read(["Adult Dose"]), "Adult Dose", errors, 500);
    const childDose = textCell(read(["Child Dose"]), "Child Dose", errors, 500);
    const rackLocation = textCell(read(["Rack Location"]), "Rack Location", errors, 80);
    const gstPercent = numberCell(read(["GST Rate (%)", "GST Rate"]), "GST Rate", errors, {
      min: 0,
      max: 100,
      decimals: 2,
    });
    const reorderLevel = numberCell(read(["Reorder Level"]), "Reorder Level", errors, {
      integer: true,
      min: 0,
      max: 1_000_000_000,
    });

    const batchNo = textCell(read(["Batch Number", "Batch No"]), "Batch Number", errors, 120);
    const expiryErrors: string[] = [];
    const expiryDate = isoDateCell(read(["Expiry Date"]), expiryErrors);
    const purchaseRate = numberCell(read(["Purchase Price", "Purchase Rate"]), "Purchase Price", errors, {
      min: 0,
      max: 1_000_000_000,
      decimals: 2,
    });
    const mrp = numberCell(read(["MRP"]), "MRP", errors, {
      min: 0,
      max: 1_000_000_000,
      decimals: 2,
    });
    const saleRate = numberCell(read(["Sale Price", "Sale Rate"]), "Sale Price", errors, {
      min: 0,
      max: 1_000_000_000,
      decimals: 2,
    });
    const openingStock = numberCell(read(["Opening Stock"]), "Opening Stock", errors, {
      integer: true,
      min: 0,
      max: 1_000_000_000,
    });
    const hasBatchValues = [
      batchNo,
      expiryDate,
      purchaseRate,
      mrp,
      saleRate,
      openingStock,
    ].some((value) => value !== null);
    let openingBatch: MedicineImportValues["openingBatch"] = null;
    if (hasBatchValues) {
      errors.push(...expiryErrors);
      if (!batchNo) errors.push("Batch Number is required when importing a batch.");
      if (!expiryDate && expiryErrors.length === 0) errors.push("Expiry Date is required when importing a batch.");
      if (purchaseRate === null) errors.push("Purchase Price is required when importing a batch.");
      if (mrp === null) errors.push("MRP is required when importing a batch.");
      if (saleRate === null) errors.push("Sale Price is required when importing a batch.");
      if (openingStock === null) errors.push("Opening Stock is required when importing a batch.");
      if (
        batchNo &&
        expiryDate &&
        purchaseRate !== null &&
        mrp !== null &&
        saleRate !== null &&
        openingStock !== null
      ) {
        openingBatch = {
          batchNo,
          expiryDate,
          purchaseRateCents: Math.round(purchaseRate * 100),
          mrpCents: Math.round(mrp * 100),
          saleRateCents: Math.round(saleRate * 100),
          openingStock,
        };
      }
    }
    if (barcode) {
      const normalizedBarcode = barcode.trim().toLocaleUpperCase();
      const previousRow = importedBarcodes.get(normalizedBarcode);
      if (previousRow) {
        errors.push(`Barcode duplicates row ${previousRow} in this workbook.`);
      } else {
        importedBarcodes.set(normalizedBarcode, rowNumber);
      }
    }
    if (medicineId !== null) {
      const previousRow = importedIds.get(medicineId);
      if (previousRow) errors.push(`Medicine ID duplicates row ${previousRow} in this workbook.`);
      else importedIds.set(medicineId, rowNumber);
    }
    const medicineKey = [name.trim(), strength?.trim() ?? "", company?.trim() ?? ""]
      .map((part) => part.toLocaleLowerCase())
      .join("|");
    const previousNameRow = importedNames.get(medicineKey);
    if (name && previousNameRow) {
      errors.push(`This medicine duplicates row ${previousNameRow} in the workbook.`);
    } else if (name) {
      importedNames.set(medicineKey, rowNumber);
    }
    parsedRows.push({
      rowNumber,
      errors: Array.from(new Set(errors)),
      values: {
        medicineId,
        name,
        genericName,
        company,
        productType,
        strength,
        composition,
        barcode,
        uses,
        adultDose,
        childDose,
        gstRateBasisPoints: gstPercent === null ? null : Math.round(gstPercent * 100),
        reorderLevel,
        rackLocation,
        openingBatch,
      },
    });
    parsedRowCount += 1;
    if (parsedRowCount > 1_000) {
      throw new Error("This workbook has more than 1,000 non-empty data rows. Split it into smaller imports.");
    }
  }

  if (parsedRows.length === 0) throw new Error("No medicine rows were found below the header.");
  return parsedRows;
}

function stockStatus(row: StockExportRow): string {
  if (row.batch && row.batch.expiry_date < new Date().toISOString().slice(0, 10)) return "Expired";
  if (row.medicine.available_stock <= row.medicine.min_stock_alert) return "Low stock";
  if (row.medicine.near_expiry_stock > 0) return "Near expiry";
  return "Healthy";
}

function localDateIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function filterStockExportRows(
  rows: StockExportRow[],
  activeFilter: InventoryFilter,
  today = new Date(),
): StockExportRow[] {
  if (activeFilter === "all" || activeFilter === "low-stock") return rows;
  const todayIso = localDateIso(today);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 30);
  const horizonIso = localDateIso(horizon);
  return rows.filter(({ batch }) => {
    if (!batch) return false;
    if (activeFilter === "expired") return batch.expiry_date < todayIso;
    return batch.expiry_date >= todayIso && batch.expiry_date <= horizonIso;
  });
}

export async function buildStockWorkbookBuffer(rows: StockExportRow[]): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MY MEDICAL";
  workbook.subject = "Filtered local inventory stock export";
  const sheet = workbook.addWorksheet("Stock", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const headers = [
    "Medicine",
    "Company",
    "Product Type",
    "Barcode",
    "Batch",
    "Expiry",
    "Current Stock",
    "Reorder Level",
    "MRP",
    "Sale Price",
    "Purchase Price",
    "GST Rate (%)",
    "Stock Status",
  ];
  sheet.addRow(headers);
  styleHeader(sheet.getRow(1));
  for (const { medicine, batch } of rows) {
    sheet.addRow([
      medicine.name,
      medicine.company ?? "",
      medicine.product_type ?? "",
      batch?.barcode ?? medicine.barcode ?? "",
      batch?.batch_no ?? "",
      batch?.expiry_date ?? "",
      batch?.current_stock ?? 0,
      medicine.min_stock_alert,
      batch?.mrp ?? "",
      batch?.sale_rate ?? "",
      batch?.purchase_rate ?? "",
      medicine.gst_rate_basis_points == null
        ? ""
        : medicine.gst_rate_basis_points / 100,
      stockStatus({ medicine, batch }),
    ]);
  }
  sheet.columns = [
    { width: 28 },
    { width: 24 },
    { width: 18 },
    { width: 20, style: { numFmt: "@" } },
    { width: 18 },
    { width: 14, style: { numFmt: "yyyy-mm-dd" } },
    { width: 16, style: { numFmt: "0" } },
    { width: 16, style: { numFmt: "0" } },
    { width: 14, style: { numFmt: "0.00" } },
    { width: 14, style: { numFmt: "0.00" } },
    { width: 16, style: { numFmt: "0.00" } },
    { width: 15, style: { numFmt: "0.00" } },
    { width: 16 },
  ];
  sheet.autoFilter = `A1:M${Math.max(1, rows.length + 1)}`;
  return workbook.xlsx.writeBuffer();
}

export async function downloadStockWorkbook(rows: StockExportRow[]): Promise<void> {
  const bytes = await buildStockWorkbookBuffer(rows);
  downloadWorkbook(bytes, "my-medical-stock-export.xlsx");
}