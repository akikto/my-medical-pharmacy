import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock3,
  Layers3,
  LoaderCircle,
  PackageSearch,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createMedicine,
  getExpiryAlerts,
  getInventoryMedicines,
  getMedicineBatches,
  updateBulkMedicineFields,
  updateMedicine,
} from "../../services/inventoryService";
import type {
  BulkMedicineFieldUpdate,
  ExpiryAlert,
  ExpiryAlertStatus,
  ExpiryHorizonDays,
  MedicineBatch,
  MedicineFormValues,
  MedicineInventoryRow,
} from "../../types";
import { formatMoney } from "../../utils/money";
import { BulkMedicineUpdateDialog } from "../inventory/BulkMedicineUpdateDialog";
import { MedicineFormDialog } from "../inventory/MedicineFormDialog";
import "./medicine-views.css";

type Notice = { kind: "success" | "error"; message: string } | null;
type ExpiryStatusFilter = "all" | ExpiryAlertStatus;

const expiryHorizons = [
  { value: 5, label: "5 days" },
  { value: 7, label: "7 days" },
  { value: 10, label: "10 days" },
  { value: 30, label: "1 month (30 days)" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 3650, label: "All upcoming" },
] as const;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatExpiryDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

function medicineFacts(medicine: MedicineInventoryRow): string {
  return [medicine.product_type, medicine.strength, medicine.composition]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" · ");
}

export function MedicineListPage() {
  const [medicines, setMedicines] = useState<MedicineInventoryRow[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [medicineDialog, setMedicineDialog] = useState<MedicineInventoryRow | null | undefined>(undefined);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [selectedRows, setSelectedRows] = useState<Map<number, MedicineInventoryRow>>(() => new Map());
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [expandedMedicineId, setExpandedMedicineId] = useState<number | null>(null);
  const [batchesByMedicine, setBatchesByMedicine] = useState<Map<number, MedicineBatch[]>>(() => new Map());
  const [batchLoadingIds, setBatchLoadingIds] = useState<Set<number>>(() => new Set());
  const [batchErrors, setBatchErrors] = useState<Map<number, string>>(() => new Map());

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(searchDraft.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    void getInventoryMedicines(searchTerm)
      .then((rows) => {
        if (!cancelled) setMedicines(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorText(error, "The medicine list could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchTerm, refreshKey]);

  useEffect(() => {
    setSelectedRows((current) => {
      const next = new Map(current);
      for (const medicine of medicines) {
        if (selectedIds.has(medicine.id)) next.set(medicine.id, medicine);
      }
      return next;
    });
  }, [medicines, selectedIds]);

  const selectedMedicines = useMemo(
    () => Array.from(selectedIds).map((id) => selectedRows.get(id)).filter(
      (medicine): medicine is MedicineInventoryRow => medicine !== undefined,
    ),
    [selectedIds, selectedRows],
  );
  const allVisibleSelected = medicines.length > 0 && medicines.every((medicine) => selectedIds.has(medicine.id));
  const count = medicines.length;

  function openMedicineForm(medicine: MedicineInventoryRow | null) {
    setDialogError(null);
    setMedicineDialog(medicine);
  }

  function toggleSelection(medicine: MedicineInventoryRow, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        if (next.size >= 100 || next.has(medicine.id)) return next;
        next.add(medicine.id);
      } else {
        next.delete(medicine.id);
      }
      return next;
    });
    setSelectedRows((current) => {
      const next = new Map(current);
      if (checked) next.set(medicine.id, medicine);
      else next.delete(medicine.id);
      return next;
    });
  }

  function toggleVisibleSelection(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!checked) {
        medicines.forEach((medicine) => next.delete(medicine.id));
      } else {
        for (const medicine of medicines) {
          if (next.size === 100) break;
          next.add(medicine.id);
        }
      }
      return next;
    });
    setSelectedRows((current) => {
      const next = new Map(current);
      if (!checked) medicines.forEach((medicine) => next.delete(medicine.id));
      else {
        for (const medicine of medicines) {
          if (next.size >= 100) break;
          next.set(medicine.id, medicine);
        }
      }
      return next;
    });
  }

  async function loadBatches(medicineId: number) {
    setBatchLoadingIds((current) => new Set(current).add(medicineId));
    setBatchErrors((current) => {
      const next = new Map(current);
      next.delete(medicineId);
      return next;
    });
    try {
      const batches = await getMedicineBatches(medicineId);
      setBatchesByMedicine((current) => new Map(current).set(medicineId, batches));
    } catch (error) {
      setBatchErrors((current) => new Map(current).set(
        medicineId,
        errorText(error, "Batch details could not be loaded."),
      ));
    } finally {
      setBatchLoadingIds((current) => {
        const next = new Set(current);
        next.delete(medicineId);
        return next;
      });
    }
  }

  function toggleBatches(medicineId: number) {
    if (expandedMedicineId === medicineId) {
      setExpandedMedicineId(null);
      return;
    }
    setExpandedMedicineId(medicineId);
    if (!batchesByMedicine.has(medicineId) && !batchLoadingIds.has(medicineId)) {
      void loadBatches(medicineId);
    }
  }

  async function saveMedicine(values: MedicineFormValues) {
    if (medicineDialog === undefined) return;
    setIsSaving(true);
    setDialogError(null);
    try {
      if (medicineDialog) {
        await updateMedicine(medicineDialog.id, values);
        setNotice({ kind: "success", message: `${medicineDialog.name} was updated.` });
      } else {
        await createMedicine(values);
        setNotice({ kind: "success", message: `${values.name.trim()} was added to the medicine list.` });
      }
      setMedicineDialog(undefined);
      setSelectedIds(new Set());
      setSelectedRows(new Map());
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setDialogError(errorText(error, "The medicine could not be saved."));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveBulkUpdate(updates: BulkMedicineFieldUpdate[]) {
    if (selectedIds.size === 0) return;
    const medicineCount = selectedIds.size;
    setIsBulkSaving(true);
    setBulkError(null);
    try {
      await updateBulkMedicineFields({
        medicineIds: Array.from(selectedIds),
        updates,
      });
      setIsBulkDialogOpen(false);
      setSelectedIds(new Set());
      setSelectedRows(new Map());
      setNotice({
        kind: "success",
        message: `Updated ${updates.length} fields for ${medicineCount} medicines.`,
      });
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setBulkError(errorText(error, "The reorder alert levels could not be updated."));
    } finally {
      setIsBulkSaving(false);
    }
  }

  return (
    <section className="mv-page" aria-labelledby="medicine-list-title">
      <header className="mv-page-header">
        <div>
          <span className="mv-kicker"><Archive size={14} /> MEDICINE MASTER</span>
          <h1 id="medicine-list-title">Medicine list</h1>
          <p>Find a medicine, check its stock facts, and keep its reorder warning current.</p>
        </div>
        <div className="mv-header-actions">
          <button
            className="mv-button mv-button--secondary"
            data-testid="button-refresh-medicines"
            disabled={isLoading}
            onClick={() => setRefreshKey((current) => current + 1)}
            type="button"
          >
            <RefreshCw size={15} className={isLoading ? "mv-spin" : undefined} />
            Refresh
          </button>
          <button
            className="mv-button mv-button--primary"
            data-testid="button-add-medicine"
            onClick={() => openMedicineForm(null)}
            type="button"
          >
            <Plus size={16} /> Add medicine
          </button>
        </div>
      </header>

      {notice && (
        <div className={`mv-notice mv-notice--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.kind === "success" ? <CircleCheck size={16} /> : <AlertCircle size={16} />}
          <span>{notice.message}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice(null)} type="button"><X size={15} /></button>
        </div>
      )}

      <div className="mv-list-toolbar">
        <label className="mv-search">
          <Search size={17} aria-hidden="true" />
          <span className="mv-visually-hidden">Search medicines</span>
          <input
            autoComplete="off"
            data-testid="input-medicine-search"
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search name, generic, manufacturer or barcode"
            type="search"
            value={searchDraft}
          />
          {searchDraft && (
            <button aria-label="Clear medicine search" data-testid="button-clear-medicine-search" onClick={() => setSearchDraft("")} type="button">
              <X size={15} />
            </button>
          )}
        </label>
        <div className="mv-list-summary" aria-live="polite">
          {isLoading && <LoaderCircle size={14} className="mv-spin" />}
          <strong>{count}</strong> {count === 1 ? "medicine" : "medicines"}
          {searchTerm && <span>matching “{searchTerm}”</span>}
        </div>
      </div>

      {loadError && (
        <div className="mv-error-panel" role="alert">
          <AlertCircle size={18} />
          <div><strong>Medicine list unavailable</strong><span>{loadError}</span></div>
          <button className="mv-button mv-button--secondary" data-testid="button-retry-medicines" onClick={() => setRefreshKey((current) => current + 1)} type="button">Try again</button>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="mv-selection-bar" role="region" aria-label="Selected medicine actions">
          <div>
            <span className="mv-selection-mark"><ShieldCheck size={16} /></span>
            <strong>{selectedIds.size} selected</strong>
            <span>Choose which shared fields to change; stock and batches are not changed.</span>
          </div>
          <div className="mv-selection-actions">
            <button
              className="mv-button mv-button--primary mv-button--compact"
              data-testid="button-bulk-medicine-update"
              disabled={selectedMedicines.length !== selectedIds.size}
              onClick={() => {
                setBulkError(null);
                setIsBulkDialogOpen(true);
              }}
              type="button"
            >
              Bulk update
            </button>
            <button
              aria-label="Clear selected medicines"
              className="mv-icon-button"
              data-testid="button-clear-medicine-selection"
              onClick={() => {
                setSelectedIds(new Set());
                setSelectedRows(new Map());
              }}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="mv-table-card">
        <div className="mv-table-scroll">
          <table className="mv-table" data-testid="table-medicine-list">
            <thead>
              <tr>
                <th className="mv-select-column">
                  <input
                    aria-label="Select all visible medicines, up to 100 total"
                    checked={allVisibleSelected}
                    data-testid="checkbox-select-visible-medicines"
                    onChange={(event) => toggleVisibleSelection(event.target.checked)}
                    type="checkbox"
                  />
                </th>
                <th>Medicine</th>
                <th>Product facts</th>
                <th>Barcode</th>
                <th>Rack</th>
                <th className="mv-number-column">Available</th>
                <th className="mv-number-column">Reorder at</th>
                <th className="mv-number-column">Batches</th>
                <th className="mv-actions-column"><span className="mv-visually-hidden">Actions</span></th>
              </tr>
            </thead>
            {isLoading && medicines.length === 0 && !loadError ? (
              <tbody aria-label="Loading medicines">
                {Array.from({ length: 5 }, (_, index) => (
                  <tr className="mv-skeleton-row" key={index}>
                    <td><span /></td><td><span /><span /></td><td><span /></td><td><span /></td>
                    <td><span /></td><td><span /></td><td><span /></td><td><span /></td><td><span /></td>
                  </tr>
                ))}
              </tbody>
            ) : (
              <tbody>
                {medicines.map((medicine) => {
                  const isSelected = selectedIds.has(medicine.id);
                  const isExpanded = expandedMedicineId === medicine.id;
                  const batches = batchesByMedicine.get(medicine.id);
                  const lowStock = medicine.available_stock <= medicine.min_stock_alert;
                  return (
                    <FragmentRows
                      key={medicine.id}
                      medicine={medicine}
                      isSelected={isSelected}
                      isExpanded={isExpanded}
                      batches={batches}
                      isBatchLoading={batchLoadingIds.has(medicine.id)}
                      batchError={batchErrors.get(medicine.id) ?? null}
                      lowStock={lowStock}
                      selectionDisabled={!isSelected && selectedIds.size >= 100}
                      onSelectionChange={toggleSelection}
                      onToggleBatches={toggleBatches}
                      onRetryBatches={() => void loadBatches(medicine.id)}
                      onEdit={() => openMedicineForm(medicine)}
                    />
                  );
                })}
                {!isLoading && !loadError && medicines.length === 0 && (
                  <tr>
                    <td colSpan={9}>
                      <div className="mv-empty-state">
                        <span className="mv-empty-icon"><PackageSearch size={23} /></span>
                        <strong>{searchTerm ? "No medicines match that search" : "Your medicine list is ready for its first entry"}</strong>
                        <span>{searchTerm ? "Try a different name, generic, manufacturer, or barcode." : "Add a medicine record to start keeping stock facts together."}</span>
                        {searchTerm ? (
                          <button className="mv-button mv-button--secondary" onClick={() => setSearchDraft("")} type="button">Clear search</button>
                        ) : (
                          <button className="mv-button mv-button--primary" onClick={() => openMedicineForm(null)} type="button"><Plus size={15} /> Add medicine</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            )}
          </table>
        </div>
        <footer className="mv-table-footer">
          <span><Layers3 size={14} /> Batch facts load only when you open a medicine row.</span>
          <span>{selectedIds.size}/100 selected</span>
        </footer>
      </div>

      {medicineDialog !== undefined && (
        <MedicineFormDialog
          medicine={medicineDialog}
          error={dialogError}
          isSaving={isSaving}
          onClose={() => {
            if (!isSaving) {
              setMedicineDialog(undefined);
              setDialogError(null);
            }
          }}
          onSave={(values) => void saveMedicine(values)}
        />
      )}
      {isBulkDialogOpen && (
        <BulkMedicineUpdateDialog
          medicines={selectedMedicines}
          error={bulkError}
          isSaving={isBulkSaving}
          onClose={() => {
            if (!isBulkSaving) {
              setIsBulkDialogOpen(false);
              setBulkError(null);
            }
          }}
          onSave={(updates) => void saveBulkUpdate(updates)}
        />
      )}
    </section>
  );
}

interface FragmentRowsProps {
  medicine: MedicineInventoryRow;
  isSelected: boolean;
  isExpanded: boolean;
  batches: MedicineBatch[] | undefined;
  isBatchLoading: boolean;
  batchError: string | null;
  lowStock: boolean;
  selectionDisabled: boolean;
  onSelectionChange: (medicine: MedicineInventoryRow, checked: boolean) => void;
  onToggleBatches: (medicineId: number) => void;
  onRetryBatches: () => void;
  onEdit: () => void;
}

function FragmentRows({
  medicine,
  isSelected,
  isExpanded,
  batches,
  isBatchLoading,
  batchError,
  lowStock,
  selectionDisabled,
  onSelectionChange,
  onToggleBatches,
  onRetryBatches,
  onEdit,
}: FragmentRowsProps) {
  return (
    <>
      <tr className={isSelected ? "mv-medicine-row is-selected" : "mv-medicine-row"} data-testid={`row-medicine-${medicine.id}`}>
        <td className="mv-select-column">
          <input
            aria-label={`Select ${medicine.name}`}
            checked={isSelected}
            data-testid={`checkbox-medicine-${medicine.id}`}
            disabled={selectionDisabled}
            onChange={(event) => onSelectionChange(medicine, event.target.checked)}
            type="checkbox"
          />
        </td>
        <td>
          <div className="mv-medicine-cell">
            <strong>{medicine.name}</strong>
            <span>{medicine.generic_name || "Generic not specified"}</span>
            <small>{medicine.company || "Manufacturer not specified"}</small>
          </div>
        </td>
        <td><span className="mv-product-facts">{medicineFacts(medicine) || <i>Not specified</i>}</span></td>
        <td><span className="mv-code">{medicine.barcode || "—"}</span></td>
        <td><span className="mv-rack">{medicine.rack_location || "—"}</span></td>
        <td className="mv-number-cell">
          <strong className={lowStock ? "mv-stock-value is-low" : "mv-stock-value"}>{medicine.available_stock.toLocaleString()}</strong>
          {lowStock && <small className="mv-low-stock-label"><AlertTriangle size={11} /> Low</small>}
        </td>
        <td className="mv-number-cell"><span className="mv-threshold">{medicine.min_stock_alert.toLocaleString()}</span></td>
        <td className="mv-number-cell">
          <button
            className="mv-batch-toggle"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Hide" : "Show"} batches for ${medicine.name}`}
            data-testid={`button-batches-${medicine.id}`}
            onClick={() => onToggleBatches(medicine.id)}
            type="button"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {medicine.batch_count}
          </button>
        </td>
        <td className="mv-actions-column">
          <button className="mv-icon-button mv-edit-button" aria-label={`Edit ${medicine.name}`} data-testid={`button-edit-medicine-${medicine.id}`} onClick={onEdit} type="button">
            <Pencil size={15} />
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="mv-batch-row" data-testid={`row-batches-${medicine.id}`}>
          <td colSpan={9}>
            <div className="mv-batch-panel">
              <div className="mv-batch-heading">
                <div><span>BATCH REGISTER</span><strong>{medicine.name}</strong></div>
                <span>{medicine.batch_count} {medicine.batch_count === 1 ? "record" : "records"}</span>
              </div>
              {isBatchLoading ? (
                <div className="mv-batch-loading" role="status"><span className="mv-shimmer-line" /><span className="mv-shimmer-line" /><span className="mv-shimmer-line" /> Loading batch facts…</div>
              ) : batchError ? (
                <div className="mv-batch-error" role="alert"><AlertCircle size={15} /><span>{batchError}</span><button className="mv-text-button" onClick={onRetryBatches} type="button">Retry</button></div>
              ) : batches?.length ? (
                <div className="mv-batch-scroll">
                  <table className="mv-batch-table">
                    <thead><tr><th>Batch no.</th><th>Expiry</th><th>Purchase</th><th>MRP</th><th>Sale rate</th><th>Stock</th><th>Barcode</th></tr></thead>
                    <tbody>
                      {batches.map((batch) => (
                        <tr key={batch.id} data-testid={`batch-row-${batch.id}`}>
                          <td><strong>{batch.batch_no || "—"}</strong></td>
                          <td>{formatExpiryDate(batch.expiry_date)}</td>
                          <td>{formatMoney(batch.purchase_rate)}</td>
                          <td>{formatMoney(batch.mrp)}</td>
                          <td><strong>{formatMoney(batch.sale_rate)}</strong></td>
                          <td>{batch.current_stock.toLocaleString()}</td>
                          <td><span className="mv-code">{batch.barcode || "—"}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mv-batch-empty" role="status">No batch records are attached to this medicine.</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function ExpiryManagementPage() {
  const [horizon, setHorizon] = useState<number>(30);
  const [statusFilter, setStatusFilter] = useState<ExpiryStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    void getExpiryAlerts(horizon as ExpiryHorizonDays)
      .then((rows) => {
        if (!cancelled) setAlerts(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorText(error, "Expiry alerts could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [horizon, refreshKey]);

  const filteredAlerts = useMemo(() => {
    const term = searchQuery.trim().toLocaleLowerCase();
    return alerts.filter((alert) => {
      if (statusFilter !== "all" && alert.status !== statusFilter) return false;
      if (!term) return true;
      return [alert.medicine_name, alert.batch.batch_no, alert.batch.barcode]
        .some((value) => value?.toLocaleLowerCase().includes(term));
    }).sort((left, right) => {
      if (left.status !== right.status) return left.status === "expired" ? -1 : 1;
      return left.days_until_expiry - right.days_until_expiry ||
        left.medicine_name.localeCompare(right.medicine_name);
    });
  }, [alerts, searchQuery, statusFilter]);

  const expiredCount = alerts.filter((alert) => alert.status === "expired").length;
  const expiringCount = alerts.filter((alert) => alert.status === "expiring").length;
  const totalRiskStock = alerts.reduce((sum, alert) => sum + alert.batch.current_stock, 0);

  return (
    <section className="mv-page mv-expiry-page" aria-labelledby="expiry-management-title">
      <header className="mv-page-header">
        <div>
          <span className="mv-kicker"><Clock3 size={14} /> DATE-SENSITIVE STOCK</span>
          <h1 id="expiry-management-title">Expiry management</h1>
          <p>Expired batches stay visible at every horizon. Review exposure before it reaches the counter.</p>
        </div>
        <button
          className="mv-button mv-button--secondary"
          data-testid="button-refresh-expiry"
          disabled={isLoading}
          onClick={() => setRefreshKey((current) => current + 1)}
          type="button"
        >
          <RefreshCw size={15} className={isLoading ? "mv-spin" : undefined} /> Refresh
        </button>
      </header>

      <div className="mv-expiry-metrics" aria-live="polite">
        <div className="mv-expiry-metric mv-expiry-metric--expired">
          <span className="mv-expiry-metric-icon"><AlertTriangle size={17} /></span>
          <div><span>Expired batches</span><strong>{expiredCount.toLocaleString()}</strong><small>Requires immediate review</small></div>
        </div>
        <div className="mv-expiry-metric mv-expiry-metric--soon">
          <span className="mv-expiry-metric-icon"><Clock3 size={17} /></span>
          <div><span>Expiring in horizon</span><strong>{expiringCount.toLocaleString()}</strong><small>Within {expiryHorizons.find((item) => item.value === horizon)?.label}</small></div>
        </div>
        <div className="mv-expiry-metric mv-expiry-metric--stock">
          <span className="mv-expiry-metric-icon"><Layers3 size={17} /></span>
          <div><span>Units in flagged batches</span><strong>{totalRiskStock.toLocaleString()}</strong><small>Expired and expiring stock</small></div>
        </div>
        <div className="mv-expiry-posture">
          <ShieldCheck size={17} />
          <span>Local records only</span>
          <small>Alerts use this device’s pharmacy data</small>
        </div>
      </div>

      <div className="mv-expiry-toolbar">
        <label className="mv-search mv-expiry-search">
          <Search size={17} aria-hidden="true" />
          <span className="mv-visually-hidden">Search expiry alerts</span>
          <input
            data-testid="input-expiry-search"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search medicine, batch or barcode"
            type="search"
            value={searchQuery}
          />
          {searchQuery && <button aria-label="Clear expiry search" data-testid="button-clear-expiry-search" onClick={() => setSearchQuery("")} type="button"><X size={15} /></button>}
        </label>
        <div className="mv-expiry-controls">
          <label className="mv-select-control">
            <span>Status</span>
            <select data-testid="select-expiry-status" onChange={(event) => setStatusFilter(event.target.value as ExpiryStatusFilter)} value={statusFilter}>
              <option value="all">All statuses</option>
              <option value="expired">Expired</option>
              <option value="expiring">Expiring</option>
            </select>
          </label>
          <label className="mv-select-control">
            <span>Horizon</span>
            <select data-testid="select-expiry-horizon" onChange={(event) => setHorizon(Number(event.target.value))} value={horizon}>
              {expiryHorizons.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {loadError && (
        <div className="mv-error-panel" role="alert">
          <AlertCircle size={18} />
          <div><strong>Expiry alerts unavailable</strong><span>{loadError}</span></div>
          <button className="mv-button mv-button--secondary" data-testid="button-retry-expiry" onClick={() => setRefreshKey((current) => current + 1)} type="button">Try again</button>
        </div>
      )}

      <div className="mv-table-card">
        <div className="mv-expiry-table-topline">
          <div><strong>Batch watchlist</strong><span>{filteredAlerts.length.toLocaleString()} visible of {alerts.length.toLocaleString()} alerts</span></div>
          {isLoading && <span className="mv-loading-label" role="status"><LoaderCircle size={14} className="mv-spin" /> Updating local records</span>}
        </div>
        <div className="mv-table-scroll">
          <table className="mv-table mv-expiry-table" data-testid="table-expiry-alerts">
            <thead>
              <tr><th>Medicine</th><th>Batch</th><th>Barcode</th><th>Expiry date</th><th>Time remaining</th><th className="mv-number-column">Stock</th><th>Status</th></tr>
            </thead>
            {isLoading && alerts.length === 0 && !loadError ? (
              <tbody aria-label="Loading expiry alerts">
                {Array.from({ length: 4 }, (_, index) => <tr className="mv-skeleton-row" key={index}>{Array.from({ length: 7 }, (__, cell) => <td key={cell}><span /></td>)}</tr>)}
              </tbody>
            ) : (
              <tbody>
                {filteredAlerts.map((alert) => (
                  <tr className={alert.status === "expired" ? "mv-expiry-row is-expired" : "mv-expiry-row"} data-testid={`row-expiry-${alert.batch.id}`} key={alert.batch.id}>
                    <td><div className="mv-medicine-cell"><strong>{alert.medicine_name}</strong><small>{alert.batch.current_stock.toLocaleString()} units currently in this batch</small></div></td>
                    <td><strong className="mv-batch-number">{alert.batch.batch_no || "—"}</strong></td>
                    <td><span className="mv-code">{alert.batch.barcode || "—"}</span></td>
                    <td><strong className="mv-date">{formatExpiryDate(alert.batch.expiry_date)}</strong></td>
                    <td>
                      {alert.days_until_expiry < 0 ? (
                        <span className="mv-days mv-days--expired">{Math.abs(alert.days_until_expiry)} {Math.abs(alert.days_until_expiry) === 1 ? "day" : "days"} past expiry</span>
                      ) : alert.days_until_expiry === 0 ? (
                        <span className="mv-days mv-days--today">Expires today</span>
                      ) : (
                        <span className="mv-days mv-days--soon">{alert.days_until_expiry} {alert.days_until_expiry === 1 ? "day" : "days"} remaining</span>
                      )}
                    </td>
                    <td className="mv-number-cell"><strong className="mv-stock-value">{alert.batch.current_stock.toLocaleString()}</strong></td>
                    <td><span className={alert.status === "expired" ? "mv-status mv-status--expired" : "mv-status mv-status--expiring"}>{alert.status === "expired" ? "Expired" : "Expiring"}</span></td>
                  </tr>
                ))}
                {!isLoading && !loadError && filteredAlerts.length === 0 && (
                  <tr><td colSpan={7}>
                    <div className="mv-empty-state mv-expiry-empty">
                      <span className="mv-empty-icon">{searchQuery || statusFilter !== "all" ? <Search size={22} /> : <CircleCheck size={22} />}</span>
                      <strong>
                        {alerts.length === 0
                          ? "No batches need attention in this horizon"
                          : "No alerts match these filters"}
                      </strong>
                      <span>
                        {alerts.length === 0
                          ? `No expired or expiring batch records were returned for the ${expiryHorizons.find((item) => item.value === horizon)?.label} view.`
                          : "Adjust the status or search terms to see other flagged batches."}
                      </span>
                      {(searchQuery || statusFilter !== "all") && (
                        <button className="mv-button mv-button--secondary" data-testid="button-reset-expiry-filters" onClick={() => { setSearchQuery(""); setStatusFilter("all"); }} type="button">Reset filters</button>
                      )}
                    </div>
                  </td></tr>
                )}
              </tbody>
            )}
          </table>
        </div>
        <footer className="mv-table-footer">
          <span><AlertTriangle size={14} /> Expired batch records remain in view when the horizon changes.</span>
          <span>{totalRiskStock.toLocaleString()} flagged units</span>
        </footer>
      </div>
    </section>
  );
}