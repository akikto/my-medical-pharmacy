import type {
  CheckoutSaleInput,
  CreatePurchaseInput,
  EntityId,
  MedicineBatch,
  MedicineFormValues,
  SupplierFormValues,
} from "../types";
import { invoke } from "@tauri-apps/api/core";
import {
  runDevelopmentTransaction,
  type DevelopmentTransactionStatement,
} from "./developmentDatabase";
import { createMedicine, getMedicineBatches } from "./inventoryService";
import { createPurchase } from "./purchaseService";
import { checkoutSale, SaleDetailsUnavailableError } from "./salesService";
import { saveSupplier } from "./supplierService";

type DemoMedicineKey =
  | "paracetamol"
  | "amoxicillin"
  | "cetirizine"
  | "ors"
  | "metformin"
  | "amlodipine"
  | "omeprazole";

type DemoSupplierKey = "north" | "west" | "south";

interface DemoMedicine {
  id: EntityId;
  batchIds: Map<string, MedicineBatch>;
}

interface EmptyDatabaseCounts {
  medicines: number | string;
  medicine_batches: number | string;
  suppliers: number | string;
  purchases: number | string;
  purchase_items: number | string;
  sales: number | string;
  sale_items: number | string;
  stock_adjustments: number | string;
  app_settings: number | string;
}

interface SeedLedger {
  medicineIds: EntityId[];
  supplierIds: EntityId[];
  purchases: Array<{ id: EntityId; itemCount: number }>;
  sales: Array<{ id: EntityId; itemCount: number }>;
  unreturnedSaleInvoiceNos: string[];
}

export interface DevelopmentDemoSeedResult {
  medicines: number;
  suppliers: number;
  purchases: number;
  sales: number;
}

const medicineFixtures: Record<DemoMedicineKey, MedicineFormValues> = {
  paracetamol: {
    name: "DEV DEMO · Paracetamol 650 mg",
    generic_name: "Paracetamol",
    company: "Development Demo Labs A",
    rack_location: "DEMO-A01",
    min_stock_alert: 20,
  },
  amoxicillin: {
    name: "DEV DEMO · Amoxicillin 500 mg",
    generic_name: "Amoxicillin",
    company: "Development Demo Labs B",
    rack_location: "DEMO-A02",
    min_stock_alert: 12,
  },
  cetirizine: {
    name: "DEV DEMO · Cetirizine 10 mg",
    generic_name: "Cetirizine",
    company: "Development Demo Labs C",
    rack_location: "DEMO-B01",
    min_stock_alert: 10,
  },
  ors: {
    name: "DEV DEMO · ORS Lemon 21 g",
    generic_name: "Oral rehydration salts",
    company: "Development Demo Labs A",
    rack_location: "DEMO-B02",
    min_stock_alert: 8,
  },
  metformin: {
    name: "DEV DEMO · Metformin 500 mg",
    generic_name: "Metformin",
    company: "Development Demo Labs B",
    rack_location: "DEMO-C01",
    min_stock_alert: 15,
  },
  amlodipine: {
    name: "DEV DEMO · Amlodipine 5 mg",
    generic_name: "Amlodipine",
    company: "Development Demo Labs C",
    rack_location: "DEMO-C02",
    min_stock_alert: 5,
  },
  omeprazole: {
    name: "DEV DEMO · Omeprazole 20 mg",
    generic_name: "Omeprazole",
    company: "Development Demo Labs A",
    rack_location: "DEMO-D01",
    min_stock_alert: 5,
  },
};

const supplierFixtures: Record<DemoSupplierKey, SupplierFormValues> = {
  north: {
    name: "DEV DEMO · North District Supply",
    phone: "",
    address: "Development fixture only · North region",
  },
  west: {
    name: "DEV DEMO · Western Medical Trade",
    phone: "",
    address: "Development fixture only · West region",
  },
  south: {
    name: "DEV DEMO · Southern Pharmacy Wholesale",
    phone: "",
    address: "Development fixture only · South region",
  },
};

function localDateOffset(dayOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function localNoonIsoTimestamp(dayOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

async function assertEmptyPharmacyDatabase(): Promise<void> {
  const counts = await invoke<EmptyDatabaseCounts>(
    "check_development_database_empty",
  );

  const existingTables = Object.entries(counts)
    .filter(([, count]) => Number(count) > 0)
    .map(([table]) => table);
  if (existingTables.length > 0) {
    throw new Error(
      `Development demo data can only be added to an empty pharmacy database. Existing records were found in: ${existingTables.join(", ")}. No data was changed.`,
    );
  }
}

function addRollbackStatement(
  statements: DevelopmentTransactionStatement[],
  query: string,
  id: EntityId,
  expectedRowsAffected?: number,
): void {
  statements.push({
    query,
    values: [id],
    ...(expectedRowsAffected === undefined ? {} : { expectedRowsAffected }),
  });
}

async function rollbackSeed(ledger: SeedLedger): Promise<void> {
  const statements: DevelopmentTransactionStatement[] = [];

  for (const sale of [...ledger.sales].reverse()) {
    addRollbackStatement(
      statements,
      "DELETE FROM sale_items WHERE sale_id = $1",
      sale.id,
      sale.itemCount,
    );
    addRollbackStatement(
      statements,
      "DELETE FROM sales WHERE id = $1",
      sale.id,
      1,
    );
  }

  for (const invoiceNo of ledger.unreturnedSaleInvoiceNos) {
    statements.push(
      {
        query: `DELETE FROM sale_items
                WHERE sale_id IN (
                  SELECT id FROM sales WHERE invoice_no = $1
                )`,
        values: [invoiceNo],
      },
      {
        query: "DELETE FROM sales WHERE invoice_no = $1",
        values: [invoiceNo],
      },
    );
  }

  for (const purchase of [...ledger.purchases].reverse()) {
    addRollbackStatement(
      statements,
      "DELETE FROM purchase_items WHERE purchase_id = $1",
      purchase.id,
      purchase.itemCount,
    );
    addRollbackStatement(
      statements,
      "DELETE FROM purchases WHERE id = $1",
      purchase.id,
      1,
    );
  }

  for (const medicineId of [...ledger.medicineIds].reverse()) {
    addRollbackStatement(
      statements,
      "DELETE FROM stock_adjustments WHERE medicine_id = $1",
      medicineId,
    );
    addRollbackStatement(
      statements,
      "DELETE FROM medicine_batches WHERE medicine_id = $1",
      medicineId,
    );
    addRollbackStatement(
      statements,
      "DELETE FROM medicines WHERE id = $1",
      medicineId,
      1,
    );
  }

  for (const supplierId of [...ledger.supplierIds].reverse()) {
    addRollbackStatement(
      statements,
      `DELETE FROM suppliers
       WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM purchases WHERE supplier_id = $1)`,
      supplierId,
      1,
    );
  }

  await runDevelopmentTransaction(statements);
}

async function createSeedPurchase(
  ledger: SeedLedger,
  input: CreatePurchaseInput,
): Promise<void> {
  const result = await createPurchase(input);
  ledger.purchases.push({ id: result.purchaseId, itemCount: input.items.length });
}

async function getBatch(
  medicines: Record<DemoMedicineKey, DemoMedicine>,
  key: DemoMedicineKey,
  batchNo: string,
): Promise<MedicineBatch> {
  const medicine = medicines[key];
  const cached = medicine.batchIds.get(batchNo);
  if (cached) {
    return cached;
  }
  const batches = await getMedicineBatches(medicine.id);
  const batch = batches.find((candidate) => candidate.batch_no === batchNo);
  if (!batch) {
    throw new Error(`The development batch ${batchNo} could not be loaded.`);
  }
  medicine.batchIds.set(batchNo, batch);
  return batch;
}

async function createSeedSale(
  ledger: SeedLedger,
  key: string,
  medicines: Record<DemoMedicineKey, DemoMedicine>,
  options: {
    customerName: string;
    paymentMode: CheckoutSaleInput["payment_mode"];
    items: Array<{
      medicine: DemoMedicineKey;
      batchNo: string;
      quantity: number;
    }>;
    flatDiscount?: number;
    dayOffset?: number;
  },
): Promise<void> {
  const items = await Promise.all(
    options.items.map(async (item) => {
      const batch = await getBatch(medicines, item.medicine, item.batchNo);
      return {
        medicine_id: medicines[item.medicine].id,
        batch_id: batch.id,
        quantity: item.quantity,
        unit_price: batch.sale_rate,
        item_discount: 0,
      };
    }),
  );
  const subtotalCents = items.reduce(
    (total, item) => total + Math.round(item.unit_price * 100) * item.quantity,
    0,
  );
  const flatDiscountCents = Math.round((options.flatDiscount ?? 0) * 100);
  const amountDueCents = subtotalCents - flatDiscountCents;
  let sale: Awaited<ReturnType<typeof checkoutSale>>;
  try {
    sale = await checkoutSale({
      customer_name: options.customerName,
      customer_phone: null,
      payment_mode: options.paymentMode,
      flat_discount: options.flatDiscount ?? 0,
      cash_tendered:
        options.paymentMode === "CASH" ? amountDueCents / 100 : 0,
      items,
    });
  } catch (error) {
    if (error instanceof SaleDetailsUnavailableError) {
      ledger.unreturnedSaleInvoiceNos.push(error.invoiceNo);
    }
    throw error;
  }
  ledger.sales.push({ id: sale.sale.id, itemCount: items.length });

  const dayOffset = options.dayOffset ?? 0;
  const invoiceDate = localDateOffset(dayOffset).replaceAll("-", "");
  await runDevelopmentTransaction([
    {
      query: dayOffset === 0
        ? "UPDATE sales SET invoice_no = $1 WHERE id = $2"
        : "UPDATE sales SET invoice_no = $1, created_at = $2 WHERE id = $3",
      values: dayOffset === 0
        ? [`DEV-DEMO-SALE-${key}`, sale.sale.id]
        : [
            `DEV-DEMO-SALE-${invoiceDate}-${key}`,
            localNoonIsoTimestamp(dayOffset),
            sale.sale.id,
          ],
      expectedRowsAffected: 1,
    },
  ]);
}

export async function seedDevelopmentDemoData(): Promise<DevelopmentDemoSeedResult> {
  if (!import.meta.env.DEV) {
    throw new Error("Development demo data is unavailable in production builds.");
  }

  await assertEmptyPharmacyDatabase();

  const ledger: SeedLedger = {
    medicineIds: [],
    supplierIds: [],
    purchases: [],
    sales: [],
    unreturnedSaleInvoiceNos: [],
  };

  try {
    const supplierIds = {} as Record<DemoSupplierKey, EntityId>;
    for (const key of Object.keys(supplierFixtures) as DemoSupplierKey[]) {
      supplierIds[key] = await saveSupplier(supplierFixtures[key]);
      ledger.supplierIds.push(supplierIds[key]);
    }

    const medicines = {} as Record<DemoMedicineKey, DemoMedicine>;
    for (const key of Object.keys(medicineFixtures) as DemoMedicineKey[]) {
      const id = await createMedicine(medicineFixtures[key]);
      ledger.medicineIds.push(id);
      medicines[key] = { id, batchIds: new Map() };
    }

    const batch = (
      key: DemoMedicineKey,
      batchNo: string,
      expiryOffset: number,
      quantity: number,
      purchaseRate: number,
      mrp: number,
      saleRate: number,
    ) => ({
      medicine_id: medicines[key].id,
      batch_no: batchNo,
      expiry_date: localDateOffset(expiryOffset),
      purchase_rate: purchaseRate,
      mrp,
      sale_rate: saleRate,
      quantity,
    });

    await createSeedPurchase(ledger, {
      supplier_id: supplierIds.north,
      invoice_no: "DEV-DEMO-PURCHASE-001",
      purchase_date: localDateOffset(-18),
      items: [
        batch("paracetamol", "DEV-DEMO-PARA-A", 420, 120, 6.5, 30, 22),
        batch("metformin", "DEV-DEMO-MET-A", 365, 65, 7.5, 25, 18),
        batch("omeprazole", "DEV-DEMO-OME-A", 180, 10, 8.5, 40, 30),
      ],
    });

    await createSeedPurchase(ledger, {
      supplier_id: supplierIds.west,
      invoice_no: "DEV-DEMO-PURCHASE-002",
      purchase_date: localDateOffset(-10),
      items: [
        batch("amoxicillin", "DEV-DEMO-AMOX-A", 240, 42, 38, 95, 72),
        batch("cetirizine", "DEV-DEMO-CET-A", 60, 18, 2.5, 20, 13),
      ],
    });

    await createSeedPurchase(ledger, {
      supplier_id: supplierIds.south,
      invoice_no: "DEV-DEMO-PURCHASE-003",
      purchase_date: localDateOffset(-4),
      items: [
        batch("paracetamol", "DEV-DEMO-PARA-B", 300, 50, 6.75, 30, 22),
        batch("amoxicillin", "DEV-DEMO-AMOX-B", 180, 25, 40, 95, 72),
      ],
    });

    await createSeedPurchase(ledger, {
      supplier_id: supplierIds.north,
      invoice_no: "DEV-DEMO-PURCHASE-004",
      purchase_date: localDateOffset(0),
      items: [
        batch("ors", "DEV-DEMO-ORS-A", 20, 30, 7.5, 30, 25),
        batch("metformin", "DEV-DEMO-MET-B", 300, 25, 8, 25, 18),
      ],
    });

    const expiredBatch = await getBatch(medicines, "omeprazole", "DEV-DEMO-OME-A");
    // Normal purchase validation rejects already-expired stock. Adjust only this
    // newly created fixture so the development dashboard can display that state.
    await runDevelopmentTransaction([
      {
        query: `UPDATE medicine_batches
                SET expiry_date = $1
                WHERE id = $2 AND medicine_id = $3`,
        values: [
          localDateOffset(-2),
          expiredBatch.id,
          medicines.omeprazole.id,
        ],
        expectedRowsAffected: 1,
      },
    ]);

    await createSeedSale(ledger, "HIST-01", medicines, {
      customerName: "DEV DEMO CUSTOMER · NORTH",
      paymentMode: "UPI",
      dayOffset: -12,
      items: [{ medicine: "paracetamol", batchNo: "DEV-DEMO-PARA-A", quantity: 3 }],
    });
    await createSeedSale(ledger, "HIST-02", medicines, {
      customerName: "DEV DEMO CUSTOMER · WEST",
      paymentMode: "CASH",
      dayOffset: -6,
      items: [{ medicine: "metformin", batchNo: "DEV-DEMO-MET-A", quantity: 4 }],
    });
    await createSeedSale(ledger, "TODAY-01", medicines, {
      customerName: "DEV DEMO CUSTOMER · WALK-IN A",
      paymentMode: "UPI",
      flatDiscount: 8,
      items: [
        { medicine: "paracetamol", batchNo: "DEV-DEMO-PARA-A", quantity: 7 },
        { medicine: "metformin", batchNo: "DEV-DEMO-MET-A", quantity: 2 },
      ],
    });
    await createSeedSale(ledger, "TODAY-02", medicines, {
      customerName: "DEV DEMO CUSTOMER · WALK-IN B",
      paymentMode: "CASH",
      items: [{ medicine: "cetirizine", batchNo: "DEV-DEMO-CET-A", quantity: 12 }],
    });
    await createSeedSale(ledger, "TODAY-03", medicines, {
      customerName: "DEV DEMO CUSTOMER · SOUTH",
      paymentMode: "CARD",
      items: [{ medicine: "amoxicillin", batchNo: "DEV-DEMO-AMOX-A", quantity: 3 }],
    });
    await createSeedSale(ledger, "TODAY-04", medicines, {
      customerName: "DEV DEMO CUSTOMER · WALK-IN C",
      paymentMode: "UPI",
      items: [{ medicine: "paracetamol", batchNo: "DEV-DEMO-PARA-B", quantity: 2 }],
    });

    return {
      medicines: Object.keys(medicineFixtures).length,
      suppliers: Object.keys(supplierFixtures).length,
      purchases: ledger.purchases.length,
      sales: ledger.sales.length,
    };
  } catch (error) {
    try {
      await rollbackSeed(ledger);
    } catch (rollbackError) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(
        `Development demo seeding failed: ${originalMessage} Cleanup also failed: ${rollbackMessage}. Inspect the development database before retrying.`,
      );
    }
    throw error;
  }
}