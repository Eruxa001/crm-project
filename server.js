const express = require('express');
const path = require('path');
const { run, get, all, ready } = require('./db');
const auth = require('./auth');
const backup = require('./backup');
const fs = require('fs');
const os = require('os');

const PORT = process.env.PORT || 5000;
const STATUSES = ['Новый', 'В работе', 'Готов к выдаче', 'Завершен', 'Отменен'];
const METHODS = ['Наличные', 'Перевод', 'Карта'];
const CLOSED = ['Готов к выдаче', 'Завершен', 'Отменен']; // не считаются нагрузкой мастера

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1); // нужно за nginx/Cloudflare, чтобы видеть настоящий IP
app.use((req, res, next) => {
    res.set({
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
    });
    if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=15552000');
    next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }); // данные клиентов не кэшируются
app.use('/api/auth', auth.router);   // вход и регистрация открыты
app.use('/api', auth.requireAuth);   // всё остальное в /api только после входа

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const fail = (res, code, error) => res.status(code).json({ error });
// "+7 (700) 123-45-67" и "8 700 123 45 67" -> "77001234567"
const normPhone = (v) => {
    const d = String(v || '').replace(/\D/g, '');
    return d.length === 11 && d[0] === '8' ? '7' + d.slice(1) : d;
};

app.get('/api/statuses', (req, res) => res.json(STATUSES));

// --- Заказы ---
app.get('/api/orders', async (req, res) => {
    res.json(await all(`
        SELECT o.id, o.service_name, o.price, (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) AS paid, o.due_date, o.comment, o.status, o.client_id, o.employee_id,
               strftime('%Y-%m-%dT%H:%M:%SZ', o.created_at) AS created_at,
               c.name AS client_name, c.phone AS client_phone,
               e.name AS employee_name
        FROM orders o
        LEFT JOIN clients c ON o.client_id = c.id
        LEFT JOIN employees e ON o.employee_id = e.id
        WHERE o.deleted_at IS NULL
        ORDER BY o.id DESC`));
});

function parseOrder(b) {
    const name = text(b.client_name), phone = normPhone(b.client_phone), service = text(b.service_name);
    const price = Number(b.price);
    const prepaid = b.prepaid === '' || b.prepaid == null ? 0 : Number(b.prepaid);
    const due = text(b.due_date), comment = text(b.comment).slice(0, 500);
    const employeeId = b.employee_id ? Number(b.employee_id) : null;
    let error;
    if (!name || !service) error = 'Укажите клиента и услугу';
    else if (phone.length < 10) error = 'Телефон должен содержать минимум 10 цифр';
    else if (!Number.isFinite(price) || price <= 0) error = 'Стоимость должна быть числом больше нуля';
    else if (!Number.isFinite(prepaid) || prepaid < 0 || prepaid > price) error = 'Предоплата: от 0 до стоимости заказа';
    else if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) error = 'Неверная дата готовности';
    return { error, name, phone, service, price, prepaid, due: due || null, comment: comment || null, employeeId };
}

// Клиент ищется по телефону (без дубликатов); имя обновляется на последнее введённое
async function clientFor(name, phone) {
    const c = await get('SELECT id, name FROM clients WHERE phone = ?', [phone]);
    if (!c) return (await run('INSERT INTO clients (name, phone) VALUES (?, ?)', [name, phone])).id;
    if (c.name !== name) await run('UPDATE clients SET name = ? WHERE id = ?', [name, c.id]);
    return c.id;
}
const employeeMissing = async (id) => id && !(await get('SELECT id FROM employees WHERE id = ?', [id]));

app.post('/api/orders', async (req, res) => {
    const o = parseOrder(req.body);
    if (o.error) return fail(res, 400, o.error);
    if (await employeeMissing(o.employeeId)) return fail(res, 400, 'Выбранный мастер не найден');
    const { id } = await run(
        'INSERT INTO orders (client_id, employee_id, service_name, price, due_date, comment) VALUES (?, ?, ?, ?, ?, ?)',
        [await clientFor(o.name, o.phone), o.employeeId, o.service, o.price, o.due, o.comment]
    );
    if (o.prepaid > 0) { // предоплата при создании = первый платёж
        const method = METHODS.includes(req.body.method) ? req.body.method : METHODS[0];
        await run('INSERT INTO payments (order_id, amount, method, user_id) VALUES (?, ?, ?, ?)', [id, o.prepaid, method, req.user.id]);
    }
    res.status(201).json({ id });
});

// Редактирование заказа целиком (статус и платежи меняются отдельно)
app.patch('/api/orders/:id', async (req, res) => {
    const o = parseOrder(req.body);
    if (o.error) return fail(res, 400, o.error);
    if (!(await get('SELECT id FROM orders WHERE id = ? AND deleted_at IS NULL', [req.params.id]))) return fail(res, 404, 'Заказ не найден');
    if (await employeeMissing(o.employeeId)) return fail(res, 400, 'Выбранный мастер не найден');
    const { s: paid } = await get('SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE order_id = ?', [req.params.id]);
    if (o.price < paid) return fail(res, 400, 'Стоимость не может быть меньше уже оплаченной суммы');
    await run(
        'UPDATE orders SET client_id = ?, employee_id = ?, service_name = ?, price = ?, due_date = ?, comment = ? WHERE id = ?',
        [await clientFor(o.name, o.phone), o.employeeId, o.service, o.price, o.due, o.comment, req.params.id]
    );
    res.json({ ok: true });
});

// --- Платежи ---
app.get('/api/methods', (req, res) => res.json(METHODS));

app.get('/api/orders/:id/payments', async (req, res) => {
    res.json(await all(`
        SELECT p.id, p.amount, p.method, strftime('%Y-%m-%dT%H:%M:%SZ', p.paid_at) AS paid_at, u.username AS who
        FROM payments p LEFT JOIN users u ON u.id = p.user_id
        WHERE p.order_id = ? ORDER BY p.id`, [req.params.id]));
});

app.post('/api/orders/:id/payments', async (req, res) => {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return fail(res, 400, 'Сумма платежа должна быть больше нуля');
    if (!METHODS.includes(req.body.method)) return fail(res, 400, 'Выберите способ оплаты');
    const order = await get('SELECT price FROM orders WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!order) return fail(res, 404, 'Заказ не найден');
    const { s: paid } = await get('SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE order_id = ?', [req.params.id]);
    if (paid + amount > order.price + 0.001) return fail(res, 400, `Платежи не могут превышать стоимость: можно внести не больше ${order.price - paid}`);
    const { id } = await run('INSERT INTO payments (order_id, amount, method, user_id) VALUES (?, ?, ?, ?)',
        [req.params.id, amount, req.body.method, req.user.id]);
    res.status(201).json({ id });
});

// Исправлять ошибки в платежах может только владелец
app.delete('/api/payments/:id', auth.requireOwner, async (req, res) => {
    const { changes } = await run('DELETE FROM payments WHERE id = ?', [req.params.id]);
    if (!changes) return fail(res, 404, 'Платёж не найден');
    res.json({ ok: true });
});

app.put('/api/orders/:id', async (req, res) => {
    if (!STATUSES.includes(req.body.status)) return fail(res, 400, 'Недопустимый статус');
    const { changes } = await run('UPDATE orders SET status = ? WHERE id = ? AND deleted_at IS NULL', [req.body.status, req.params.id]);
    if (!changes) return fail(res, 404, 'Заказ не найден');
    res.json({ ok: true });
});

// «Удаление» заказа = перенос в архив, доступен только владельцу
app.delete('/api/orders/:id', auth.requireOwner, async (req, res) => {
    const { changes } = await run('UPDATE orders SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!changes) return fail(res, 404, 'Заказ не найден');
    res.json({ ok: true });
});

app.get('/api/archive', auth.requireOwner, async (req, res) => {
    res.json(await all(`
        SELECT o.id, o.service_name, o.price, c.name AS client_name,
               strftime('%Y-%m-%dT%H:%M:%SZ', o.deleted_at) AS deleted_at
        FROM orders o LEFT JOIN clients c ON o.client_id = c.id
        WHERE o.deleted_at IS NOT NULL ORDER BY o.deleted_at DESC, o.id DESC`));
});

app.post('/api/orders/:id/restore', auth.requireOwner, async (req, res) => {
    const { changes } = await run('UPDATE orders SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL', [req.params.id]);
    if (!changes) return fail(res, 404, 'Заказ не найден в архиве');
    res.json({ ok: true });
});

// --- Сотрудники ---
app.get('/api/employees', async (req, res) => {
    res.json(await all(`
        SELECT e.id, e.name, e.position, COUNT(o.id) AS active_orders
        FROM employees e
        LEFT JOIN orders o ON o.employee_id = e.id AND o.status NOT IN (${CLOSED.map(() => '?').join(', ')}) AND o.deleted_at IS NULL
        GROUP BY e.id ORDER BY e.id`, CLOSED));
});

app.post('/api/employees', async (req, res) => {
    const name = text(req.body.name);
    const position = text(req.body.position);
    if (!name || !position) return fail(res, 400, 'Укажите имя и должность');
    const { id } = await run('INSERT INTO employees (name, position) VALUES (?, ?)', [name, position]);
    res.status(201).json({ id });
});

app.delete('/api/employees/:id', auth.requireOwner, async (req, res) => {
    const { changes } = await run('DELETE FROM employees WHERE id = ?', [req.params.id]);
    if (!changes) return fail(res, 404, 'Сотрудник не найден');
    res.json({ ok: true }); // заказы остаются, мастер у них сбрасывается (ON DELETE SET NULL)
});

// Свежая копия базы для скачивания (только владелец)
app.get('/api/backup', auth.requireOwner, async (req, res) => {
    const file = await backup.snapshot(path.join(os.tmpdir(), `crm-${Date.now()}.sqlite`));
    res.download(file, `crm-backup-${new Date().toISOString().slice(0, 10)}.sqlite`, () => fs.unlink(file, () => {}));
});

// Единый обработчик ошибок: подробности только в консоль
app.use((err, req, res, next) => {
    console.error(err);
    const code = err.status && err.status < 500 ? err.status : 500;
    fail(res, code, code < 500 ? 'Некорректный запрос' : 'Ошибка сервера');
});

ready.then(() => {
    backup.schedule(); // ежедневная копия в папку backups/
    app.listen(PORT, () => {
        console.log(`Сервер запущен: http://localhost:${PORT}`);
        if (!process.env.INVITE_CODE) console.warn('Внимание: INVITE_CODE не задан, регистрация открыта для всех');
    });
});
