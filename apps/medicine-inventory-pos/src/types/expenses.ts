export type ExpensePaymentMethod = "CASH" | "BANK" | "UPI" | "OTHER";
export type ExpenseStatus = "ACTIVE" | "CANCELLED";

export interface ExpenseCategory {
  id: number;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseRecord {
  id: number;
  expenseDate: string;
  categoryId: number;
  categoryName: string;
  description: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  referenceNumber: string | null;
  status: ExpenseStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseListRequest {
  startDate?: string | null;
  endDate?: string | null;
  categoryId?: number | null;
  paymentMethod?: ExpensePaymentMethod | "ALL" | null;
  status?: ExpenseStatus | "ALL" | null;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ExpenseListResult {
  rows: ExpenseRecord[];
  totalRows: number;
  page: number;
  pageSize: number;
  activeTotal: number;
  cancelledTotal: number;
}

export interface ExpenseCategoryInput {
  id?: number;
  name: string;
}

export interface ExpenseInput {
  id?: number;
  expenseDate: string;
  categoryId: number;
  description: string;
  amountCents: number;
  paymentMethod: ExpensePaymentMethod;
  referenceNumber?: string | null;
}