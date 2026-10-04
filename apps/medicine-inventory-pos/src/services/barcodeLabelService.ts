import type { MedicineBatch, MedicineInventoryRow } from "../types";

export interface BarcodeLabelSource {
  key: string;
  medicine: MedicineInventoryRow;
  batch: MedicineBatch | null;
  barcode: string | null;
}

export const maximumBarcodeLabelQuantity = 500;

export function isPrintableBarcode(barcode: string | null): barcode is string {
  return Boolean(barcode && barcode.length <= 32 && /^[\x20-\x7E]+$/.test(barcode));
}

export function buildBarcodeLabelSources(
  medicines: MedicineInventoryRow[],
  batchGroups: MedicineBatch[][],
): BarcodeLabelSource[] {
  return medicines.flatMap<BarcodeLabelSource>((medicine, index) => {
    const batches = batchGroups[index] ?? [];
    if (batches.length === 0) {
      return [{
        key: `medicine-${medicine.id}`,
        medicine,
        batch: null,
        barcode: medicine.barcode?.trim() || null,
      }];
    }
    return batches.map((batch) => ({
      key: `batch-${medicine.id}-${batch.id}`,
      medicine,
      batch,
      barcode: batch.barcode?.trim() || medicine.barcode?.trim() || null,
    }));
  });
}

export function parseBarcodeLabelQuantity(value: string): number | null {
  if (!value.trim()) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) &&
    quantity >= 1 &&
    quantity <= maximumBarcodeLabelQuantity
    ? quantity
    : null;
}