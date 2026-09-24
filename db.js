const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON;');

    // 1. Клиенты
    db.run(`
        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT NOT NULL
        )
    `);

    // 2. Сотрудники (Мастера)
    db.run(`
        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            position TEXT NOT NULL
        )
    `, () => {
        // Наполняем тестовыми сотрудниками, если таблица пуста
        db.get('SELECT COUNT(*) AS count FROM employees', (err, row) => {
            if (row && row.count === 0) {
                db.run("INSERT INTO employees (name, position) VALUES ('Алексей Петров', 'Старший мастер')");
                db.run("INSERT INTO employees (name, position) VALUES ('Иван Сергеев', 'Техник-диагност')");
            }
        });
    });

    // 3. Заказы (ссылается на clients и employees)
    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            employee_id INTEGER,
            service_name TEXT NOT NULL,
            price REAL NOT NULL,
            status TEXT DEFAULT 'Новый',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
        )
    `);
});

module.exports = db;