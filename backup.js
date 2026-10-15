const fs = require('fs');
const path = require('path');
const { run } = require('./db');

const DIR = path.join(__dirname, 'backups');
const KEEP = 14; // сколько дневных копий хранить

// Целостный снимок базы, пока сервер работает (VACUUM INTO)
async function snapshot(file) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    await run('VACUUM INTO ?', [file]);
    return file;
}

async function daily() {
    fs.mkdirSync(DIR, { recursive: true });
    await snapshot(path.join(DIR, `database-${new Date().toISOString().slice(0, 10)}.sqlite`));
    fs.readdirSync(DIR).filter((f) => /^database-.+\.sqlite$/.test(f)).sort().slice(0, -KEEP)
        .forEach((f) => fs.unlinkSync(path.join(DIR, f)));
}

function schedule() {
    const go = () => daily().catch((e) => console.error('Ошибка резервной копии:', e));
    go();
    setInterval(go, 24 * 3600 * 1000).unref();
}

module.exports = { snapshot, schedule };
