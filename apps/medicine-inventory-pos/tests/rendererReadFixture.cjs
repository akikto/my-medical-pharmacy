const { DatabaseSync } = require("node:sqlite");

const state = {
  database: null,
  queryCount: 0,
  invocations: [],
};

const schema = `
  CREATE TABLE medicines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    generic_name TEXT,
    company TEXT,
    rack_location TEXT,
    min_stock_alert INTEGER NOT NULL DEFAULT 10 CHECK (min_stock_alert >= 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE medicine_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    batch_no TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    purchase_rate REAL NOT NULL CHECK (purchase_rate >= 0),
    mrp REAL NOT NULL CHECK (mrp >= 0),
    sale_rate REAL NOT NULL CHECK (sale_rate >= 0),
    current_stock INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    barcode TEXT
  );
  CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    balance_due REAL NOT NULL DEFAULT 0 CHECK (balance_due >= 0)
  );
  CREATE TABLE purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    purchase_date TEXT NOT NULL
  );
  CREATE TABLE purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
    batch_id INTEGER NOT NULL REFERENCES medicine_batches(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    rate REAL NOT NULL CHECK (rate >= 0),
    total REAL NOT NULL CHECK (total >= 0)
  );
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT UNIQUE NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    subtotal REAL NOT NULL CHECK (subtotal >= 0),
    discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
    grand_total REAL NOT NULL CHECK (grand_total >= 0),
    payment_mode TEXT NOT NULL DEFAULT 'CASH',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    flat_discount REAL NOT NULL DEFAULT 0 CHECK (flat_discount >= 0),
    cash_tendered REAL NOT NULL DEFAULT 0 CHECK (cash_tendered >= 0),
    change_due REAL NOT NULL DEFAULT 0 CHECK (change_due >= 0)
  );
  CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
    batch_id INTEGER NOT NULL REFERENCES medicine_batches(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    total_price REAL NOT NULL CHECK (total_price >= 0),
    item_discount REAL NOT NULL DEFAULT 0 CHECK (item_discount >= 0),
    purchase_rate_at_sale REAL
      CHECK (purchase_rate_at_sale IS NULL OR purchase_rate_at_sale >= 0)
  );
  CREATE TABLE app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
  );
`;

function invokeRead(command, args = {}) {
  if (!state.database) {
    throw new Error("The isolated read fixture is not available.");
  }

  const database = state.database;
  const all = (query, ...values) => database.prepare(query).all(...values).map((row) => ({ ...row }));
  const one = (query, ...values) => {
    const row = database.prepare(query).get(...values);
    return row ? { ...row } : null;
  };
  state.queryCount += 1;
  state.invocations.push({ command, args });

  switch (command) {
    case "get_inventory_medicines":
      return all(
        `SELECT m.id, m.name, m.generic_name, m.company, m.rack_location,
                m.min_stock_alert, m.created_at,
                COALESCE(SUM(CASE WHEN b.expiry_date >= date('now', 'localtime')
                  THEN b.current_stock ELSE 0 END), 0) AS available_stock,
                COALESCE(SUM(CASE WHEN b.expiry_date < date('now', 'localtime')
                  THEN b.current_stock ELSE 0 END), 0) AS expired_stock,
                COALESCE(SUM(CASE WHEN b.expiry_date >= date('now', 'localtime')
                  AND b.expiry_date <= date('now', 'localtime', '+30 days')
                  THEN b.current_stock ELSE 0 END), 0) AS near_expiry_stock,
                COUNT(b.id) AS batch_count
         FROM medicines AS m
         LEFT JOIN medicine_batches AS b ON b.medicine_id = m.id
         WHERE ?1 IS NULL OR m.name LIKE ?1 ESCAPE '!'
            OR COALESCE(m.generic_name, '') LIKE ?1 ESCAPE '!'
            OR COALESCE(m.company, '') LIKE ?1 ESCAPE '!'
            OR COALESCE(m.rack_location, '') LIKE ?1 ESCAPE '!'
         GROUP BY m.id
         ORDER BY m.name COLLATE NOCASE ASC, m.id ASC`,
        args.searchTerm
          ? `%${args.searchTerm.replace(/[!%_]/g, "!$&")}%`
          : null,
      );
    case "get_medicine_batches":
      return all(
        `SELECT id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
                sale_rate, current_stock, barcode
         FROM medicine_batches WHERE medicine_id = ?1
         ORDER BY expiry_date ASC, batch_no COLLATE NOCASE ASC, id ASC`,
        args.medicineId,
      );
    case "search_medicines": {
      const pattern = `%${args.searchTerm.replace(/[!%_]/g, "!$&")}%`;
      return all(
        `SELECT m.id, m.name, m.generic_name, m.company, m.rack_location,
                m.min_stock_alert, m.created_at,
                COALESCE((SELECT SUM(stock_batch.current_stock)
                  FROM medicine_batches AS stock_batch
                  WHERE stock_batch.medicine_id = m.id
                    AND stock_batch.expiry_date >= date('now', 'localtime')), 0) AS available_stock,
                b.id AS batch_id, b.medicine_id AS batch_medicine_id, b.batch_no,
                b.expiry_date, b.purchase_rate, b.mrp, b.sale_rate,
                b.current_stock, b.barcode
         FROM medicines AS m
         LEFT JOIN medicine_batches AS b ON b.id = (
           SELECT candidate.id FROM medicine_batches AS candidate
           WHERE candidate.medicine_id = m.id AND candidate.current_stock > 0
             AND candidate.expiry_date >= date('now', 'localtime')
           ORDER BY CASE WHEN candidate.barcode = ?2 THEN 0 ELSE 1 END,
             candidate.expiry_date ASC, candidate.id ASC LIMIT 1
         )
         WHERE m.name LIKE ?1 ESCAPE '!'
            OR COALESCE(m.generic_name, '') LIKE ?1 ESCAPE '!'
            OR COALESCE(m.company, '') LIKE ?1 ESCAPE '!'
            OR EXISTS (SELECT 1 FROM medicine_batches AS barcode_batch
              WHERE barcode_batch.medicine_id = m.id
                AND (barcode_batch.barcode = ?2 OR barcode_batch.barcode LIKE ?1 ESCAPE '!'))
         ORDER BY CASE WHEN EXISTS (SELECT 1 FROM medicine_batches AS exact_barcode
              WHERE exact_barcode.medicine_id = m.id AND exact_barcode.barcode = ?2)
              THEN 0 ELSE 1 END,
           m.name COLLATE NOCASE ASC, m.id ASC LIMIT ?3`,
        pattern,
        args.searchTerm,
        args.limit,
      );
    }
    case "get_fefo_batch":
      return one(
        `SELECT id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
                sale_rate, current_stock, barcode
         FROM medicine_batches WHERE medicine_id = ?1 AND current_stock > 0
           AND expiry_date >= date('now', 'localtime')
         ORDER BY expiry_date ASC, id ASC LIMIT 1`,
        args.medicineId,
      );
    case "get_sellable_batches":
      return all(
        `SELECT id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
                sale_rate, current_stock, barcode
         FROM medicine_batches WHERE medicine_id = ?1 AND current_stock > 0
           AND expiry_date >= date('now', 'localtime')
         ORDER BY expiry_date ASC, id ASC`,
        args.medicineId,
      );
    case "get_low_stock_alerts":
      return all(
        `SELECT m.id AS medicine_id, m.name, m.generic_name, m.company,
                m.rack_location, m.min_stock_alert,
                COALESCE(SUM(b.current_stock), 0) AS available_stock
         FROM medicines AS m LEFT JOIN medicine_batches AS b
           ON b.medicine_id = m.id AND b.expiry_date >= date('now', 'localtime')
         GROUP BY m.id
         HAVING COALESCE(SUM(b.current_stock), 0) <= m.min_stock_alert
         ORDER BY available_stock ASC, m.name COLLATE NOCASE ASC`,
      );
    case "get_expiry_alerts": {
      const modifier = `+${args.horizonDays} days`;
      return all(
        `SELECT b.id, b.medicine_id, b.batch_no, b.expiry_date, b.purchase_rate,
                b.mrp, b.sale_rate, b.current_stock, b.barcode,
                m.name AS medicine_name,
                CAST(julianday(b.expiry_date) - julianday(date('now', 'localtime')) AS INTEGER)
                  AS days_until_expiry,
                CASE WHEN b.expiry_date < date('now', 'localtime')
                  THEN 'expired' ELSE 'expiring' END AS status
         FROM medicine_batches AS b
         INNER JOIN medicines AS m ON m.id = b.medicine_id
         WHERE b.current_stock > 0
           AND b.expiry_date <= date('now', 'localtime', ?1)
         ORDER BY b.expiry_date ASC, m.name COLLATE NOCASE ASC, b.id ASC`,
        modifier,
      );
    }
    case "get_suppliers": {
      const pattern = args.searchTerm
        ? `%${args.searchTerm.replace(/[!%_]/g, "!$&")}%`
        : null;
      return all(
        `SELECT id, name, phone, address, balance_due FROM suppliers
         WHERE ?1 IS NULL OR name LIKE ?1 ESCAPE '!'
           OR COALESCE(phone, '') LIKE ?1 ESCAPE '!'
           OR COALESCE(address, '') LIKE ?1 ESCAPE '!'
         ORDER BY name COLLATE NOCASE ASC, id ASC`,
        pattern,
      );
    }
    case "get_store_settings":
      return all("SELECT setting_key, setting_value FROM app_settings");
    case "get_recent_purchases":
      return all(
        `SELECT p.id, p.invoice_no, p.supplier_id, s.name AS supplier_name,
                p.total_amount, p.purchase_date, COUNT(pi.id) AS item_count,
                COALESCE(SUM(pi.quantity), 0) AS total_units
         FROM purchases AS p LEFT JOIN suppliers AS s ON s.id = p.supplier_id
         LEFT JOIN purchase_items AS pi ON pi.purchase_id = p.id
         GROUP BY p.id ORDER BY p.purchase_date DESC, p.id DESC LIMIT ?1`,
        args.limit,
      );
    case "get_recent_sales":
      return all(
        `SELECT s.id, s.invoice_no, s.customer_name, s.customer_phone,
                s.subtotal, s.discount, s.flat_discount, s.grand_total,
                s.payment_mode, s.cash_tendered, s.change_due, s.created_at,
                COUNT(si.id) AS item_count
         FROM sales AS s LEFT JOIN sale_items AS si ON si.sale_id = s.id
         GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC LIMIT ?1`,
        args.limit,
      );
    case "get_sale_details": {
      const sale = one(
        `SELECT id, invoice_no, customer_name, customer_phone, subtotal, discount,
                flat_discount, grand_total, payment_mode, cash_tendered, change_due, created_at
         FROM sales WHERE invoice_no = ?1 LIMIT 1`,
        args.invoiceNo,
      );
      if (!sale) return null;
      const items = all(
        `SELECT si.id, si.sale_id, si.batch_id, si.quantity, si.unit_price,
                si.item_discount, si.total_price, m.name AS medicine_name,
                m.generic_name, b.batch_no, b.expiry_date
         FROM sale_items AS si
         INNER JOIN medicine_batches AS b ON b.id = si.batch_id
         INNER JOIN medicines AS m ON m.id = b.medicine_id
         WHERE si.sale_id = ?1 ORDER BY si.id ASC`,
        sale.id,
      );
      return { sale, items };
    }
    case "get_sales_report_summary":
      return one(
        `WITH in_range AS (
           SELECT id, grand_total, flat_discount, payment_mode FROM sales
           WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2
         ), profit_by_sale AS (
           SELECT ranged.id, ranged.flat_discount, COUNT(item.id) AS line_count,
             COUNT(item.purchase_rate_at_sale) AS costed_line_count,
             COALESCE(SUM(item.total_price), 0) AS line_revenue,
             COALESCE(SUM(item.purchase_rate_at_sale * item.quantity), 0) AS purchase_cost
           FROM in_range AS ranged LEFT JOIN sale_items AS item ON item.sale_id = ranged.id
           GROUP BY ranged.id
         )
         SELECT COALESCE(SUM(ranged.grand_total), 0) AS total_revenue,
           COALESCE(SUM(CASE WHEN profit.line_count > 0
             AND profit.line_count = profit.costed_line_count
             THEN profit.line_revenue - profit.flat_discount - profit.purchase_cost
             ELSE 0 END), 0) AS gross_profit,
           COUNT(ranged.id) AS total_invoices,
           COALESCE(SUM(CASE WHEN ranged.payment_mode = 'CASH'
             THEN ranged.grand_total ELSE 0 END), 0) AS cash_revenue,
           COALESCE(SUM(CASE WHEN ranged.payment_mode = 'CASH' THEN 1 ELSE 0 END), 0)
             AS cash_invoices,
           COALESCE(SUM(CASE WHEN ranged.payment_mode IN ('UPI', 'CARD')
             THEN ranged.grand_total ELSE 0 END), 0) AS card_upi_revenue,
           COALESCE(SUM(CASE WHEN ranged.payment_mode IN ('UPI', 'CARD') THEN 1 ELSE 0 END), 0)
             AS card_upi_invoices,
           COALESCE(SUM(CASE WHEN ranged.payment_mode IN ('CREDIT', 'OTHER')
             THEN ranged.grand_total ELSE 0 END), 0) AS other_revenue,
           COALESCE(SUM(CASE WHEN ranged.payment_mode IN ('CREDIT', 'OTHER') THEN 1 ELSE 0 END), 0)
             AS other_invoices,
           COALESCE(SUM(CASE WHEN profit.line_count > profit.costed_line_count
             THEN 1 ELSE 0 END), 0) AS profit_unavailable_invoices
         FROM in_range AS ranged
         LEFT JOIN profit_by_sale AS profit ON profit.id = ranged.id`,
        args.startDate,
        args.endDate,
      );
    case "get_sales_report_rows":
      return all(
        `SELECT id, invoice_no, customer_name, payment_mode, grand_total, created_at
         FROM sales WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2
         ORDER BY created_at DESC, id DESC`,
        args.startDate,
        args.endDate,
      );
    case "get_dashboard_inventory_summary":
      return one(
        `WITH stock_by_medicine AS (
           SELECT m.id, m.min_stock_alert,
             COALESCE(SUM(CASE WHEN b.expiry_date >= date('now', 'localtime')
               THEN b.current_stock ELSE 0 END), 0) AS available_stock,
             COALESCE(SUM(CASE WHEN b.expiry_date >= date('now', 'localtime')
               THEN b.current_stock * b.purchase_rate ELSE 0 END), 0) AS stock_value_at_cost
           FROM medicines AS m LEFT JOIN medicine_batches AS b ON b.medicine_id = m.id
           GROUP BY m.id
         )
         SELECT COUNT(*) AS total_medicines,
           COALESCE(SUM(stock_value_at_cost), 0) AS stock_value_at_cost,
           COALESCE(SUM(CASE WHEN available_stock > min_stock_alert THEN 1 ELSE 0 END), 0)
             AS in_stock_medicines,
           COALESCE(SUM(CASE WHEN available_stock > 0
             AND available_stock <= min_stock_alert THEN 1 ELSE 0 END), 0) AS low_stock_medicines,
           COALESCE(SUM(CASE WHEN available_stock = 0 THEN 1 ELSE 0 END), 0)
             AS out_of_stock_medicines,
           (SELECT COUNT(*) FROM suppliers) AS total_suppliers
         FROM stock_by_medicine`,
      );
    case "get_dashboard_purchase_summary":
      return one(
        `SELECT COALESCE(SUM(total_amount), 0) AS total_amount, COUNT(*) AS invoice_count
         FROM purchases WHERE purchase_date = ?1`,
        args.today,
      );
    case "get_top_selling_medicines":
      return all(
        `SELECT m.id AS medicine_id, m.name,
                COALESCE(SUM(si.quantity), 0) AS quantity_sold,
                COALESCE(SUM(si.total_price), 0) AS line_sales_before_invoice_discount
         FROM sales AS s
         INNER JOIN sale_items AS si ON si.sale_id = s.id
         INNER JOIN medicine_batches AS b ON b.id = si.batch_id
         INNER JOIN medicines AS m ON m.id = b.medicine_id
         WHERE date(s.created_at, 'localtime')
           BETWEEN date('now', 'localtime', '-29 days') AND date('now', 'localtime')
         GROUP BY m.id, m.name
         ORDER BY quantity_sold DESC, line_sales_before_invoice_discount DESC,
           m.name COLLATE NOCASE ASC, m.id ASC
         LIMIT 5`,
      );
    default:
      throw new Error(`Unsupported typed native read command: ${command}`);
  }
}

function createFixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(schema);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA query_only = ON");
  state.database = database;
  state.queryCount = 0;
  state.invocations = [];

  function insert(query, values) {
    database.exec("PRAGMA query_only = OFF");
    try {
      return database.prepare(query).run(...values);
    } finally {
      database.exec("PRAGMA query_only = ON");
    }
  }

  function dateAt(dayOffset = 0) {
    const modifier = `${dayOffset >= 0 ? "+" : ""}${dayOffset} days`;
    return database
      .prepare("SELECT date('now', 'localtime', ?) AS value")
      .get(modifier).value;
  }

  function timestampAt(date, time = "12:00:00") {
    return database
      .prepare("SELECT datetime(? || ' ' || ?, 'utc') AS value")
      .get(date, time).value;
  }

  function insertMedicine({
    id,
    name,
    genericName = null,
    company = null,
    rackLocation = null,
    minStockAlert = 10,
  }) {
    return insert(
      `INSERT INTO medicines
         (id, name, generic_name, company, rack_location, min_stock_alert)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, genericName, company, rackLocation, minStockAlert],
    );
  }

  function insertBatch({
    id,
    medicineId,
    batchNo = `B-${id}`,
    expiryOffset = 30,
    expiryDate,
    purchaseRate = 1,
    mrp = 2,
    saleRate = 2,
    currentStock = 0,
    barcode = null,
  }) {
    return insert(
      `INSERT INTO medicine_batches
         (id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
          sale_rate, current_stock, barcode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        medicineId,
        batchNo,
        expiryDate ?? dateAt(expiryOffset),
        purchaseRate,
        mrp,
        saleRate,
        currentStock,
        barcode,
      ],
    );
  }

  function insertSupplier({
    id,
    name,
    phone = null,
    address = null,
    balanceDue = 0,
  }) {
    return insert(
      "INSERT INTO suppliers (id, name, phone, address, balance_due) VALUES (?, ?, ?, ?, ?)",
      [id, name, phone, address, balanceDue],
    );
  }

  function insertPurchase({
    id,
    invoiceNo = `P-${id}`,
    supplierId = null,
    totalAmount = 0,
    purchaseDate = dateAt(),
  }) {
    return insert(
      `INSERT INTO purchases (id, invoice_no, supplier_id, total_amount, purchase_date)
       VALUES (?, ?, ?, ?, ?)`,
      [id, invoiceNo, supplierId, totalAmount, purchaseDate],
    );
  }

  function insertPurchaseItem({
    id,
    purchaseId,
    batchId,
    quantity,
    rate = 1,
    total = quantity * rate,
  }) {
    return insert(
      `INSERT INTO purchase_items (id, purchase_id, batch_id, quantity, rate, total)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, purchaseId, batchId, quantity, rate, total],
    );
  }

  function insertSale({
    id,
    invoiceNo = `S-${id}`,
    customerName = null,
    customerPhone = null,
    subtotal = 0,
    discount = 0,
    flatDiscount = 0,
    grandTotal = subtotal - discount - flatDiscount,
    paymentMode = "CASH",
    cashTendered = 0,
    changeDue = 0,
    createdAt = timestampAt(dateAt()),
  }) {
    return insert(
      `INSERT INTO sales
         (id, invoice_no, customer_name, customer_phone, subtotal, discount,
          grand_total, payment_mode, created_at, flat_discount,
          cash_tendered, change_due)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        invoiceNo,
        customerName,
        customerPhone,
        subtotal,
        discount,
        grandTotal,
        paymentMode,
        createdAt,
        flatDiscount,
        cashTendered,
        changeDue,
      ],
    );
  }

  function insertSaleItem({
    id,
    saleId,
    batchId,
    quantity,
    unitPrice = 1,
    itemDiscount = 0,
    totalPrice = quantity * unitPrice - itemDiscount,
    purchaseRateAtSale = null,
  }) {
    return insert(
      `INSERT INTO sale_items
         (id, sale_id, batch_id, quantity, unit_price, total_price,
          item_discount, purchase_rate_at_sale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        saleId,
        batchId,
        quantity,
        unitPrice,
        totalPrice,
        itemDiscount,
        purchaseRateAtSale,
      ],
    );
  }

  function insertSetting(settingKey, settingValue) {
    return insert(
      "INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)",
      [settingKey, settingValue],
    );
  }

  function close() {
    if (state.database === database) {
      state.database = null;
    }
    database.close();
  }

  return {
    database,
    dateAt,
    timestampAt,
    insertMedicine,
    insertBatch,
    insertSupplier,
    insertPurchase,
    insertPurchaseItem,
    insertSale,
    insertSaleItem,
    insertSetting,
    close,
  };
}

module.exports = { createFixture, invokeRead, state };