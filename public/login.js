const form = document.getElementById('authForm'), err = document.getElementById('err');
let mode = 'login';

fetch('/api/auth/me').then((r) => { if (r.ok) location.replace('/'); });

document.querySelector('.tabs').onclick = (e) => {
    if (!e.target.dataset.mode) return;
    mode = e.target.dataset.mode;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b === e.target));
    document.getElementById('submit').textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
    document.getElementById('inviteRow').hidden = mode === 'login';
    form.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    err.textContent = '';
};

form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
        const r = await fetch(`/api/auth/${mode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        if (r.ok) return location.replace('/');
        err.textContent = (await r.json().catch(() => ({}))).error || 'Не удалось выполнить запрос';
    } catch { err.textContent = 'Нет связи с сервером'; }
};
