import { invoke } from "@tauri-apps/api/core";
import type { EntityId, ISODate, OrderListItem, OrderListItemInput } from "../types";

interface OrderListMutationResult {
  item_id: EntityId | null;
  rows_affected: number;
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive whole number.`);
  }
}

function requireIsoDate(value: ISODate): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Order date must be in YYYY-MM-DD format.");
  }
  const parsed = new Date(`${value}T00:00:00`);
  const localValue = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  if (Number.isNaN(parsed.getTime()) || localValue !== value) {
    throw new Error("Order date must be a valid calendar date.");
  }
}

export async function getOrderList(orderDate: ISODate): Promise<OrderListItem[]> {
  requireIsoDate(orderDate);
  return invoke<OrderListItem[]>("get_order_list", { orderDate });
}

export async function saveOrderListItem(
  input: OrderListItemInput,
): Promise<EntityId> {
  requirePositiveInteger(input.medicine_id, "Medicine id");
  if (input.id !== undefined) requirePositiveInteger(input.id, "Order item id");
  if (input.supplier_id != null) {
    requirePositiveInteger(input.supplier_id, "Supplier id");
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1_000_000_000) {
    throw new Error("Order quantity must be between 1 and 1,000,000,000.");
  }
  requireIsoDate(input.order_date);

  const result = await invoke<OrderListMutationResult>("mutate_order_list", {
    operation: {
      kind: "save_item",
      id: input.id,
      medicine_id: input.medicine_id,
      supplier_id: input.supplier_id ?? null,
      quantity: input.quantity,
      note: input.note?.trim() ?? null,
      order_date: input.order_date,
    },
  });
  if (result.item_id === null || !Number.isSafeInteger(result.item_id) || result.item_id <= 0) {
    throw new Error("The order item was saved but its local id could not be confirmed.");
  }
  return result.item_id;
}

export async function setOrderListItemOrdered(
  itemId: EntityId,
  ordered: boolean,
): Promise<void> {
  requirePositiveInteger(itemId, "Order item id");
  await invoke<OrderListMutationResult>("mutate_order_list", {
    operation: { kind: "set_ordered", item_id: itemId, ordered },
  });
}

export async function removeOrderListItem(itemId: EntityId): Promise<void> {
  requirePositiveInteger(itemId, "Order item id");
  await invoke<OrderListMutationResult>("mutate_order_list", {
    operation: { kind: "delete_item", item_id: itemId },
  });
}

export async function clearOrderListForDate(orderDate: ISODate): Promise<number> {
  requireIsoDate(orderDate);
  const result = await invoke<OrderListMutationResult>("mutate_order_list", {
    operation: { kind: "clear_date", order_date: orderDate },
  });
  if (!Number.isSafeInteger(result.rows_affected) || result.rows_affected < 0) {
    throw new Error("The local database returned an invalid cleared-item count.");
  }
  return result.rows_affected;
}