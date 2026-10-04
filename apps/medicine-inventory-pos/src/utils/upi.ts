export function createUpiPaymentLink(
  upiId: string,
  displayName: string,
  amount: number,
  note: string,
): string | null {
  const payeeAddress = upiId.trim();
  if (!payeeAddress || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const params = new URLSearchParams({
    pa: payeeAddress,
    pn: displayName.trim() || "MY MEDICAL",
    am: amount.toFixed(2),
    cu: "INR",
    tn: note.trim().slice(0, 80),
  });
  return `upi://pay?${params.toString()}`;
}