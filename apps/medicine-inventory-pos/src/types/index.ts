export type EntityId = number;
export type ISODate = string;
export type ISODateTime = string;
export type * from "./expenses";

export interface Medicine {
  id: EntityId;
  name: string;
  generic_name: string | null;
  company: string | null;
  product_type: string | null;
  strength: string | null;
  composition: string | null;
  barcode: string | null;
  uses: string | null;
  adult_dose: string | null;
  child_dose: string | null;
  photo_ref: string | null;
  rack_location: string | null;
  min_stock_alert: number;
  gst_rate_basis_points: number | null;
  created_at: ISODateTime;
}

export interface MedicineInventoryRow extends Medicine {
  available_stock: number;
  expired_stock: number;
  near_expiry_stock: number;
  batch_count: number;
}

export type InventoryFilter = "all" | "low-stock" | "expired" | "near-expiry";

export interface MedicineFormValues {
  name: string;
  generic_name: string;
  company: string;
  product_type: string;
  strength: string;
  composition: string;
  barcode: string;
  uses: string;
  adult_dose: string;
  child_dose: string;
  photo_ref: string | null;
  photo_upload_bytes?: number[] | null;
  photo_remove?: boolean;
  rack_location: string;
  min_stock_alert: number;
  gst_rate_basis_points: number | null;
}

export interface MedicineBatch {
  id: EntityId;
  medicine_id: EntityId;
  batch_no: string;
  expiry_date: ISODate;
  purchase_rate: number;
  mrp: number;
  sale_rate: number;
  current_stock: number;
  barcode: string | null;
}

export interface ImportedMedicineRecord {
  medicine_id: number | null;
  name: string;
  generic_name: string | null;
  company: string | null;
  product_type: string | null;
  strength: string | null;
  composition: string | null;
  barcode: string | null;
  uses: string | null;
  adult_dose: string | null;
  child_dose: string | null;
  rack_location: string | null;
  min_stock_alert: number | null;
  gst_rate_basis_points: number | null;
  opening_batch: {
    batch_no: string;
    expiry_date: string;
    purchase_rate_cents: number;
    mrp_cents: number;
    sale_rate_cents: number;
    opening_stock: number;
  } | null;
}

export interface MedicineOrderUsage {
  medicine_id: EntityId;
  sold_units_30_days: number;
  sales_days_30_days: number;
}

export interface Supplier {
  id: EntityId;
  name: string;
  contact_person: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  address: string | null;
  notes: string | null;
  state_code?: string | null;
  balance_due: number;
}

export interface SupplierFormValues {
  name: string;
  contact_person: string;
  phone: string;
  whatsapp_phone: string;
  address: string;
  notes: string;
  state_code?: string;
}

export interface Purchase {
  id: EntityId;
  invoice_no: string;
  supplier_id: EntityId | null;
  total_amount: number;
  purchase_date: ISODate;
}

export interface PurchaseLineInput {
  medicine_id: EntityId;
  batch_no: string;
  expiry_date: ISODate;
  purchase_rate: number;
  mrp: number;
  sale_rate: number;
  quantity: number;
  gst_rate_override_basis_points?: number | null;
}

export type GstPricingMode = "INCLUSIVE" | "EXCLUSIVE";

export interface CreatePurchaseInput {
  supplier_id: EntityId;
  invoice_no: string;
  purchase_date: ISODate;
  gst_pricing_mode?: GstPricingMode;
  place_of_supply_state_code?: string | null;
  items: PurchaseLineInput[];
}

export interface CompletePurchaseResponse {
  purchaseId: EntityId;
  totalCents: number;
}

export interface RecentPurchase {
  id: EntityId;
  invoice_no: string;
  supplier_id: EntityId | null;
  supplier_name: string | null;
  total_amount: number;
  purchase_date: ISODate;
  item_count: number;
  total_units: number;
}

export interface PurchaseHistoryRecord extends RecentPurchase {
  total_gst: number;
  status: "ACTIVE" | "CANCELLED";
  supplier_balance_due: number;
}

export interface PurchaseLineDetail {
  id: EntityId;
  medicine_id: EntityId;
  medicine_name: string;
  batch_id: EntityId;
  batch_no: string;
  expiry_date: ISODate;
  quantity: number;
  returned_quantity: number;
  available_quantity: number;
  rate: number;
  total: number;
  gst_rate_basis_points: number;
  total_gst: number;
}

export interface PurchaseAttachment {
  id: EntityId;
  file_name: string;
  mime_type: "application/pdf" | "image/jpeg" | "image/png";
  size_bytes: number;
}

export interface PurchaseDetails extends Purchase {
  supplier_name: string | null;
  status: "ACTIVE" | "CANCELLED";
  gst_enabled: boolean;
  gst_pricing_mode: GstPricingMode;
  tax_type: "NONE" | "CGST_SGST" | "IGST";
  place_of_supply_state_code: string | null;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_gst: number;
  lines: PurchaseLineDetail[];
  attachments: PurchaseAttachment[];
}

export interface PurchaseReturnInput {
  purchase_id: EntityId;
  return_date: ISODate;
  note?: string | null;
  items: Array<{ purchase_item_id: EntityId; quantity: number }>;
}

export interface PurchaseReturnResponse {
  returnId: EntityId;
  totalCents: number;
}

export interface SupplierPaymentInput {
  supplier_id: EntityId;
  payment_date: ISODate;
  amount: number;
  payment_method: "CASH" | "BANK" | "UPI" | "OTHER";
  transaction_reference?: string | null;
  note?: string | null;
}

export interface SupplierPaymentResponse {
  ledgerEntryId: EntityId;
  balanceDueCents: number;
}

export type SupplierLedgerEntryType =
  | "PURCHASE"
  | "PURCHASE_RETURN"
  | "PAYMENT"
  | "ADJUSTMENT";

export interface SupplierLedgerEntry {
  id: EntityId;
  entry_type: SupplierLedgerEntryType;
  reference: string | null;
  debit: number;
  credit: number;
  payment_method: string | null;
  transaction_reference: string | null;
  note: string | null;
  created_at: string;
  running_balance: number;
}

export interface SupplierLedger {
  opening_balance: number;
  current_balance: number;
  entries: SupplierLedgerEntry[];
}

export interface OrderListItem {
  id: EntityId;
  medicine_id: EntityId;
  medicine_name: string;
  generic_name: string | null;
  company: string | null;
  supplier_id: EntityId | null;
  supplier_name: string | null;
  quantity: number;
  note: string | null;
  ordered: boolean;
  order_date: ISODate;
}

export interface OrderListItemInput {
  id?: EntityId;
  medicine_id: EntityId;
  supplier_id?: EntityId | null;
  quantity: number;
  note?: string | null;
  order_date: ISODate;
}

export interface WeeklySalesDay {
  sale_date: ISODate;
  total_sales: number;
  invoice_count: number;
}

export type DataResetScope =
  | "sales_history"
  | "purchase_history"
  | "supplier_balances"
  | "all_business_history";

export interface DataResetSummary {
  scope: DataResetScope;
  backup_path: string;
  sales_deleted: number;
  sale_items_deleted: number;
  purchases_deleted: number;
  purchase_items_deleted: number;
  stock_adjustments_deleted: number;
  order_list_items_deleted: number;
  supplier_balances_reset: number;
  stock_quantities_preserved: boolean;
}

export interface PurchaseItem {
  id: EntityId;
  purchase_id: EntityId;
  batch_id: EntityId;
  quantity: number;
  rate: number;
  total: number;
}

export type PaymentMode = "CASH" | "CARD" | "UPI" | "CREDIT" | "OTHER";
export type CustomerCollectionMode = "CASH" | "CARD" | "UPI" | "BANK" | "OTHER";
export type SaleStatus = "ACTIVE" | "PARTIALLY_RETURNED" | "RETURNED" | "CANCELLED";

export interface Sale {
  id: EntityId;
  invoice_no: string;
  customer_id?: EntityId | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_state_code?: string | null;
  place_of_supply_state_code?: string | null;
  subtotal: number;
  discount: number;
  flat_discount: number;
  grand_total: number;
  payment_mode: PaymentMode;
  cash_tendered: number;
  change_due: number;
  upi_transaction_id?: string | null;
  upi_payment_verified?: boolean;
  gst_enabled?: boolean;
  gst_pricing_mode?: "INCLUSIVE" | "EXCLUSIVE";
  tax_type?: "NONE" | "CGST_SGST" | "IGST";
  taxable_amount?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  total_gst?: number;
  status: SaleStatus;
  payment_reference: string | null;
  notes: string | null;
  cancelled_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface SaleItem {
  id: EntityId;
  sale_id: EntityId;
  batch_id: EntityId;
  quantity: number;
  unit_price: number;
  item_discount: number;
  total_price: number;
}

export interface SaleItemDetail extends SaleItem {
  gst_rate_basis_points?: number;
  taxable_amount?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  total_gst?: number;
  medicine_name: string;
  generic_name: string | null;
  batch_no: string;
  expiry_date: ISODate;
  returned_quantity: number;
}

export interface SaleDetails {
  sale: Sale;
  items: SaleItemDetail[];
  returns: SaleReturnRecord[];
  corrections: SaleCorrectionRecord[];
  void: SaleVoidRecord | null;
}

export interface SaleReturnRecord {
  id: EntityId;
  return_no: string;
  total: number;
  customer_due_credit: number;
  refund_mode: CustomerCollectionMode;
  payment_reference: string | null;
  upi_transaction_id: string | null;
  note: string | null;
  created_at: ISODateTime;
  items: Array<{
    sale_item_id: EntityId;
    medicine_name: string;
    batch_no: string;
    quantity: number;
    refund: number;
    total_gst: number;
  }>;
}

export interface SaleCorrectionRecord {
  id: EntityId;
  before_json: string;
  after_json: string;
  adjustment_debit: number;
  adjustment_credit: number;
  adjustment_mode: CustomerCollectionMode | "ACCOUNT" | null;
  adjustment_reference: string | null;
  note: string | null;
  created_at: ISODateTime;
}

export interface SaleVoidRecord {
  refund: number;
  refund_mode: CustomerCollectionMode | "ACCOUNT";
  payment_reference: string | null;
  upi_transaction_id: string | null;
  note: string | null;
  created_at: ISODateTime;
}

export interface SalesHistoryFilters {
  search_invoice: string;
  from_date: string;
  to_date: string;
  customer_id: EntityId | null;
  payment_mode: PaymentMode | "";
  status: SaleStatus | "";
  limit?: number;
}

export interface SalesHistoryRecord {
  id: EntityId;
  invoice_no: string;
  customer_id: EntityId | null;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal: number;
  discount: number;
  flat_discount: number;
  grand_total: number;
  payment_mode: PaymentMode;
  payment_reference: string | null;
  status: SaleStatus;
  returned_total: number;
  cash_tendered: number;
  change_due: number;
  created_at: ISODateTime;
  item_count: number;
}

export interface SaleReturnInput {
  invoice_no: string;
  items: Array<{ sale_item_id: EntityId; quantity: number }>;
  refund_mode: CustomerCollectionMode;
  payment_reference: string;
  upi_transaction_id: string;
  note: string;
}

export interface SaleVoidInput {
  invoice_no: string;
  refund_mode: CustomerCollectionMode | "ACCOUNT";
  payment_reference: string;
  upi_transaction_id: string;
  note: string;
}

export interface SaleCorrectionInput {
  invoice_no: string;
  customer_id: EntityId | null;
  customer_name: string;
  customer_phone: string;
  payment_mode: PaymentMode;
  cash_tendered: number;
  payment_reference: string;
  upi_transaction_id: string;
  adjustment_mode: CustomerCollectionMode | "ACCOUNT" | "";
  adjustment_reference: string;
  adjustment_upi_transaction_id: string;
  notes: string;
  reason: string;
  items: Array<{
    sale_item_id: EntityId;
    quantity: number;
    unit_price: number;
  }>;
}

export interface RecentSale {
  sale: Sale;
  item_count: number;
}

export interface CheckoutSaleItem {
  medicine_id: EntityId;
  batch_id: EntityId;
  quantity: number;
  unit_price: number;
  item_discount: number;
  gst_rate_override_basis_points: number | null;
}

export interface CheckoutSaleInput {
  customer_id: EntityId | null;
  customer_name: string | null;
  customer_phone: string | null;
  payment_mode: PaymentMode;
  gst_pricing_mode: "INCLUSIVE" | "EXCLUSIVE";
  upi_transaction_id: string | null;
  flat_discount: number;
  cash_tendered: number;
  items: CheckoutSaleItem[];
}

export interface FefoAllocation {
  batch: MedicineBatch;
  quantity: number;
}

export interface MedicineSearchResult {
  medicine: Medicine;
  available_stock: number;
  exact_barcode_match: boolean;
  fefo_batch: MedicineBatch | null;
}

export interface LowStockAlert {
  medicine_id: EntityId;
  name: string;
  generic_name: string | null;
  company: string | null;
  rack_location: string | null;
  min_stock_alert: number;
  available_stock: number;
}

export type ExpiryAlertStatus = "expired" | "expiring";
export type ExpiryHorizonDays = 30 | 60 | 90;

export interface ExpiryAlert {
  batch: MedicineBatch;
  medicine_name: string;
  days_until_expiry: number;
  status: ExpiryAlertStatus;
}

export interface SalesReportSummary {
  total_revenue: number;
  gross_sales: number;
  returned_total: number;
  voided_total: number;
  net_revenue: number;
  gross_profit: number;
  net_gross_profit: number;
  total_invoices: number;
  cash_revenue: number;
  net_cash_revenue: number;
  cash_invoices: number;
  card_upi_revenue: number;
  net_card_upi_revenue: number;
  card_upi_invoices: number;
  other_revenue: number;
  net_other_revenue: number;
  other_invoices: number;
  profit_unavailable_invoices: number;
  net_profit_unavailable_invoices: number;
}

export interface SalesReportRow {
  id: EntityId;
  invoice_no: string;
  customer_name: string | null;
  payment_mode: PaymentMode;
  grand_total: number;
  status: SaleStatus;
  returned_total: number;
  voided_total: number;
  created_at: ISODateTime;
}

export interface SalesReport {
  summary: SalesReportSummary;
  sales: SalesReportRow[];
}

export interface StoreSettings {
  pharmacy_name: string;
  address: string;
  contact_number: string;
  drug_license_number: string;
  receipt_footer_note: string;
  upi_id: string;
  upi_display_name: string;
  gst_enabled: boolean;
  gst_default_rate_basis_points: number | null;
  gst_pricing_mode: "INCLUSIVE" | "EXCLUSIVE";
  gst_pharmacy_state_code: string;
}

export interface Customer {
  id: EntityId;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  state_code: string | null;
  active: boolean;
  credit_total: number;
  amount_paid: number;
  balance_due: number;
  created_at: ISODateTime;
}

export interface CustomerFormValues {
  name: string;
  phone: string;
  address: string;
  notes: string;
  state_code: string;
}

export interface CustomerLedgerEntry {
  id: EntityId;
  customer_id: EntityId;
  entry_type: "CREDIT_SALE" | "COLLECTION" | "SALE_RETURN" | "SALE_VOID" | "SALE_CORRECTION";
  invoice_no: string | null;
  reference: string | null;
  debit: number;
  credit: number;
  payment_mode: PaymentMode | null;
  payment_reference: string | null;
  upi_transaction_id: string | null;
  note: string | null;
  created_at: ISODateTime;
  running_balance: number;
}

export interface CustomerPaymentInput {
  customer_id: EntityId;
  amount: number;
  payment_mode: CustomerCollectionMode;
  payment_reference: string;
  upi_transaction_id: string | null;
  note: string;
}

export interface DatabaseBackupResult {
  path: string;
  photoCount: number;
  ignoredOrphanedPhotoCount: number;
  attachmentCount: number;
  ignoredOrphanedAttachmentCount: number;
}

export interface DatabaseRestoreResult {
  safetyBackupPath: string;
  sourceFormat: "complete" | "legacyDatabaseOnly";
  restoredPhotoCount: number;
  ignoredOrphanedPhotoCount: number;
  restoredAttachmentCount: number;
  ignoredOrphanedAttachmentCount: number;
}

export interface CartItem {
  medicine_id: EntityId;
  batch_id: EntityId;
  medicine_name: string;
  generic_name: string | null;
  batch_no: string;
  expiry_date: ISODate;
  quantity: number;
  unit_price: number;
  item_discount: number;
  available_in_batch: number;
  line_total: number;
  gst_rate_basis_points: number | null;
  gst_rate_override_basis_points: number | null;
}

export interface CartState {
  items: CartItem[];
  customer_name: string;
  customer_phone: string;
  discount: number;
  payment_mode: PaymentMode;
  cash_tendered: number;
}

export type AppSection =
  | "home"
  | "pos"
  | "orders"
  | "inventory"
  | "purchases"
  | "suppliers"
  | "customers"
  | "sales"
  | "expenses"
  | "reports"
  | "settings";

export type AsyncStatus = "idle" | "loading" | "ready" | "error";

export interface AsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: string | null;
}

export interface UiState {
  activeSection: AppSection;
  isSidebarCollapsed: boolean;
  activeDialog: "medicine" | "batch" | "purchase" | "supplier" | null;
  isSaving: boolean;
  notification: {
    kind: "success" | "error" | "warning";
    message: string;
  } | null;
}

export interface PosState {
  searchQuery: string;
  selectedResultIndex: number;
  cart: CartState;
  isCompletingSale: boolean;
}