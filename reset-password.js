// Сброс пароля, если забыли: node reset-password.js <логин> <новый пароль>
const { run, get, ready } = require('./db');
const { hashPassword } = require('./auth');

(async () => {
    const [username, password] = process.argv.slice(2);
    if (!username || !password || password.length < 8) {
        console.log('Использование: node reset-password.js <логин> <новый пароль, от 8 символов>');
        process.exit(1);
    }
    await ready;
    const u = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (!u) { console.log('Пользователь не найден'); process.exit(1); }
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), u.id]);
    await run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
    console.log('Пароль изменён, все сессии сброшены');
    process.exit(0);
})();
