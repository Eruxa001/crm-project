const sqlite3 = require('sqlite3');
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));
db.configure('busyTimeout', 5000); // если файл на миг занят другой программой, ждём до 5 секунд, а не падаем

const run = (sql, p = []) => new Promise((ok, no) =>
    db.run(sql, p, function (e) { e ? no(e) : ok({ id: this.lastID, changes: this.changes }); }));
const get = (sql, p = []) => new Promise((ok, no) => db.get(sql, p, (e, r) => (e ? no(e) : ok(r))));
const all = (sql, p = []) => new Promise((ok, no) => db.all(sql, p, (e, r) => (e ? no(e) : ok(r))));

// Важно: соединение одно, поэтому ручные BEGIN/COMMIT вокруг await небезопасны: запросы разных пользователей
// попадают в одну транзакцию. Составные проверки делаем одним SQL-запросом.

// Таблицы создаются по очереди; сервер стартует после ready
const ready = (async () => {
    await run('PRAGMA foreign_keys = ON');
    await run(`CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL
    )`);
    await run(`CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        position TEXT NOT NULL
    )`);
    await run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        employee_id INTEGER,
        service_name TEXT NOT NULL,
        price REAL NOT NULL,
        status TEXT DEFAULT 'Новый',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
    )`);
    await run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
    await run('CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone)');
    await run('CREATE INDEX IF NOT EXISTS idx_orders_employee ON orders(employee_id)');

    // Миграции: номер версии хранится в PRAGMA user_version. Новое изменение схемы = новая строка в конце списка.
    const migrations = [
        'ALTER TABLE orders ADD COLUMN comment TEXT',
        'ALTER TABLE orders ADD COLUMN due_date TEXT',
        'ALTER TABLE orders ADD COLUMN prepaid REAL NOT NULL DEFAULT 0',
        "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'staff'",
        "UPDATE users SET role = 'owner' WHERE id = (SELECT MIN(id) FROM users)",
        'ALTER TABLE orders ADD COLUMN deleted_at TEXT',
        "CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, amount REAL NOT NULL, method TEXT NOT NULL, paid_at DATETIME DEFAULT CURRENT_TIMESTAMP, user_id INTEGER, FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE)",
        "INSERT INTO payments (order_id, amount, method, paid_at) SELECT id, prepaid, 'Наличные', created_at FROM orders WHERE prepaid > 0",
        'CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id)',
    ];
    const { user_version: v } = await get('PRAGMA user_version');
    for (let i = v; i < migrations.length; i++) {
        await run(migrations[i]);
        await run(`PRAGMA user_version = ${i + 1}`);
    }

    // Индексы по колонкам, которые добавляют миграции (например deleted_at), создаются только после миграций
    await run('CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');
    await run('CREATE INDEX IF NOT EXISTS idx_orders_deleted_at ON orders(deleted_at)');
    await run('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

    const { n } = await get('SELECT COUNT(*) AS n FROM employees');
    if (n === 0) {
        await run("INSERT INTO employees (name, position) VALUES ('Алексей Петров', 'Старший мастер')");
        await run("INSERT INTO employees (name, position) VALUES ('Иван Сергеев', 'Техник-диагност')");
    }
})();

module.exports = { run, get, all, ready, db };
