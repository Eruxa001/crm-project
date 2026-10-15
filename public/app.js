const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${Number(n).toLocaleString('ru-RU')} ₸`;
const fmtPhone = (d = '') => (d.length === 11 ? `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}` : d);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });

let orders = [], team = [], statuses = [], filter = '', timer;

let me = {};
const owner = () => me.role === 'owner';
const READY = 'Готов к выдаче';
const DONE = ['Завершен', 'Отменен'];
const CLOSED = [READY, ...DONE]; // по этим заказам работа мастера уже не идёт

function waLink(o) {
    const msg = o.status === READY
        ? `Здравствуйте, ${o.client_name}! Ваш заказ №${o.id} (${o.service_name}) готов, ждём вас. К оплате: ${money(o.price - o.paid)}.`
        : `Здравствуйте, ${o.client_name}! Пишем по вашему заказу №${o.id} (${o.service_name}).`;
    return `https://wa.me/${o.client_phone}?text=${encodeURIComponent(msg)}`;
}
const today = () => new Date().toLocaleDateString('sv');
const fmtDay = (d) => d.split('-').reverse().slice(0, 2).join('.');
const late = (o) => o.due_date && o.due_date < today() && !CLOSED.includes(o.status);

const ORDER_FIELDS = `
    <label>Клиент<input name="client_name" placeholder="Иван Иванов" required></label>
    <label>Телефон<input name="client_phone" type="tel" placeholder="+7 700 000 00 00" required></label>
    <label>Услуга<input name="service_name" placeholder="Ремонт ноутбука" required></label>
    <label>Стоимость, ₸<input name="price" type="number" min="1" step="any" placeholder="5000" required></label>
    <label>Срок готовности<input name="due_date" type="date"></label>
    <label>Мастер<select name="employee_id"></select></label>
    <label class="wide">Комментарий<input name="comment" maxlength="500" placeholder="Модель, неисправность, комплектация"></label>`;
const PREPAY = `
    <label>Предоплата, ₸<input name="prepaid" type="number" min="0" step="any" placeholder="0"></label>
    <label>Способ оплаты<select name="method"></select></label>`;
$('#orderForm').insertAdjacentHTML('afterbegin', ORDER_FIELDS + PREPAY);
$('#editForm').insertAdjacentHTML('afterbegin', ORDER_FIELDS);

async function api(url, method = 'GET', body) {
    const r = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body && JSON.stringify(body),
    });
    if (r.status === 401) { location.href = '/login.html'; throw new Error('Требуется вход'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
    return data;
}

function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => t.classList.remove('show'), 3500);
}

// Ошибка любого действия показывается в тосте, а список перезагружается
const act = (fn) => async (...a) => {
    try { await fn(...a); } catch (e) { toast(e.message); }
    await load();
};

async function load() {
    try {
        [orders, team] = await Promise.all([api('/api/orders'), api('/api/employees')]);
        renderStats();
        renderToday();
        renderOrders();
        renderClients();
        renderTeam();
    } catch (e) { toast(e.message); }
}

function renderStats() {
    const open = orders.filter((o) => o.status === 'Новый' || o.status === 'В работе').length;
    const revenue = orders.filter((o) => o.status === 'Завершен').reduce((s, o) => s + Number(o.price), 0);
    $('#statTotal').textContent = orders.length;
    $('#statInWork').textContent = open;
    $('#statReady').textContent = orders.filter((o) => o.status === READY).length;
    $('#statDebt').textContent = money(orders.filter((o) => o.status !== 'Отменен').reduce((s, o) => s + Number(o.price) - Number(o.paid), 0));
    $('#statRevenue').textContent = money(revenue);
}

function renderToday() {
    const open = orders.filter((o) => !CLOSED.includes(o.status));
    const groups = [
        ['Просрочены', 'late', open.filter((o) => late(o))],
        ['Срок сегодня', '', open.filter((o) => o.due_date === today())],
        ['Ждут выдачи', 'ready', orders.filter((o) => o.status === READY)],
    ].filter((g) => g[2].length);
    $('#today').hidden = !groups.length;
    $('#today').innerHTML = groups.map(([title, cls, list]) => `
        <div class="${cls}"><h3>${title} · ${list.length}</h3>
            ${list.slice(0, 5).map((o) => `<button data-open="${o.id}">№${o.id} ${esc(o.client_name)} · ${esc(o.service_name)}</button>`).join('')}
            ${list.length > 5 ? `<small>и ещё ${list.length - 5}</small>` : ''}
        </div>`).join('');
}

function renderOrders() {
    const q = $('#q').value.trim().toLowerCase();
    $('#chips').innerHTML = ['', ...statuses].map((s, i) => {
        const n = s ? orders.filter((o) => o.status === s).length : orders.length;
        return `<button data-f="${esc(s)}" data-s="${i - 1}" class="${s === filter ? 'on' : ''}">${s || 'Все'} <b>${n}</b></button>`;
    }).join('');

    const list = orders.filter((o) => (!filter || o.status === filter) &&
        [o.client_name, o.client_phone, fmtPhone(o.client_phone), o.service_name, o.comment].join(' ').toLowerCase().includes(q));
    $('#empty').hidden = list.length > 0;
    $('#rows').innerHTML = list.map((o) => `
        <tr data-s="${statuses.indexOf(o.status)}">
            <td>№${o.id}<small>${fmtDate(o.created_at)}</small></td>
            <td>${esc(o.client_name)}<small>${esc(fmtPhone(o.client_phone))}</small></td>
            <td>${esc(o.service_name)}<small>${esc(o.employee_name || 'Мастер не назначен')}${o.due_date ? ` · <span class="${late(o) ? 'late' : ''}">до ${fmtDay(o.due_date)}</span>` : ''}</small>${o.comment ? `<small>${esc(o.comment)}</small>` : ''}</td>
            <td class="num">${money(o.price)}${o.status === 'Отменен' ? '' : `<small class="${o.paid >= o.price ? 'ok' : ''}">${o.paid >= o.price ? 'оплачено' : o.paid > 0 ? `остаток ${money(o.price - o.paid)}` : 'не оплачено'}</small>`}</td>
            <td><select data-id="${o.id}" aria-label="Статус заказа ${o.id}">${statuses.map((s) => `<option${s === o.status ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></td>
            <td><button class="x edit" data-edit="${o.id}">Изменить</button>${DONE.includes(o.status) ? '' : `<a class="x edit" href="${esc(waLink(o))}" target="_blank" rel="noopener">Написать</a>`}${o.status === READY ? `<button class="x edit" data-done="${o.id}">Выдан</button>` : ''}${owner() ? `<button class="x" data-del="${o.id}">В архив</button>` : ''}</td>
        </tr>`).join('');
}

function renderClients() {
    const map = new Map();
    for (const o of orders) {
        const c = map.get(o.client_id) || { name: o.client_name, phone: o.client_phone, n: 0, paid: 0, last: o.created_at };
        c.n++;
        c.paid += Number(o.paid);
        if (o.created_at > c.last) c.last = o.created_at;
        map.set(o.client_id, c);
    }
    const list = [...map.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
    $('#noClients').hidden = list.length > 0;
    $('#clientRows').innerHTML = list.map((c) => `
        <tr>
            <td><button class="x edit" data-phone="${esc(c.phone)}">${esc(c.name)}</button><small>${esc(fmtPhone(c.phone))}</small></td>
            <td class="num">${c.n}</td>
            <td class="num">${money(c.paid)}</td>
            <td>${fmtDate(c.last)}</td>
        </tr>`).join('');
}

function openEdit(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    const f = $('#editForm');
    f.reset();
    f.dataset.id = id;
    Object.entries({
        client_name: o.client_name, client_phone: fmtPhone(o.client_phone), service_name: o.service_name,
        price: o.price, due_date: o.due_date || '', employee_id: o.employee_id || '', comment: o.comment || '',
    }).forEach(([k, v]) => { f[k].value = v; });
    $('#editTitle').textContent = `Заказ №${id}`;
    $('#editErr').textContent = '';
    $('#payForm').dataset.id = id;
    $('#payErr').textContent = '';
    loadPayments(id);
    $('#editDlg').showModal();
}

function renderTeam() {
    $('#team').innerHTML = team.length ? team.map((e) => `
        <li>
            <div><b>${esc(e.name)}</b><small>${esc(e.position)}</small></div>
            <span class="load"><i style="width:${Math.min(e.active_orders, 5) * 20}%"></i></span>
            <em>Открыто: ${e.active_orders}</em>
            ${owner() ? `<button class="x" data-del="${e.id}">Удалить</button>` : ''}
        </li>`).join('') : '<li class="empty">Сотрудников нет. Добавьте первого в форме выше.</li>';

    const opts = '<option value="">Не назначен</option>' + team.map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.position)})</option>`).join('');
    document.querySelectorAll('[name=employee_id]').forEach((sel) => { const cur = sel.value; sel.innerHTML = opts; sel.value = cur; });
}

// --- События ---
function showTab(tab) {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    ['orders', 'clients', 'staff', 'archive'].forEach((t) => { $('#' + t).hidden = t !== tab; });
    if (tab === 'archive') loadArchive();
}
document.querySelector('nav').onclick = (e) => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); };

$('#chips').onclick = (e) => {
    if (e.target.closest('button')) { filter = e.target.closest('button').dataset.f; renderOrders(); }
};
$('#q').oninput = renderOrders;

$('#orderForm').onsubmit = (e) => {
    e.preventDefault();
    const form = e.target;
    act(async () => {
        await api('/api/orders', 'POST', Object.fromEntries(new FormData(form)));
        form.reset();
        toast('Заказ создан');
    })();
};

$('#staffForm').onsubmit = (e) => {
    e.preventDefault();
    const form = e.target;
    act(async () => {
        await api('/api/employees', 'POST', Object.fromEntries(new FormData(form)));
        form.reset();
        toast('Сотрудник добавлен');
    })();
};

$('#rows').onchange = (e) => {
    if (e.target.dataset.id) act(() => api(`/api/orders/${e.target.dataset.id}`, 'PUT', { status: e.target.value }))();
};
$('#rows').onclick = (e) => {
    const { del, edit, done } = e.target.dataset;
    if (edit) openEdit(Number(edit));
    if (done) act(() => api(`/api/orders/${done}`, 'PUT', { status: 'Завершен' }))();
    if (del && confirm(`Отправить заказ №${del} в архив?`)) act(() => api(`/api/orders/${del}`, 'DELETE'))();
};

$('#today').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) openEdit(Number(b.dataset.open));
};

// Клик по клиенту: история его заказов = поиск по его телефону
$('#clientRows').onclick = (e) => {
    const phone = e.target.dataset.phone;
    if (!phone) return;
    filter = '';
    $('#q').value = phone;
    showTab('orders');
    renderOrders();
};

$('#editForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
        await api(`/api/orders/${e.target.dataset.id}`, 'PATCH', Object.fromEntries(new FormData(e.target)));
        $('#editDlg').close();
        toast('Заказ сохранён');
        load();
    } catch (err) { $('#editErr').textContent = err.message; }
};
$('#editCancel').onclick = () => $('#editDlg').close();
$('#team').onclick = (e) => {
    const id = e.target.dataset.del;
    if (id && confirm('Удалить сотрудника? Его заказы останутся без мастера.')) act(() => api(`/api/employees/${id}`, 'DELETE'))();
};

async function loadPayments(id) {
    try {
        const list = await api(`/api/orders/${id}/payments`);
        const o = orders.find((x) => x.id === id);
        const paid = list.reduce((s, p) => s + p.amount, 0);
        $('#paySum').textContent = o ? `Оплачено ${money(paid)} из ${money(o.price)}, остаток ${money(o.price - paid)}` : '';
        $('#payList').innerHTML = list.length ? list.map((p) => `
            <li>${fmtDate(p.paid_at)} · ${esc(p.method)} · <b>${money(p.amount)}</b> · ${esc(p.who || '')}
            ${owner() ? `<button type="button" class="x" data-pdel="${p.id}" aria-label="Удалить платёж">×</button>` : ''}</li>`).join('') : '<li>Платежей пока нет</li>';
    } catch (e) { $('#payErr').textContent = e.message; }
}

$('#payForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = Number(e.target.dataset.id);
    try {
        await api(`/api/orders/${id}/payments`, 'POST', Object.fromEntries(new FormData(e.target)));
        e.target.reset();
        $('#payErr').textContent = '';
        await load();
        await loadPayments(id);
    } catch (err) { $('#payErr').textContent = err.message; }
};

$('#payList').onclick = async (e) => {
    const pid = e.target.dataset.pdel;
    if (!pid || !confirm('Удалить платёж?')) return;
    try {
        await api(`/api/payments/${pid}`, 'DELETE');
        await load();
        await loadPayments(Number($('#payForm').dataset.id));
    } catch (err) { $('#payErr').textContent = err.message; }
};

async function loadArchive() {
    try {
        const list = await api('/api/archive');
        $('#noArchive').hidden = list.length > 0;
        $('#archiveRows').innerHTML = list.map((o) => `
            <tr>
                <td>№${o.id}</td>
                <td>${esc(o.client_name)}</td>
                <td>${esc(o.service_name)}</td>
                <td class="num">${money(o.price)}</td>
                <td>${fmtDate(o.deleted_at)}</td>
                <td><button class="x edit" data-restore="${o.id}">Восстановить</button></td>
            </tr>`).join('');
    } catch (e) { toast(e.message); }
}
$('#archiveRows').onclick = (e) => {
    const id = e.target.dataset.restore;
    if (id) act(async () => { await api(`/api/orders/${id}/restore`, 'POST'); toast('Заказ восстановлен'); await loadArchive(); })();
};

$('#pwBtn').onclick = () => { $('#pwForm').reset(); $('#pwErr').textContent = ''; $('#pwDlg').showModal(); };
$('#pwCancel').onclick = () => $('#pwDlg').close();
$('#pwForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
        await api('/api/auth/password', 'POST', Object.fromEntries(new FormData(e.target)));
        $('#pwDlg').close();
        toast('Пароль изменён');
    } catch (err) { $('#pwErr').textContent = err.message; }
};

$('#logout').onclick = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
};

(async () => {
    try { me = await api('/api/auth/me'); } catch { return; }
    $('#me').textContent = me.username + (owner() ? ' · владелец' : '');
    document.querySelectorAll('.ow').forEach((el) => { el.hidden = !owner(); });
    try { statuses = await api('/api/statuses'); } catch (e) { toast(e.message); }
    try {
        const methods = await api('/api/methods');
        document.querySelectorAll('[name=method]').forEach((sel) => { sel.innerHTML = methods.map((m) => `<option>${esc(m)}</option>`).join(''); });
    } catch (e) { toast(e.message); }
    load();
})();
