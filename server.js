const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- РАБОТА С ЗАКАЗАМИ ---

// Получить все заказы (с данными клиента и мастера)
app.get('/api/orders', (req, res) => {
    const query = `
        SELECT orders.id, orders.service_name, orders.price, orders.status, orders.created_at,
               clients.name AS client_name, clients.phone AS client_phone,
               employees.name AS employee_name
        FROM orders
        LEFT JOIN clients ON orders.client_id = clients.id
        LEFT JOIN employees ON orders.employee_id = employees.id
        ORDER BY orders.id DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Создать заказ (с привязкой мастера)
app.post('/api/orders', (req, res) => {
    const { client_name, client_phone, service_name, price, employee_id } = req.body;

    if (!client_name || !client_phone || !service_name || !price) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
    }

    db.run(
        'INSERT INTO clients (name, phone) VALUES (?, ?)',
        [client_name, client_phone],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            const clientId = this.lastID;

            db.run(
                'INSERT INTO orders (client_id, employee_id, service_name, price) VALUES (?, ?, ?, ?)',
                [clientId, employee_id || null, service_name, price],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.status(201).json({ id: this.lastID, message: 'Заказ создан' });
                }
            );
        }
    );
});

// Обновить статус заказа
app.put('/api/orders/:id', (req, res) => {
    const { status } = req.body;
    db.run(
        'UPDATE orders SET status = ? WHERE id = ?',
        [status, req.params.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Статус обновлен' });
        }
    );
});

// Удалить заказ
app.delete('/api/orders/:id', (req, res) => {
    db.run('DELETE FROM orders WHERE id = ?', [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Удалено' });
    });
});

// --- РАБОТА С СОТРУДНИКАМИ ---

// Получить всех сотрудников с их текущими заказами
app.get('/api/employees', (req, res) => {
    const query = `
        SELECT employees.id, employees.name, employees.position,
               COUNT(orders.id) AS total_orders
        FROM employees
        LEFT JOIN orders ON employees.id = orders.employee_id AND orders.status != 'Завершен'
        GROUP BY employees.id
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Добавить сотрудника
app.post('/api/employees', (req, res) => {
    const { name, position } = req.body;
    if (!name || !position) return res.status(400).json({ error: 'Заполните поля' });

    db.run(
        'INSERT INTO employees (name, position) VALUES (?, ?)',
        [name, position],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ id: this.lastID });
        }
    );
});

app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});