const crypto = require('crypto');
const express = require('express');
const { run, get } = require('./db');

const TTL = 7 * 24 * 3600 * 1000;           // сессия живёт 7 дней
const INVITE = process.env.INVITE_CODE;      // если задан, регистрация только по коду
const DUMMY = `${'0'.repeat(32)}:${'0'.repeat(128)}`; // выравнивает время ответа для несуществующего логина

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const str = (v) => (typeof v === 'string' ? v : '');
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? no(e) : ok(k))));

async function hashPassword(pw) {
    const salt = crypto.randomBytes(16);
    return `${salt.toString('hex')}:${(await scrypt(pw, salt)).toString('hex')}`;
}
async function checkPassword(pw, stored) {
    const [salt, hash] = stored.split(':');
    return crypto.timingSafeEqual(await scrypt(pw, Buffer.from(salt, 'hex')), Buffer.from(hash, 'hex'));
}

// В базе хранится только хэш токена: утечка базы не даёт войти
async function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    await run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha(token), userId, Date.now() + TTL]);
    res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: TTL });
}
const sidOf = (req) => (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('sid='))?.slice(4);

async function requireAuth(req, res, next) {
    const sid = sidOf(req);
    const row = sid && await get(
        'SELECT u.id, u.username, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [sha(sid)]);
    if (!row || row.expires_at < Date.now()) return res.status(401).json({ error: 'Требуется вход' });
    req.user = { id: row.id, username: row.username, role: row.role };
    next();
}

const requireOwner = (req, res, next) =>
    req.user.role === 'owner' ? next() : res.status(403).json({ error: 'Доступно только владельцу' });

// 5 неудачных входов подряд -> блок на 15 минут (по IP и логину)
const fails = new Map();
const locked = (k) => {
    const f = fails.get(k);
    if (f && f.until <= Date.now()) fails.delete(k);
    return f && f.n >= 5 && f.until > Date.now();
};
const addFail = (k) => { const f = fails.get(k) || { n: 0 }; fails.set(k, { n: f.n + 1, until: Date.now() + 15 * 60e3 }); };

const router = express.Router();

router.post('/register', async (req, res) => {
    const username = str(req.body.username).trim();
    const password = str(req.body.password);
    const rk = `reg|${req.ip}`; // подбор кода приглашения тоже ограничен
    if (locked(rk)) return res.status(429).json({ error: 'Слишком много попыток. Повторите через 15 минут' });
    if (INVITE && req.body.invite !== INVITE) { addFail(rk); return res.status(403).json({ error: 'Неверный код приглашения' }); }
    if (!/^[\p{L}\d_.-]{3,32}$/u.test(username)) return res.status(400).json({ error: 'Логин: 3–32 символа, буквы, цифры, _ . -' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Пароль: от 8 до 128 символов' });
    const first = !(await get('SELECT id FROM users LIMIT 1')); // первый аккаунт становится владельцем
    try {
        const { id } = await run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
            [username, await hashPassword(password), first ? 'owner' : 'staff']);
        await startSession(res, id);
        res.status(201).json({ username });
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT') return res.status(409).json({ error: 'Этот логин уже занят' });
        throw e;
    }
});

router.post('/login', async (req, res) => {
    const username = str(req.body.username).trim();
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (locked(key)) return res.status(429).json({ error: 'Слишком много попыток. Повторите через 15 минут' });
    const user = await get('SELECT id, password_hash FROM users WHERE username = ?', [username]);
    const ok = await checkPassword(str(req.body.password).slice(0, 128), user ? user.password_hash : DUMMY);
    if (!user || !ok) { addFail(key); return res.status(401).json({ error: 'Неверный логин или пароль' }); }
    fails.delete(key);
    await startSession(res, user.id);
    res.json({ username });
});

router.post('/logout', async (req, res) => {
    const sid = sidOf(req);
    if (sid) await run('DELETE FROM sessions WHERE token_hash = ?', [sha(sid)]);
    res.clearCookie('sid');
    res.json({ ok: true });
});

router.post('/password', requireAuth, async (req, res) => {
    const next = str(req.body.new);
    const k = `pw|${req.user.id}`;
    if (next.length < 8 || next.length > 128) return res.status(400).json({ error: 'Новый пароль: от 8 до 128 символов' });
    if (locked(k)) return res.status(429).json({ error: 'Слишком много попыток. Повторите через 15 минут' });
    const u = await get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!(await checkPassword(str(req.body.old).slice(0, 128), u.password_hash))) {
        addFail(k);
        return res.status(403).json({ error: 'Неверный текущий пароль' }); // не 401, иначе фронтенд выкинет на страницу входа
    }
    fails.delete(k);
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), req.user.id]);
    await run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [req.user.id, sha(sidOf(req))]); // остальные устройства выходят
    res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json(req.user));

module.exports = { router, requireAuth, requireOwner, hashPassword, checkPassword };
