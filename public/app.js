document.addEventListener('DOMContentLoaded', () => {
    const orderForm = document.getElementById('orderForm');
    const ordersTableBody = document.getElementById('ordersTableBody');
    const employeeSelect = document.getElementById('employeeSelect');
    const searchInput = document.getElementById('searchInput');

    let allOrders = [];

    // 1. Подсчет и обновление дашборда (вынесено в отдельную функцию)
    function updateDashboard(orders) {
        const total = orders.length;
        const inWork = orders.filter(o => o.status === 'В работе' || o.status === 'Новый').length;
        const revenue = orders
            .filter(o => o.status === 'Завершен')
            .reduce((sum, o) => sum + Number(o.price), 0);

        document.getElementById('statTotal').textContent = total;
        document.getElementById('statInWork').textContent = inWork;
        document.getElementById('statRevenue').textContent = `${revenue.toLocaleString('ru-RU')} ₽`;
    }

    // 2. Загрузка списка мастеров в dropdown формы
    async function loadEmployeeOptions() {
        try {
            const res = await fetch('/api/employees');
            const employees = await res.json();
            employeeSelect.innerHTML = '<option value="">-- Не назначен --</option>';
            employees.forEach(emp => {
                employeeSelect.innerHTML += `<option value="${emp.id}">${emp.name} (${emp.position})</option>`;
            });
        } catch (e) {
            console.error('Ошибка загрузки сотрудников:', e);
        }
    }

    // 3. Загрузка всех заказов
    async function loadOrders() {
        try {
            const res = await fetch('/api/orders');
            allOrders = await res.json();
            updateDashboard(allOrders); // Обновляем метрики
            renderOrders(allOrders);    // Отрисовываем таблицу
        } catch (e) {
            console.error('Ошибка загрузки заказов:', e);
        }
    }

    // 4. Отрисовка таблицы заказов
    function renderOrders(orders) {
        ordersTableBody.innerHTML = '';
        
        if (orders.length === 0) {
            ordersTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Заказов нет</td></tr>';
            return;
        }

        orders.forEach(order => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${order.id}</td>
                <td>${order.client_name}</td>
                <td>${order.client_phone}</td>
                <td>${order.service_name}</td>
                <td><strong>${order.employee_name || 'Не назначен'}</strong></td>
                <td>${order.price} ₽</td>
                <td>
                    <select class="status-select" data-id="${order.id}">
                        <option value="Новый" ${order.status === 'Новый' ? 'selected' : ''}>Новый</option>
                        <option value="В работе" ${order.status === 'В работе' ? 'selected' : ''}>В работе</option>
                        <option value="Завершен" ${order.status === 'Завершен' ? 'selected' : ''}>Завершен</option>
                    </select>
                </td>
                <td><button class="btn-delete" data-id="${order.id}">Удалить</button></td>
            `;
            ordersTableBody.appendChild(row);
        });
    }

    // 5. Создание заказа
    orderForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newOrder = {
            client_name: document.getElementById('clientName').value,
            client_phone: document.getElementById('clientPhone').value,
            service_name: document.getElementById('serviceName').value,
            price: Number(document.getElementById('price').value),
            employee_id: document.getElementById('employeeSelect').value || null
        };

        const res = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newOrder)
        });

        if (res.ok) {
            orderForm.reset();
            loadOrders();
        }
    });

    // 6. Изменение статуса заказа (с пересчетом дашборда)
    ordersTableBody.addEventListener('change', async (e) => {
        if (e.target.classList.contains('status-select')) {
            const res = await fetch(`/api/orders/${e.target.dataset.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: e.target.value })
            });

            if (res.ok) {
                loadOrders(); // Перезагружаем данные для пересчета выручки и карточек
            }
        }
    });

    // 7. Удаление заказа
    ordersTableBody.addEventListener('click', async (e) => {
        if (e.target.classList.contains('btn-delete') && confirm('Удалить заказ?')) {
            const res = await fetch(`/api/orders/${e.target.dataset.id}`, { method: 'DELETE' });
            if (res.ok) {
                loadOrders();
            }
        }
    });

    // 8. Поиск по имени клиента
    searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        renderOrders(allOrders.filter(o => o.client_name.toLowerCase().includes(q)));
    });

    // Первоначальная инициализация
    loadEmployeeOptions();
    loadOrders();
});