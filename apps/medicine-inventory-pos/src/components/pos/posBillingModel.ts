import type { MedicineSearchResult } from "../../types";

export function normalizeBarcode(value: string): string {
  return value.trim().toUpperCase();
}

export type BarcodeLookup =
  | { kind: "not-found" }
  | { kind: "match"; result: MedicineSearchResult }
  | { kind: "ambiguous"; matches: MedicineSearchResult[] };

export function resolveBarcodeLookup(
  results: MedicineSearchResult[],
  rawBarcode: string,
): BarcodeLookup {
  if (!normalizeBarcode(rawBarcode)) {
    return { kind: "not-found" };
  }

  const exactMatches = new Map<number, MedicineSearchResult>();
  for (const result of results) {
    if (result.exact_barcode_match) {
      exactMatches.set(result.medicine.id, result);
    }
  }

  const matches = [...exactMatches.values()];
  if (matches.length === 0) {
    return { kind: "not-found" };
  }
  if (matches.length === 1) {
    return { kind: "match", result: matches[0] };
  }
  return { kind: "ambiguous", matches };
}

export function parseSalePriceDraft(value: string): number | null {
  const normalized = value.trim();
  if (
    !normalized ||
    !/^\d*(?:\.\d{0,2})?$/.test(normalized) ||
    !/\d/.test(normalized)
  ) {
    return null;
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }
  const cents = Math.round((amount + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents / 100 : null;
}