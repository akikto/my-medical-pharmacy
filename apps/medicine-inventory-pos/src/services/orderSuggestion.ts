export interface OrderSuggestionInput {
  sellableStock: number;
  reorderLevel: number;
  soldUnits30Days: number;
  salesDays30Days: number;
  pendingOrderQuantity: number;
}

export interface OrderSuggestion {
  targetStock: number;
  suggestedAdditionalQuantity: number;
  limitedSalesHistory: boolean;
  suggestionCapped: boolean;
}

const maximumOrderQuantity = 1_000_000_000;

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
}

export function calculateOrderSuggestion(input: OrderSuggestionInput): OrderSuggestion {
  requireNonNegativeInteger(input.sellableStock, "Sellable stock");
  requireNonNegativeInteger(input.reorderLevel, "Reorder level");
  requireNonNegativeInteger(input.soldUnits30Days, "Recent sales");
  requireNonNegativeInteger(input.salesDays30Days, "Recent sales days");
  requireNonNegativeInteger(input.pendingOrderQuantity, "Pending order quantity");

  const targetStock = Math.max(input.reorderLevel * 2, input.soldUnits30Days);
  const rawSuggestedQuantity = Math.max(
    0,
    targetStock - input.sellableStock - input.pendingOrderQuantity,
  );

  return {
    targetStock,
    suggestedAdditionalQuantity: Math.min(rawSuggestedQuantity, maximumOrderQuantity),
    limitedSalesHistory: input.salesDays30Days < 7,
    suggestionCapped: rawSuggestedQuantity > maximumOrderQuantity,
  };
}