export type ReportRangePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "last_month"
  | "custom";

export type FinancialReportType =
  | "sales_summary"
  | "purchase_summary"
  | "profit_and_loss"
  | "expenses"
  | "financial_summary"
  | "stock_valuation"
  | "product_sales"
  | "company_sales"
  | "customer_due"
  | "supplier_due"
  | "gst";

export type FinancialReportSort =
  | "name"
  | "quantity"
  | "net_sales"
  | "gross_profit"
  | "outstanding";

export interface ReportDateRange {
  startDate: string;
  endDate: string;
}

export interface ReportTransactionRow {
  kind: string;
  date: string;
  reference: string;
  partyName: string | null;
  paymentMode: string | null;
  status: string | null;
  amount: number;
  taxableAmount: number;
  gstAmount: number;
}

export interface SalesSummaryReport {
  range: ReportDateRange;
  grossSales: number;
  salesReturns: number;
  voidSales: number;
  netSales: number;
  taxableSales: number;
  cgst: number;
  sgst: number;
  igst: number;
  outputGst: number;
  cashSales: number;
  upiSales: number;
  otherSales: number;
  creditSales: number;
  invoiceCount: number;
  returnedInvoiceCount: number;
  returnTransactionCount: number;
  voidedInvoiceCount: number;
  correctionCount: number;
  costUnavailableInvoices: number;
  rows: ReportTransactionRow[];
  totalRows: number;
}

export interface PurchaseSummaryReport {
  range: ReportDateRange;
  grossPurchases: number;
  purchaseReturns: number;
  cancelledPurchases: number;
  netPurchases: number;
  taxablePurchases: number;
  cgst: number;
  sgst: number;
  igst: number;
  inputGst: number;
  cashPayments: number;
  bankPayments: number;
  upiPayments: number;
  otherPayments: number;
  invoiceCount: number;
  cancelledInvoiceCount: number;
  returnTransactionCount: number;
  rows: ReportTransactionRow[];
  totalRows: number;
}

export interface ProductSalesRow {
  medicineId: number;
  medicineName: string;
  barcode: string | null;
  company: string | null;
  quantitySold: number;
  returnedQuantity: number;
  voidedQuantity: number;
  netQuantity: number;
  grossSales: number;
  returns: number;
  voidedSales: number;
  netSales: number;
  taxableSales: number;
  gst: number;
  cogs: number | null;
  grossProfit: number | null;
  marginPercent: number | null;
}

export interface ProfitAndLossReport {
  range: ReportDateRange;
  grossSales: number;
  salesReturns: number;
  netSales: number;
  cogs: number | null;
  grossProfit: number | null;
  grossMarginPercent: number | null;
  operatingExpenses: number;
  netProfit: number | null;
  netMarginPercent: number | null;
  costUnavailableInvoices: number;
  productRows: ProductSalesRow[];
}

export interface ExpenseReportRow {
  id: number;
  expenseDate: string;
  categoryName: string;
  description: string;
  amount: number;
  paymentMethod: "CASH" | "BANK" | "UPI" | "OTHER";
  referenceNumber: string | null;
  status: "ACTIVE" | "CANCELLED";
}

export interface ExpenseCategoryTotal {
  categoryName: string;
  amount: number;
  count: number;
}

export interface ExpensePaymentTotal {
  paymentMethod: "CASH" | "BANK" | "UPI" | "OTHER";
  amount: number;
  count: number;
}

export interface ExpensePeriodTotal {
  period: string;
  amount: number;
  count: number;
}

export interface ExpenseReport {
  range: ReportDateRange;
  totalExpenses: number;
  activeCount: number;
  cancelledCount: number;
  categoryTotals: ExpenseCategoryTotal[];
  paymentMethodTotals: ExpensePaymentTotal[];
  dailyTotals: ExpensePeriodTotal[];
  monthlyTotals: ExpensePeriodTotal[];
  rows: ExpenseReportRow[];
  totalRows: number;
}

export interface FinancialSummaryReport {
  range: ReportDateRange;
  grossSales: number;
  salesReturns: number;
  netSales: number;
  grossPurchases: number;
  purchaseReturns: number;
  netPurchases: number;
  cogs: number | null;
  grossProfit: number | null;
  operatingExpenses: number;
  netProfit: number | null;
  customerOutstanding: number;
  supplierOutstanding: number;
  stockValuation: number;
  stockQuantity: number;
  costUnavailableInvoices: number;
}

export interface StockValuationRow {
  medicineId: number;
  medicineName: string;
  company: string | null;
  barcode: string | null;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  purchaseCost: number;
  mrp: number;
  saleRate: number;
  costValue: number;
  mrpValue: number;
  saleValue: number;
  stockStatus: "EXPIRED" | "NEAR_EXPIRY" | "LOW_STOCK" | "SELLABLE";
}

export interface StockValuationReport {
  asOfDate: string;
  nearExpiryDays: number;
  sellableQuantity: number;
  sellableCostValue: number;
  sellableMrpValue: number;
  sellableSaleValue: number;
  expiredQuantity: number;
  expiredCostValue: number;
  nearExpiryQuantity: number;
  nearExpiryCostValue: number;
  lowStockItems: number;
  totalStockQuantity: number;
  totalStockCostValue: number;
  totalStockMrpValue: number;
  rows: StockValuationRow[];
  totalRows: number;
}

export interface ProductSalesReport {
  range: ReportDateRange;
  rows: ProductSalesRow[];
  totalRows: number;
  page: number;
  pageSize: number;
}

export interface CompanySalesRow {
  company: string;
  quantitySold: number;
  returnedQuantity: number;
  voidedQuantity: number;
  netQuantity: number;
  grossSales: number;
  returns: number;
  voidedSales: number;
  netSales: number;
  gst: number;
  cogs: number | null;
  grossProfit: number | null;
  marginPercent: number | null;
}

export interface CompanySalesReport {
  range: ReportDateRange;
  rows: CompanySalesRow[];
  totalRows: number;
  page: number;
  pageSize: number;
}

export interface CustomerDueRow {
  customerId: number;
  customerName: string;
  phone: string | null;
  totalCredit: number;
  totalPaid: number;
  outstandingBalance: number;
  lastTransactionDate: string | null;
}

export interface CustomerDueReport {
  range: ReportDateRange;
  rows: CustomerDueRow[];
  totalRows: number;
  page: number;
  pageSize: number;
}

export interface SupplierDueRow {
  supplierId: number;
  supplierName: string;
  contactPerson: string | null;
  phone: string | null;
  totalPurchases: number;
  purchaseReturns: number;
  payments: number;
  outstandingBalance: number;
  lastTransactionDate: string | null;
}

export interface SupplierDueReport {
  range: ReportDateRange;
  rows: SupplierDueRow[];
  totalRows: number;
  page: number;
  pageSize: number;
}

export interface GstDetailRow {
  kind: string;
  date: string;
  invoiceNo: string;
  partyName: string | null;
  taxType: string;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
}

export interface GstReport {
  range: ReportDateRange;
  taxableSales: number;
  outputCgst: number;
  outputSgst: number;
  outputIgst: number;
  totalOutputGst: number;
  taxablePurchases: number;
  inputCgst: number;
  inputSgst: number;
  inputIgst: number;
  totalInputGst: number;
  netGstPosition: number;
  sameStateOutputTaxable: number;
  interstateOutputTaxable: number;
  sameStateInputTaxable: number;
  interstateInputTaxable: number;
  salesRows: GstDetailRow[];
  purchaseRows: GstDetailRow[];
}

export type FinancialReportData =
  | { reportType: "sales_summary"; data: SalesSummaryReport }
  | { reportType: "purchase_summary"; data: PurchaseSummaryReport }
  | { reportType: "profit_and_loss"; data: ProfitAndLossReport }
  | { reportType: "expenses"; data: ExpenseReport }
  | { reportType: "financial_summary"; data: FinancialSummaryReport }
  | { reportType: "stock_valuation"; data: StockValuationReport }
  | { reportType: "product_sales"; data: ProductSalesReport }
  | { reportType: "company_sales"; data: CompanySalesReport }
  | { reportType: "customer_due"; data: CustomerDueReport }
  | { reportType: "supplier_due"; data: SupplierDueReport }
  | { reportType: "gst"; data: GstReport };

interface DateRangeRequest {
  range: ReportDateRange;
}

interface PagedRequest extends DateRangeRequest {
  search?: string;
  page: number;
  pageSize: number;
  sortBy?: FinancialReportSort;
}

export type FinancialReportRequest =
  | (DateRangeRequest & { reportType: "sales_summary" })
  | (DateRangeRequest & {
      reportType: "purchase_summary";
      supplierId?: number | null;
    })
  | (DateRangeRequest & { reportType: "profit_and_loss" })
  | (DateRangeRequest & { reportType: "expenses" })
  | (DateRangeRequest & { reportType: "financial_summary" })
  | { reportType: "stock_valuation"; nearExpiryDays: number }
  | (PagedRequest & { reportType: "product_sales" })
  | (PagedRequest & { reportType: "company_sales" })
  | (PagedRequest & {
      reportType: "customer_due";
      outstandingOnly: boolean;
    })
  | (PagedRequest & {
      reportType: "supplier_due";
      outstandingOnly: boolean;
    })
  | (DateRangeRequest & { reportType: "gst" });

export type PagedFinancialReportRequest = Extract<
  FinancialReportRequest,
  { page: number }
>;