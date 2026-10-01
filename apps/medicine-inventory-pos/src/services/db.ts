import Database, { type QueryResult } from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

const DATABASE_URL = "sqlite:pharmacy.db";

export type SqlValue = string | number | boolean | null;

export interface TransactionStatement {
  query: string;
  values?: readonly SqlValue[];
  expectedRowsAffected?: number;
}

export interface TransactionStatementResult {
  rowsAffected: number;
  lastInsertId: number;
}

interface Migration {
  version: number;
  statements: readonly string[];
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        generic_name TEXT,
        company TEXT,
        rack_location TEXT,
        min_stock_alert INTEGER NOT NULL DEFAULT 10 CHECK (min_stock_alert >= 0),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE medicine_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
        batch_no TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        purchase_rate REAL NOT NULL CHECK (purchase_rate >= 0),
        mrp REAL NOT NULL CHECK (mrp >= 0),
        sale_rate REAL NOT NULL CHECK (sale_rate >= 0),
        current_stock INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
        barcode TEXT
      )`,
      `CREATE TABLE suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        balance_due REAL NOT NULL DEFAULT 0 CHECK (balance_due >= 0)
      )`,
      `CREATE TABLE purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT NOT NULL,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        total_amount REAL NOT NULL CHECK (total_amount >= 0),
        purchase_date TEXT NOT NULL
      )`,
      `CREATE TABLE purchase_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
        batch_id INTEGER NOT NULL REFERENCES medicine_batches(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        rate REAL NOT NULL CHECK (rate >= 0),
        total REAL NOT NULL CHECK (total >= 0)
      )`,
      `CREATE TABLE sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT UNIQUE NOT NULL,
        customer_name TEXT,
        customer_phone TEXT,
        subtotal REAL NOT NULL CHECK (subtotal >= 0),
        discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
        grand_total REAL NOT NULL CHECK (grand_total >= 0),
        payment_mode TEXT NOT NULL DEFAULT 'CASH',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        batch_id INTEGER NOT NULL REFERENCES medicine_batches(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price REAL NOT NULL CHECK (unit_price >= 0),
        total_price REAL NOT NULL CHECK (total_price >= 0)
      )`,
      "CREATE INDEX idx_medicines_name ON medicines(name COLLATE NOCASE)",
      "CREATE INDEX idx_medicines_generic_name ON medicines(generic_name COLLATE NOCASE)",
      "CREATE INDEX idx_batches_medicine_expiry ON medicine_batches(medicine_id, expiry_date, id)",
      "CREATE INDEX idx_batches_expiry ON medicine_batches(expiry_date)",
      "CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id)",
      "CREATE INDEX idx_sale_items_sale ON sale_items(sale_id)",
      "CREATE INDEX idx_sale_items_batch ON sale_items(batch_id)",
      "CREATE INDEX idx_batches_barcode ON medicine_batches(barcode) WHERE barcode IS NOT NULL",
    ],
  },
  {
    version: 2,
    statements: [
      "ALTER TABLE sales ADD COLUMN flat_discount REAL NOT NULL DEFAULT 0 CHECK (flat_discount >= 0)",
      "ALTER TABLE sales ADD COLUMN cash_tendered REAL NOT NULL DEFAULT 0 CHECK (cash_tendered >= 0)",
      "ALTER TABLE sales ADD COLUMN change_due REAL NOT NULL DEFAULT 0 CHECK (change_due >= 0)",
      "ALTER TABLE sale_items ADD COLUMN item_discount REAL NOT NULL DEFAULT 0 CHECK (item_discount >= 0)",
      "CREATE INDEX idx_sales_created_at ON sales(created_at DESC, id DESC)",
    ],
  },
  {
    version: 3,
    statements: [
      `CREATE TABLE stock_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE RESTRICT,
        batch_id INTEGER NOT NULL REFERENCES medicine_batches(id) ON DELETE RESTRICT,
        quantity_change INTEGER NOT NULL CHECK (quantity_change != 0),
        reason TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      "CREATE INDEX idx_stock_adjustments_batch ON stock_adjustments(batch_id, created_at DESC)",
    ],
  },
  {
    version: 4,
    statements: [
      `ALTER TABLE sale_items
       ADD COLUMN purchase_rate_at_sale REAL
       CHECK (purchase_rate_at_sale IS NULL OR purchase_rate_at_sale >= 0)`,
      `CREATE TABLE app_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL
      )`,
    ],
  },
];

let databasePromise: Promise<Database> | null = null;

async function executeNativeTransaction(
  statements: readonly TransactionStatement[],
): Promise<TransactionStatementResult[]> {
  if (statements.length === 0) {
    return [];
  }

  return invoke<TransactionStatementResult[]>("execute_sql_transaction", {
    statements: statements.map((statement) => ({
      query: statement.query,
      values: statement.values ?? [],
      expectedRowsAffected: statement.expectedRowsAffected,
    })),
  });
}

async function applyMigrations(database: Database): Promise<void> {
  await database.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  const applied = await database.select<Array<{ version: number }>>(
    "SELECT version FROM schema_migrations ORDER BY version ASC",
  );
  let currentVersion = 0;

  for (const row of applied) {
    if (row.version !== currentVersion + 1) {
      throw new Error(
        `Database migration history is incomplete at version ${currentVersion + 1}.`,
      );
    }
    currentVersion = row.version;
  }

  const latestKnownVersion = migrations.at(-1)?.version ?? 0;
  if (currentVersion > latestKnownVersion) {
    throw new Error(
      `Database version ${currentVersion} is newer than this application supports.`,
    );
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }
    if (migration.version !== currentVersion + 1) {
      throw new Error(
        `No migration is available for database version ${currentVersion + 1}.`,
      );
    }

    await executeNativeTransaction([
      ...migration.statements.map((query) => ({ query })),
      {
        query: "INSERT INTO schema_migrations (version) VALUES ($1)",
        values: [migration.version],
        expectedRowsAffected: 1,
      },
    ]);
    currentVersion = migration.version;
  }
}

async function initializeDatabase(): Promise<Database> {
  const database = await Database.load(DATABASE_URL);

  try {
    await database.execute("PRAGMA foreign_keys = ON");
    await applyMigrations(database);
    return database;
  } catch (error) {
    await database.close().catch(() => false);
    throw new Error("Could not initialize the local pharmacy database.", {
      cause: error,
    });
  }
}

export function getDatabase(): Promise<Database> {
  databasePromise ??= initializeDatabase().catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });

  return databasePromise;
}

export async function selectSql<T>(
  query: string,
  values: readonly SqlValue[] = [],
): Promise<T> {
  const database = await getDatabase();
  return database.select<T>(query, [...values]);
}

export async function executeSql(
  query: string,
  values: readonly SqlValue[] = [],
): Promise<QueryResult> {
  const database = await getDatabase();
  return database.execute(query, [...values]);
}

export async function runInTransaction(
  statements: readonly TransactionStatement[],
): Promise<TransactionStatementResult[]> {
  await getDatabase();
  return executeNativeTransaction(statements);
}

export async function closeDatabase(): Promise<void> {
  const pendingDatabase = databasePromise;
  databasePromise = null;

  if (pendingDatabase) {
    const database = await pendingDatabase;
    await database.close();
  }
}