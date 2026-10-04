export type GstPricingMode = "INCLUSIVE" | "EXCLUSIVE";
export type GstTaxType = "NONE" | "CGST_SGST" | "IGST";

export interface GstCartLine {
  quantity: number;
  unit_price_cents: number;
  item_discount_cents: number;
  gst_rate_basis_points: number | null;
  gst_rate_override_basis_points: number | null;
}

export interface GstInvoiceTotals {
  subtotal_cents: number;
  item_discount_cents: number;
  flat_discount_cents: number;
  taxable_cents: number;
  cgst_cents: number;
  sgst_cents: number;
  igst_cents: number;
  total_gst_cents: number;
  grand_total_cents: number;
  tax_type: GstTaxType;
  missing_rate: boolean;
}

function roundedRatio(numerator: bigint, denominator: bigint): number {
  return Number((numerator + denominator / 2n) / denominator);
}

export function calculateGstInvoiceTotals(
  lines: GstCartLine[],
  flatDiscountCents: number,
  gstEnabled: boolean,
  defaultRateBasisPoints: number | null,
  pricingMode: GstPricingMode,
  pharmacyStateCode: string,
  customerStateCode: string | null,
): GstInvoiceTotals {
  const subtotalCents = lines.reduce(
    (sum, line) => sum + line.unit_price_cents * line.quantity,
    0,
  );
  const itemDiscountCents = lines.reduce(
    (sum, line) => sum + line.item_discount_cents,
    0,
  );
  const netBeforeBillDiscount = Math.max(subtotalCents - itemDiscountCents, 0);
  const finalFlatDiscountCents = Math.max(
    0,
    Math.min(flatDiscountCents, netBeforeBillDiscount),
  );
  const lineNets = lines.map(
    (line) =>
      line.unit_price_cents * line.quantity - line.item_discount_cents,
  );
  const weightTotal = lineNets.reduce((sum, value) => sum + value, 0);
  const billDiscountShares = new Array<number>(lines.length).fill(0);
  // Match native allocation exactly, including the final-line remainder.
  let allocatedDiscountCents = 0;
  for (let index = 0; index < billDiscountShares.length; index += 1) {
    if (index === billDiscountShares.length - 1) {
      billDiscountShares[index] = finalFlatDiscountCents - allocatedDiscountCents;
    } else {
      billDiscountShares[index] = Math.floor(
        (finalFlatDiscountCents * lineNets[index]) / weightTotal,
      );
      allocatedDiscountCents += billDiscountShares[index];
    }
  }

  const placeOfSupply = customerStateCode || pharmacyStateCode;
  const interstate =
    gstEnabled &&
    Boolean(pharmacyStateCode) &&
    placeOfSupply !== pharmacyStateCode;
  const taxType: GstTaxType = !gstEnabled
    ? "NONE"
    : interstate
      ? "IGST"
      : "CGST_SGST";
  let taxableCents = 0;
  let cgstCents = 0;
  let sgstCents = 0;
  let igstCents = 0;
  let totalGstCents = 0;
  let grandTotalCents = 0;
  let missingRate = false;

  lines.forEach((line, index) => {
    const lineAmount =
      lineNets[index] - (billDiscountShares[index] ?? 0);
    if (!gstEnabled) {
      grandTotalCents += lineAmount;
      return;
    }
    const rate =
      line.gst_rate_override_basis_points ??
      line.gst_rate_basis_points ??
      defaultRateBasisPoints;
    if (rate === null || !Number.isInteger(rate) || rate < 0 || rate > 10_000) {
      missingRate = true;
    }
    const rateBasisPoints =
      rate !== null && Number.isInteger(rate) && rate >= 0 && rate <= 10_000
        ? rate
        : 0;
    let lineTaxable: number;
    let lineGst: number;
    if (pricingMode === "INCLUSIVE") {
      const denominator = BigInt(10_000 + rateBasisPoints);
      lineTaxable = roundedRatio(
        BigInt(lineAmount) * 10_000n,
        denominator,
      );
      lineGst = lineAmount - lineTaxable;
      grandTotalCents += lineAmount;
    } else {
      lineTaxable = lineAmount;
      lineGst = roundedRatio(
        BigInt(lineAmount) * BigInt(rateBasisPoints),
        10_000n,
      );
      grandTotalCents += lineAmount + lineGst;
    }
    taxableCents += lineTaxable;
    totalGstCents += lineGst;
    if (interstate) {
      igstCents += lineGst;
    } else {
      const lineCgst = Math.floor(lineGst / 2);
      cgstCents += lineCgst;
      sgstCents += lineGst - lineCgst;
    }
  });

  return {
    subtotal_cents: subtotalCents,
    item_discount_cents: itemDiscountCents,
    flat_discount_cents: finalFlatDiscountCents,
    taxable_cents: taxableCents,
    cgst_cents: cgstCents,
    sgst_cents: sgstCents,
    igst_cents: igstCents,
    total_gst_cents: totalGstCents,
    grand_total_cents: grandTotalCents,
    tax_type: taxType,
    missing_rate: missingRate,
  };
}