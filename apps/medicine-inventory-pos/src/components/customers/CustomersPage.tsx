import {
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  CircleDollarSign,
  LoaderCircle,
  MessageCircle,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  collectCustomerPayment,
  getCustomerLedger,
  getCustomers,
  saveCustomer,
  setCustomerActive,
} from "../../services/customerService";
import { getStoreSettings } from "../../services/settingsService";
import type {
  Customer,
  CustomerFormValues,
  CustomerLedgerEntry,
  CustomerPaymentInput,
  StoreSettings,
} from "../../types";
import { formatMoney } from "../../utils/money";
import { gstStateName } from "../../utils/gstStates";
import { CustomerFormDialog } from "./CustomerFormDialog";
import { CustomerPaymentDialog } from "./CustomerPaymentDialog";
import "./customers.css";

type Notice = { kind: "success" | "error"; message: string } | null;

function getError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatDateTime(value: string): string {
  const date = new Date(value.replace(" ", "T") + (value.endsWith("Z") ? "" : "Z"));
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function getPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function getWhatsAppNumber(phone: string): string | null {
  let digits = getPhoneDigits(phone);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `91${digits}`;
  else if (digits.length === 11 && digits.startsWith("0")) {
    digits = `91${digits.slice(1)}`;
  }
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

interface CustomersPageProps {
  initialCustomerId?: number | null;
  onInitialCustomerConsumed?: () => void;
}

export function CustomersPage({
  initialCustomerId,
  onInitialCustomerConsumed,
}: CustomersPageProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [ledger, setLedger] = useState<CustomerLedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerFromDate, setLedgerFromDate] = useState("");
  const [ledgerToDate, setLedgerToDate] = useState("");
  const [ledgerType, setLedgerType] = useState<CustomerLedgerEntry["entry_type"] | "ALL">("ALL");
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [formCustomer, setFormCustomer] = useState<Customer | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const pendingInitialCustomerId = useRef<number | null>(null);
  const selectedCustomer = customers.find(
    (customer) => customer.id === selectedCustomerId,
  ) ?? null;

  useEffect(() => {
    if (initialCustomerId == null) return;
    pendingInitialCustomerId.current = initialCustomerId;
    setSearchTerm("");
    setIncludeInactive(true);
    setSelectedCustomerId(initialCustomerId);
    onInitialCustomerConsumed?.();
  }, [initialCustomerId, onInitialCustomerConsumed]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    const timeout = window.setTimeout(() => {
      getCustomers(searchTerm, includeInactive)
        .then((result) => {
          if (cancelled) return;
          setCustomers(result);
          const requestedCustomerId = pendingInitialCustomerId.current;
          if (requestedCustomerId !== null) {
            pendingInitialCustomerId.current = null;
            if (result.some((customer) => customer.id === requestedCustomerId)) {
              setSelectedCustomerId(requestedCustomerId);
            } else {
              setSelectedCustomerId(null);
              setLoadError("The selected customer is no longer available. Refresh the customer list and try again.");
            }
            return;
          }
          setSelectedCustomerId((current) =>
            result.some((customer) => customer.id === current)
              ? current
              : result[0]?.id ?? null,
          );
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setLoadError(getError(error, "Customer records could not be loaded."));
          }
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, searchTerm.trim() ? 160 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [includeInactive, searchTerm]);

  useEffect(() => {
    let cancelled = false;
    if (selectedCustomerId === null) {
      setLedger([]);
      setLedgerError(null);
      setLedgerLoading(false);
      return;
    }
    setLedgerLoading(true);
    setLedgerError(null);
    getCustomerLedger(selectedCustomerId)
      .then((result) => {
        if (!cancelled) setLedger(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLedgerError(getError(error, "Customer ledger could not be loaded."));
        }
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCustomerId]);

  useEffect(() => {
    let cancelled = false;
    getStoreSettings()
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleLedger = useMemo(() => {
    const query = ledgerSearch.trim().toLocaleLowerCase();
    return ledger.filter((entry) => {
      const entryDate = entry.created_at.slice(0, 10);
      if (ledgerFromDate && entryDate < ledgerFromDate) return false;
      if (ledgerToDate && entryDate > ledgerToDate) return false;
      if (ledgerType !== "ALL" && entry.entry_type !== ledgerType) return false;
      if (!query) return true;
      return [
        entry.invoice_no ?? "",
        entry.reference ?? "",
        entry.payment_reference ?? "",
        entry.payment_mode ?? "",
        entry.upi_transaction_id ?? "",
        entry.note ?? "",
        entry.entry_type,
      ].join(" ").toLocaleLowerCase().includes(query);
    });
  }, [ledger, ledgerFromDate, ledgerSearch, ledgerToDate, ledgerType]);

  async function refreshCustomerList() {
    const result = await getCustomers(searchTerm, includeInactive);
    setCustomers(result);
    setSelectedCustomerId((current) =>
      result.some((customer) => customer.id === current)
        ? current
        : result[0]?.id ?? null,
    );
  }

  async function handleSaveCustomer(values: CustomerFormValues) {
    setIsSavingCustomer(true);
    setFormError(null);
    setNotice(null);
    try {
      await saveCustomer(values, formCustomer?.id);
      await refreshCustomerList();
      setIsFormOpen(false);
      setFormCustomer(null);
      setNotice({
        kind: "success",
        message: formCustomer ? "Customer details saved." : "Customer added.",
      });
    } catch (error) {
      setFormError(getError(error, "Customer details could not be saved."));
    } finally {
      setIsSavingCustomer(false);
    }
  }

  async function handleStatusChange(customer: Customer) {
    setIsChangingStatus(true);
    setNotice(null);
    try {
      await setCustomerActive(customer.id, !customer.active);
      await refreshCustomerList();
      setNotice({
        kind: "success",
        message: customer.active
          ? "Customer archived. Their ledger and balance were preserved."
          : "Customer restored.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: getError(error, "Customer status could not be changed."),
      });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handlePayment(
    input: Omit<CustomerPaymentInput, "customer_id">,
  ) {
    if (!selectedCustomer) return;
    setIsSavingPayment(true);
    setPaymentError(null);
    setNotice(null);
    try {
      await collectCustomerPayment({
        customer_id: selectedCustomer.id,
        ...input,
      });
      const [resultingCustomers, resultingLedger] = await Promise.all([
        getCustomers(searchTerm, includeInactive),
        getCustomerLedger(selectedCustomer.id),
      ]);
      setCustomers(resultingCustomers);
      setLedger(resultingLedger);
      setIsPaymentOpen(false);
      setNotice({
        kind: "success",
        message: "Customer collection recorded on this device.",
      });
    } catch (error) {
      setPaymentError(getError(error, "Customer collection could not be recorded."));
    } finally {
      setIsSavingPayment(false);
    }
  }

  async function openPaymentReminder(channel: "sms" | "whatsapp") {
    if (!selectedCustomer?.phone) return;
    const phone = selectedCustomer.phone.trim();
    const digits = getPhoneDigits(phone);
    if (digits.length < 7 || digits.length > 15) {
      setNotice({
        kind: "error",
        message: "The saved phone number is not valid for messaging. Update the customer record first.",
      });
      return;
    }
    if (selectedCustomer.balance_due <= 0) {
      setNotice({
        kind: "error",
        message: "There is no outstanding balance to include in a payment reminder.",
      });
      return;
    }
    const pharmacyName = settings?.pharmacy_name.trim() || "our pharmacy";
    const message =
      `Hello ${selectedCustomer.name}, your outstanding balance at ${pharmacyName} is ` +
      `${formatMoney(selectedCustomer.balance_due)}. Please contact us if you have questions.`;
    const number = channel === "whatsapp" ? getWhatsAppNumber(phone) : phone.replace(/[^\d+]/g, "");
    if (!number) {
      setNotice({ kind: "error", message: "The saved phone number could not be prepared for messaging." });
      return;
    }
    const url =
      channel === "whatsapp"
        ? `https://wa.me/${number}?text=${encodeURIComponent(message)}`
        : `sms:${number}?body=${encodeURIComponent(message)}`;
    try {
      await openUrl(url);
      setNotice({
        kind: "success",
        message: `${channel === "sms" ? "SMS" : "WhatsApp"} opened with a payment reminder. Review it before sending.`,
      });
    } catch {
      setNotice({
        kind: "error",
        message: `${channel === "sms" ? "SMS" : "WhatsApp"} could not be opened. Use the saved number: ${phone}`,
      });
    }
  }

  return (
    <section className="workspace-page customer-page" data-testid="page-customers">
      <header className="workspace-page-header">
        <div>
          <div className="page-kicker"><span className="live-dot" /> CUSTOMER RECORDS</div>
          <h1>Customers &amp; credit</h1>
          <p>Keep customer details, invoice balances, and collections together on this device.</p>
        </div>
        <button
          className="button button-primary"
          data-testid="button-add-customer"
          onClick={() => {
            setFormCustomer(null);
            setFormError(null);
            setIsFormOpen(true);
          }}
          type="button"
        >
          <Plus size={16} /> Add customer
        </button>
      </header>

      {notice && (
        <div
          className={`workspace-notice customer-notice customer-notice--${notice.kind}`}
          data-testid={`status-customer-${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      )}

      <div className="customer-toolbar workspace-card">
        <label className="customer-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search customers"
            className="workspace-input"
            data-testid="input-search-customers"
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search name or phone"
            value={searchTerm}
          />
        </label>
        <label className="customer-archived-toggle">
          <input
            checked={includeInactive}
            data-testid="checkbox-show-archived-customers"
            onChange={(event) => setIncludeInactive(event.target.checked)}
            type="checkbox"
          />
          Show archived
        </label>
        <span className="customer-count">
          {customers.length} {customers.length === 1 ? "customer" : "customers"}
        </span>
      </div>

      {loadError && (
        <div className="workspace-error workspace-error--banner" role="alert">
          {loadError}
          <button
            className="button button-secondary"
            onClick={() => {
              setLoadError(null);
              setSearchTerm((value) => `${value} `);
              window.setTimeout(() => setSearchTerm((value) => value.trimEnd()), 0);
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      )}

      <div className="customer-workspace">
        <section className="workspace-card customer-list-card" aria-labelledby="customer-list-title">
          <div className="customer-card-heading">
            <div>
              <h2 id="customer-list-title">Customer list</h2>
              <p>Select a customer to review their ledger.</p>
            </div>
            <UsersRound aria-hidden="true" size={20} />
          </div>
          {isLoading ? (
            <div className="customer-state"><LoaderCircle className="settings-button-spin" size={18} /> Loading customers…</div>
          ) : customers.length === 0 ? (
            <div className="customer-empty">
              <strong>No customer records found</strong>
              <span>{searchTerm ? "Try another name or phone number." : "Add a customer to begin tracking credit and collections."}</span>
            </div>
          ) : (
            <div className="customer-list" role="list">
              {customers.map((customer) => (
                <button
                  aria-current={customer.id === selectedCustomerId ? "true" : undefined}
                  className={`customer-list-item ${customer.id === selectedCustomerId ? "is-selected" : ""}`}
                  data-testid={`customer-row-${customer.id}`}
                  key={customer.id}
                  onClick={() => setSelectedCustomerId(customer.id)}
                  role="listitem"
                  type="button"
                >
                  <span className="customer-avatar">{customer.name.slice(0, 1).toUpperCase()}</span>
                  <span className="customer-list-copy">
                    <strong>{customer.name}</strong>
                    <small>{customer.phone || "No phone saved"}</small>
                  </span>
                  <span className="customer-list-balance">
                    <strong>{formatMoney(customer.balance_due)}</strong>
                    <small>Due</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="workspace-card customer-detail-card" aria-labelledby="customer-detail-title">
          {selectedCustomer ? (
            <>
              <div className="customer-detail-heading">
                <div className="customer-detail-identity">
                  <span className="customer-avatar customer-avatar--large">
                    {selectedCustomer.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <div className="customer-title-line">
                      <h2 id="customer-detail-title">{selectedCustomer.name}</h2>
                      {!selectedCustomer.active && <span className="customer-status-pill">Archived</span>}
                    </div>
                    <p>{selectedCustomer.phone || "No phone"} · {gstStateName(selectedCustomer.state_code)}</p>
                  </div>
                </div>
                <div className="customer-actions">
                  <button
                    className="button button-secondary"
                    data-testid="button-customer-sms-reminder"
                    disabled={
                      !selectedCustomer.phone ||
                      getPhoneDigits(selectedCustomer.phone).length < 7 ||
                      getPhoneDigits(selectedCustomer.phone).length > 15 ||
                      selectedCustomer.balance_due <= 0
                    }
                    onClick={() => void openPaymentReminder("sms")}
                    title={!selectedCustomer.phone ? "Add a phone number to this customer first." : undefined}
                    type="button"
                  >
                    <MessageSquare size={15} /> SMS reminder
                  </button>
                  <button
                    className="button button-secondary"
                    data-testid="button-customer-whatsapp-reminder"
                    disabled={
                      !selectedCustomer.phone ||
                      getWhatsAppNumber(selectedCustomer.phone) === null ||
                      selectedCustomer.balance_due <= 0
                    }
                    onClick={() => void openPaymentReminder("whatsapp")}
                    title={!selectedCustomer.phone ? "Add a phone number to this customer first." : undefined}
                    type="button"
                  >
                    <MessageCircle size={15} /> WhatsApp
                  </button>
                  <button
                    aria-label="Edit customer"
                    className="button button-secondary"
                    data-testid="button-edit-customer"
                    onClick={() => {
                      setFormCustomer(selectedCustomer);
                      setFormError(null);
                      setIsFormOpen(true);
                    }}
                    type="button"
                  >
                    <Pencil size={15} /> Edit
                  </button>
                  <button
                    className="button button-secondary"
                    data-testid="button-toggle-customer-active"
                    disabled={isChangingStatus}
                    onClick={() => void handleStatusChange(selectedCustomer)}
                    type="button"
                  >
                    {selectedCustomer.active ? <Archive size={15} /> : <RotateCcw size={15} />}
                    {selectedCustomer.active ? "Archive" : "Restore"}
                  </button>
                </div>
              </div>

              <div className="customer-balance-grid">
                <div className="customer-balance-metric">
                  <span>Total credit</span>
                  <strong>{formatMoney(selectedCustomer.credit_total)}</strong>
                </div>
                <div className="customer-balance-metric">
                  <span>Collected</span>
                  <strong>{formatMoney(selectedCustomer.amount_paid)}</strong>
                </div>
                <div className="customer-balance-metric customer-balance-metric--due">
                  <span>Balance due</span>
                  <strong>{formatMoney(selectedCustomer.balance_due)}</strong>
                </div>
              </div>

              <div className="customer-ledger-heading">
                <div>
                  <h3>Credit ledger</h3>
                  <p>Credit invoices and recorded collections.</p>
                </div>
                <button
                  className="button button-primary"
                  data-testid="button-record-customer-payment"
                  disabled={selectedCustomer.balance_due <= 0}
                  onClick={() => {
                    setPaymentError(null);
                    setIsPaymentOpen(true);
                  }}
                  type="button"
                >
                  <CircleDollarSign size={16} /> Record collection
                </button>
              </div>

              <div className="customer-ledger-filters" aria-label="Filter customer ledger">
                <input
                  aria-label="Search ledger reference"
                  className="workspace-input"
                  data-testid="input-customer-ledger-search"
                  onChange={(event) => setLedgerSearch(event.target.value)}
                  placeholder="Invoice, payment reference, or note"
                  value={ledgerSearch}
                />
                <label>
                  From
                  <input
                    aria-label="Ledger start date"
                    className="workspace-input"
                    data-testid="input-customer-ledger-from-date"
                    onChange={(event) => setLedgerFromDate(event.target.value)}
                    type="date"
                    value={ledgerFromDate}
                  />
                </label>
                <label>
                  Through
                  <input
                    aria-label="Ledger end date"
                    className="workspace-input"
                    data-testid="input-customer-ledger-to-date"
                    onChange={(event) => setLedgerToDate(event.target.value)}
                    type="date"
                    value={ledgerToDate}
                  />
                </label>
                <select
                  aria-label="Ledger activity type"
                  className="workspace-input"
                  data-testid="select-customer-ledger-type"
                  onChange={(event) => setLedgerType(event.target.value as typeof ledgerType)}
                  value={ledgerType}
                >
                  <option value="ALL">All activity</option>
                  <option value="CREDIT_SALE">Credit sales</option>
                  <option value="COLLECTION">Collections</option>
                  <option value="SALE_RETURN">Sales returns</option>
                  <option value="SALE_VOID">Invoice cancellations</option>
                  <option value="SALE_CORRECTION">Invoice corrections</option>
                </select>
                {(ledgerSearch || ledgerFromDate || ledgerToDate || ledgerType !== "ALL") && (
                  <button
                    className="button button-secondary"
                    data-testid="button-clear-customer-ledger-filters"
                    onClick={() => {
                      setLedgerSearch("");
                      setLedgerFromDate("");
                      setLedgerToDate("");
                      setLedgerType("ALL");
                    }}
                    type="button"
                  >
                    Clear
                  </button>
                )}
              </div>
              {ledgerFromDate && ledgerToDate && ledgerFromDate > ledgerToDate && (
                <p className="workspace-error" role="alert">Start date must be on or before the end date.</p>
              )}
              {ledgerError && <p className="workspace-error" role="alert">{ledgerError}</p>}
              {ledgerLoading ? (
                <div className="customer-state"><LoaderCircle className="settings-button-spin" size={18} /> Loading ledger…</div>
              ) : visibleLedger.length === 0 ? (
                <div className="customer-empty customer-empty--compact">
                  <strong>{ledger.length === 0 ? "No credit activity yet" : "No activity matches these filters"}</strong>
                  <span>
                    {ledger.length === 0
                      ? "Credit invoices and collections for this customer will appear here."
                      : "Adjust or clear the ledger filters to see more entries."}
                  </span>
                </div>
              ) : (
                <div className="customer-ledger-table-wrap">
                  <table className="customer-ledger-table">
                    <thead>
                      <tr>
                        <th scope="col">Activity</th>
                        <th scope="col">Reference</th>
                        <th scope="col">Date</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLedger.map((entry) => (
                        <LedgerRow entry={entry} key={entry.id} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {selectedCustomer.address && (
                <p className="customer-detail-address">{selectedCustomer.address}</p>
              )}
            </>
          ) : (
            <div className="customer-empty customer-empty--detail">
              <UsersRound aria-hidden="true" size={25} />
              <strong id="customer-detail-title">Choose a customer</strong>
              <span>Customer details and credit activity will appear here.</span>
            </div>
          )}
        </section>
      </div>

      {isFormOpen && (
        <CustomerFormDialog
          customer={formCustomer}
          error={formError}
          isSaving={isSavingCustomer}
          onClose={() => {
            if (!isSavingCustomer) {
              setIsFormOpen(false);
              setFormCustomer(null);
            }
          }}
          onSave={(values) => void handleSaveCustomer(values)}
        />
      )}
      {isPaymentOpen && selectedCustomer && (
        <CustomerPaymentDialog
          customer={selectedCustomer}
          error={paymentError}
          isSaving={isSavingPayment}
          onClose={() => {
            if (!isSavingPayment) setIsPaymentOpen(false);
          }}
          onSave={(values) => void handlePayment(values)}
          upiDisplayName={settings?.upi_display_name ?? ""}
          upiId={settings?.upi_id ?? ""}
        />
      )}
    </section>
  );
}

function LedgerRow({ entry }: { entry: CustomerLedgerEntry }) {
  const isDebit = entry.debit > 0;
  const title: Record<CustomerLedgerEntry["entry_type"], string> = {
    CREDIT_SALE: "Credit sale",
    COLLECTION: "Collection",
    SALE_RETURN: "Sales return",
    SALE_VOID: "Invoice cancellation",
    SALE_CORRECTION: "Invoice correction",
  };
  return (
    <tr>
      <td>
        <span className={`customer-ledger-kind ${isDebit ? "is-debit" : "is-credit"}`}>
          {isDebit ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
          {title[entry.entry_type]}
        </span>
      </td>
      <td>
        <span>{entry.reference || entry.invoice_no || entry.payment_mode || "—"}</span>
        {entry.payment_reference && <small className="customer-ledger-reference">{entry.payment_reference}</small>}
        {entry.upi_transaction_id && <small className="customer-ledger-reference">{entry.upi_transaction_id}</small>}
        {entry.note && <small className="customer-ledger-reference">{entry.note}</small>}
      </td>
      <td>{formatDateTime(entry.created_at)}</td>
      <td className={isDebit ? "customer-ledger-amount--debit" : "customer-ledger-amount--credit"}>
        {isDebit ? "+" : "−"}{formatMoney(isDebit ? entry.debit : entry.credit)}
      </td>
      <td><strong>{formatMoney(entry.running_balance)}</strong></td>
    </tr>
  );
}