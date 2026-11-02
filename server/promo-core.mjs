import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomInt, randomUUID } from 'node:crypto';

export class PromoError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, {status, code}); }
}

export function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!/^[+\d\s()\-]+$/.test(raw)) throw new PromoError(400, 'PHONE', 'Укажите российский мобильный номер');
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = '7' + digits.slice(1);
  if (!/^79\d{9}$/.test(digits)) throw new PromoError(400, 'PHONE', 'Укажите мобильный номер в формате +7 9XX XXX-XX-XX');
  return '+' + digits;
}

export function createPromoService({databasePath, secret, prizes, validityDays, now = Date.now, choose = randomInt}) {
  if (!secret || secret.length < 32) throw new Error('PROMO_SECRET must contain at least 32 characters');
  if (!Array.isArray(prizes) || prizes.length !== 6 || !prizes.every(n => Number.isInteger(n) && n > 0 && n <= 100)) throw new Error('PRIZES_JSON must contain six integer percentages');
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) throw new Error('Set VALIDITY_DAYS between 1 and 365');
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS promo_leads (
      id TEXT PRIMARY KEY, phone_hash TEXT NOT NULL UNIQUE, client_hash TEXT NOT NULL,
      name TEXT NOT NULL, phone TEXT NOT NULL, sector INTEGER NOT NULL,
      discount_percent INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
      consent_version TEXT NOT NULL, delivery TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS request_limits (
      identity TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL
    );`);
  const hash = text => createHmac('sha256', secret).update(text).digest('hex');
  const publicResult = row => ({id: row.id, sector: row.sector, discountPercent: row.discount_percent,
    expiresAt: new Date(row.expires_at).toISOString(), delivery: row.delivery});

  function rateLimit(ip) {
    const time = now(), windowStart = Math.floor(time / 3600000) * 3600000;
    const identity = hash('ip:' + ip);
    db.prepare(`INSERT INTO request_limits VALUES (?, ?, 1) ON CONFLICT(identity) DO UPDATE SET
      count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,
      window_start=excluded.window_start`).run(identity, windowStart);
    const row = db.prepare('SELECT count FROM request_limits WHERE identity=?').get(identity);
    db.prepare('DELETE FROM request_limits WHERE window_start < ?').run(time - 7200000);
    if (row.count > 20) throw new PromoError(429, 'RATE_LIMIT', 'Слишком много попыток. Попробуйте позже');
  }

  function claim(input, ip) {
    rateLimit(ip);
    const name = String(input.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80 || /[<>\x00-\x1f]/.test(name)) throw new PromoError(400, 'NAME', 'Укажите имя от 2 до 80 символов');
    if (input.consent !== true) throw new PromoError(400, 'CONSENT', 'Нужно согласие на обработку заявки');
    if (input.website) throw new PromoError(400, 'INVALID', 'Не удалось отправить форму');
    if (!/^[a-zA-Z0-9_-]{32,128}$/.test(String(input.clientToken || ''))) throw new PromoError(400, 'CLIENT', 'Обновите страницу и попробуйте снова');
    const phone = normalizePhone(input.phone), phoneHash = hash('phone:' + phone), clientHash = hash('client:' + input.clientToken);
    const existing = db.prepare('SELECT * FROM promo_leads WHERE phone_hash=?').get(phoneHash);
    if (existing) {
      if (existing.client_hash !== clientHash) throw new PromoError(409, 'ALREADY_PLAYED', 'Этот номер уже участвовал в акции. Уточните бонус у администратора');
      return {...publicResult(existing), repeated: true};
    }
    const time = now(), sector = choose(prizes.length), id = 'ZG-' + randomUUID();
    try {
      db.prepare(`INSERT INTO promo_leads
        (id, phone_hash, client_hash, name, phone, sector, discount_percent, expires_at, created_at, consent_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, phoneHash, clientHash, name, phone, sector, prizes[sector], time + validityDays * 86400000, time, 'wheel-v1');
    } catch (error) {
      if (error.code?.startsWith('ERR_SQLITE') && db.prepare('SELECT id FROM promo_leads WHERE phone_hash=?').get(phoneHash)) return claim(input, ip);
      throw error;
    }
    return {...publicResult(db.prepare('SELECT * FROM promo_leads WHERE id=?').get(id)), repeated: false};
  }

  let dispatching = false;
  async function dispatch(send) {
    if (dispatching) return;
    dispatching = true;
    try {
      for (let count = 0; count < 20; count++) {
        const time = now();
        db.prepare("UPDATE promo_leads SET delivery='failed' WHERE delivery='sending' AND attempts>=8 AND locked_until<=?").run(time);
        db.exec('BEGIN IMMEDIATE');
        let row;
        try {
          row = db.prepare(`SELECT * FROM promo_leads WHERE attempts < 8 AND
            ((delivery='pending' AND next_attempt<=?) OR (delivery='sending' AND locked_until<=?))
            ORDER BY created_at LIMIT 1`).get(time, time);
          if (row) db.prepare("UPDATE promo_leads SET delivery='sending', attempts=attempts+1, locked_until=? WHERE id=?").run(time + 60000, row.id);
          db.exec('COMMIT');
        } catch (error) {db.exec('ROLLBACK'); throw error;}
        if (!row) break;
        try {
          await send({id: row.id, source: 'za-granyu-discount-wheel', name: row.name, phone: row.phone,
            discountPercent: row.discount_percent, expiresAt: new Date(row.expires_at).toISOString(),
            createdAt: new Date(row.created_at).toISOString(), phoneVerified: false,
            note: `Колесо скидок: ${row.discount_percent}%. Номер без SMS-подтверждения — проверить при использовании скидки`});
          db.prepare("UPDATE promo_leads SET delivery='delivered', locked_until=0 WHERE id=?").run(row.id);
        } catch {
          db.prepare("UPDATE promo_leads SET delivery=?, next_attempt=?, locked_until=0 WHERE id=?")
            .run(row.attempts + 1 >= 8 ? 'failed' : 'pending', time + Math.min(3600000, 15000 * 2 ** row.attempts), row.id);
        }
      }
    } finally {dispatching = false;}
  }
  return {claim, dispatch, close: () => db.close()};
}
