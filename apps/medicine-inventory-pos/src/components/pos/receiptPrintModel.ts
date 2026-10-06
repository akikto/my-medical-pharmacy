export type ReceiptWidth = "58" | "80" | "A4" | "A5";

export function isReceiptWidth(value: unknown): value is ReceiptWidth {
  return value === "58" || value === "80" || value === "A4" || value === "A5";
}

export function getReceiptPageRule(width: ReceiptWidth): string {
  const standardPaper = width === "A4" || width === "A5";
  const size = standardPaper ? `${width} portrait` : "auto";
  const margin = standardPaper ? "10mm" : "0";
  return `@page { size: ${size}; margin: ${margin}; }`;
}
