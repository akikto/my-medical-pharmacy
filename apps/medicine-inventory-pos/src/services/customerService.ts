import { invoke } from "@tauri-apps/api/core";
import type {
  Customer,
  CustomerFormValues,
  CustomerLedgerEntry,
  CustomerPaymentInput,
  EntityId,
} from "../types";
import { isGstStateCode } from "../utils/gstStates";
import { applyPharmacyMutation } from "./pharmacyWriteService";

interface CustomerPaymentResponse {
  ledgerEntryId: EntityId;
  balanceDueCents: number;
}

function optionalText(value: string, maxLength: number, label: string): string | null {
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized || null;
}

function normalizeCustomer(input: CustomerFormValues) {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Customer name is required.");
  }
  if (name.length > 120) {
    throw new Error("Customer name must be 120 characters or fewer.");
  }
  const phone = optionalText(input.phone, 40, "Phone number");
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      throw new Error("Enter a phone number with 7 to 15 digits.");
    }
  }
  const stateCode = input.state_code.trim();
  if (stateCode && !isGstStateCode(stateCode)) {
    throw new Error("Choose a valid GST state or leave it unset.");
  }
  return {
    name,
    phone,
    address: optionalText(input.address, 500, "Address"),
    notes: optionalText(input.notes, 500, "Notes"),
    state_code: stateCode || null,
  };
}

export async function getCustomers(
  searchTerm = "",
  includeInactive = false,
): Promise<Customer[]> {
  return invoke<Customer[]>("get_customers", {
    searchTerm: searchTerm.trim(),
    includeInactive,
  });
}

export async function getCustomerLedger(
  customerId: EntityId,
): Promise<CustomerLedgerEntry[]> {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    throw new Error("Choose a valid customer.");
  }
  return invoke<CustomerLedgerEntry[]>("get_customer_ledger", { customerId });
}

export async function saveCustomer(
  input: CustomerFormValues,
  customerId?: EntityId,
): Promise<void> {
  const customer = normalizeCustomer(input);
  if (customerId === undefined) {
    await applyPharmacyMutation({ kind: "create_customer", ...customer });
  } else {
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      throw new Error("Choose a valid customer.");
    }
    await applyPharmacyMutation({
      kind: "update_customer",
      customer_id: customerId,
      ...customer,
    });
  }
}

export async function setCustomerActive(
  customerId: EntityId,
  active: boolean,
): Promise<void> {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    throw new Error("Choose a valid customer.");
  }
  await applyPharmacyMutation({
    kind: "set_customer_active",
    customer_id: customerId,
    active,
  });
}

export async function collectCustomerPayment(
  input: CustomerPaymentInput,
): Promise<{ ledger_entry_id: EntityId; balance_due: number }> {
  if (!Number.isSafeInteger(input.customer_id) || input.customer_id <= 0) {
    throw new Error("Choose a valid customer.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Collection amount must be greater than zero.");
  }
  const amountCents = Math.round((input.amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(amountCents)) {
    throw new Error("Collection amount is larger than the supported amount.");
  }
  if (!["CASH", "CARD", "UPI", "OTHER"].includes(input.payment_mode)) {
    throw new Error("Choose a valid collection payment method.");
  }
  const upiTransactionId = optionalText(input.upi_transaction_id ?? "", 120, "UPI transaction ID");
  if (input.payment_mode !== "UPI" && upiTransactionId) {
    throw new Error("A UPI transaction ID can only be saved for a UPI collection.");
  }
  const note = optionalText(input.note, 250, "Collection note");
  const result = await invoke<CustomerPaymentResponse>("collect_customer_payment", {
    payment: {
      customerId: input.customer_id,
      amountCents,
      paymentMode: input.payment_mode,
      upiTransactionId,
      note,
    },
  });
  return {
    ledger_entry_id: result.ledgerEntryId,
    balance_due: result.balanceDueCents / 100,
  };
}