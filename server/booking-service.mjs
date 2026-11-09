import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {normalizePhone, PromoError} from './promo-core.mjs';
import {BookNowError} from './booknow-client.mjs';

const fail = (status, code, message) => { throw new PromoError(status, code, message); };
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');

// Conversion uses the slot's IANA timezone, including offset changes.
export function slotToUtc(date, time, timezone) {
  const wall = Date.parse(date + 'T' + time + ':00Z');
  const formatter = new Intl.DateTimeFormat('en-GB', {timeZone: timezone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
  let instant = wall;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const represented = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    instant += wall - represented;
  }
  return new Date(instant).toISOString().replace('.000Z', 'Z');
}

export function createBookingService({client, promo, databasePath, secret, now = Date.now}) {
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS site_bookings (
      request_id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, fingerprint TEXT NOT NULL,
      promo_id TEXT, state TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS site_booking_active ON site_bookings(fingerprint) WHERE state!='rejected';
    CREATE UNIQUE INDEX IF NOT EXISTS site_booking_promo ON site_bookings(promo_id) WHERE state!='rejected';`);
  const hash = value => createHmac('sha256', secret).update(value).digest('hex');
  let catalogCache;
  let catalogTime = 0;

  async function catalog() {
    if (catalogCache && now() - catalogTime < 60000) return catalogCache;
    const locations = await client.list('/locations');
    const result = await Promise.all(locations.filter(location => uuid(location.uuid)).map(async location => {
      const services = await client.list(`/locations/${location.uuid}/services`);
      return {id: location.uuid, name: location.name, timezone: location.timezone?.name,
        services: services.filter(service => service.live !== false && service.live_in_widget !== false)
          .map(service => ({id: service.uuid, name: service.name, duration: service.duration_without_pause || service.duration,
            priceLabel: service.is_price_hidden ? '' : service.price_formatted, autoAllocate: service.is_auto_allocated === true,
            collective: service.is_collective === true, kind: service.kind}))};
    }));
    catalogCache = {locations: result};
    catalogTime = now();
    return catalogCache;
  }

  async function selection(input) {
    const data = await catalog();
    const location = data.locations.find(item => item.id === input.locationId);
    const service = location?.services.find(item => item.id === input.serviceId);
    if (!service) fail(400, 'SERVICE', 'Выберите услугу из списка');
    // Group-session/cart booking needs a separate contract. Do not book it as a private service.
    if (service.kind === 'group') fail(400, 'SERVICE_KIND', 'Эта услуга доступна через виджет BookNow');
    let staffers = [];
    if (!service.autoAllocate) {
      staffers = await client.list(`/locations/${location.id}/staffers?service_uuid=${service.id}`);
      if (!staffers.some(staffer => staffer.uuid === input.stafferId)) fail(400, 'STAFFER', 'Выберите инструктора или арену');
    }
    return {location, service};
  }

  async function staffers(input) {
    const data = await catalog();
    const location = data.locations.find(item => item.id === input.locationId);
    if (!location?.services.some(item => item.id === input.serviceId)) fail(400, 'SERVICE', 'Выберите услугу');
    const rows = await client.list(`/locations/${location.id}/staffers?service_uuid=${input.serviceId}`);
    return {staffers: rows.map(row => ({id: row.uuid, name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.position || 'Инструктор'}))};
  }

  async function slots(input) {
    await selection(input);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') || !Number.isFinite(Date.parse(input.date))) {
      fail(400, 'DATE', 'Выберите дату');
    }
    const dateTime = Date.parse(input.date + 'T00:00:00Z');
    if (dateTime < now() - 86400000 || dateTime > now() + 90 * 86400000) fail(400, 'DATE', 'Выберите дату в ближайшие 90 дней');
    const end = new Date(dateTime + 86400000).toISOString().slice(0, 10);
    const query = new URLSearchParams({service_uuid: input.serviceId, range_start: input.date, range_end: end});
    if (input.stafferId) query.set('staffer_uuid', input.stafferId);
    const result = await client.request(`/locations/${input.locationId}/time-slots?${query}`);
    const day = result.dates?.find(item => item.date === input.date);
    return {timezone: result.timezone, currency: result.currency,
      slots: (day?.slots || []).filter(slot => Number(slot.quantity) > 0).map(slot => ({
        start: slot.start, end: slot.end, quantity: Number(slot.quantity), priceLabel: slot.price_formatted
      }))};
  }

  function previous(row, ownerHash) {
    if (row.owner_hash !== ownerHash) fail(409, 'DUPLICATE', 'Такая запись уже отправлена. Проверьте её у администратора');
    if (row.state === 'confirmed') return JSON.parse(row.result);
    if (row.state === 'rejected') fail(409, 'REJECTED', 'Измените параметры записи и повторите отправку');
    fail(409, 'UNCERTAIN', 'Запрос уже отправлен в BookNow. Уточните статус у администратора перед новой записью. Номер запроса ' + row.request_id);
  }

  async function book(input) {
    if (!uuid(input.requestId) || !/^[a-f0-9]{64}$/.test(input.clientToken || '')) fail(400, 'REQUEST', 'Обновите страницу и попробуйте снова');
    const ownerHash = hash(input.clientToken);
    const existing = db.prepare('SELECT * FROM site_bookings WHERE request_id=?').get(input.requestId);
    if (existing) return previous(existing, ownerHash);
    if (input.consent !== true || input.website) fail(400, 'CONSENT', 'Подтвердите согласие на обработку записи');
    const phone = normalizePhone(input.phone);
    const name = String(input.name || '').trim();
    const message = String(input.message || '').trim();
    const email = String(input.email || '').trim();
    const guests = Number(input.guests || 1);
    const scenario = String(input.scenario || '').trim();
    if (name.length < 2 || name.length > 80 || /[<>\x00-\x1f]/.test(name)) fail(400, 'NAME', 'Укажите имя от 2 до 80 символов');
    if (message.length > 500 || /[\x00-\x08]/.test(message)) fail(400, 'MESSAGE', 'Сократите пожелания до 500 символов');
    if (!Number.isInteger(guests) || guests < 1 || guests > 10 || scenario.length > 100 || /[<>\x00-\x1f]/.test(scenario)) {
      fail(400, 'GUESTS', 'Проверьте количество гостей и пожелание по игре');
    }
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) fail(400, 'EMAIL', 'Проверьте адрес электронной почты');
    const {service} = await selection(input);
    const available = await slots(input);
    const slot = available.slots.find(item => item.start === input.time);
    if (!slot) fail(409, 'SLOT', 'Это время уже недоступно. Выберите другой сеанс');
    const quantity = Number(input.quantity || 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(10, slot.quantity) || (!service.collective && quantity !== 1)) {
      fail(400, 'QUANTITY', 'Проверьте количество мест');
    }
    const reservedOn = slotToUtc(input.date, slot.start, available.timezone);
    if (Date.parse(reservedOn) <= now()) fail(409, 'SLOT', 'Это время уже прошло');
    const offer = input.promoId ? promo.forBooking({id: input.promoId, phone, clientToken: input.clientToken}) : null;
    if (offer && Date.parse(reservedOn) > Date.parse(offer.expiresAt)) fail(400, 'PROMO_VISIT_DATE', 'Для скидки выберите посещение до окончания срока бонуса');
    const fingerprint = hash([phone, input.locationId, input.serviceId, reservedOn].join('|'));
    // Reserve both the request and the bonus before the network call. Uncertain outcomes stay reserved.
    try {
      db.prepare('INSERT INTO site_bookings VALUES (?, ?, ?, ?, ?, NULL, ?)')
        .run(input.requestId, ownerHash, fingerprint, offer?.id || null, 'sending', now());
    } catch (error) {
      const row = db.prepare("SELECT * FROM site_bookings WHERE state!='rejected' AND (fingerprint=? OR promo_id=?)")
        .get(fingerprint, offer?.id || null);
      if (!row) throw error;
      if (row.promo_id && row.fingerprint !== fingerprint) fail(409, 'PROMO_USED', 'Скидка уже привязана к другой записи');
      return previous(row, ownerHash);
    }
    const note = [`Гостей в компании: ${guests}.`, scenario ? 'Пожелание по игре: ' + scenario : '', message,
      offer ? `Колесо скидок: ${offer.discountPercent}%. Бонус ${offer.id}. Действует до ${offer.expiresAt}. Применить скидку вручную и проверить номер при посещении.` : '',
      `Запись с сайта. Запрос ${input.requestId}.`].filter(Boolean).join('\n');
    let result;
    try {
      const response = await client.request('/bookings', {reserved_on: reservedOn, timezone: available.timezone,
        location_uuid: input.locationId, service_uuid: input.serviceId,
        ...(input.stafferId ? {staffer_uuid: input.stafferId} : {}),
        customer_first_name: name, customer_phone: phone, ...(email ? {customer_email: email} : {}),
        booking_comment: note, booking_callback: input.callback === true, quantity});
      const booking = response.data || response;
      if (!booking.uuid) throw new Error('Missing booking UUID');
      result = {id: booking.uuid, requestId: input.requestId, start: booking.start_time || reservedOn,
        timezone: available.timezone, status: booking.status?.name || '', service: service.name,
        discountPercent: offer?.discountPercent || 0, priceLabel: booking.order?.total_formatted || slot.priceLabel};
    } catch (error) {
      const rejected = error instanceof BookNowError && [400, 403, 404, 422, 429].includes(error.status);
      db.prepare('UPDATE site_bookings SET state=? WHERE request_id=?').run(rejected ? 'rejected' : 'uncertain', input.requestId);
      if (rejected) {
        const fields = error.data?.errors || {};
        const fieldNames = Object.keys(fields);
        let message = 'BookNow не принял запись. Проверьте параметры или обратитесь к администратору';
        if (fields.booking || fields.reserved_on) message = 'Выбранное время уже занято. Обновите список сеансов';
        if (fields.customer_email) message = 'BookNow требует корректный email';
        if (fieldNames.some(field => !['booking', 'reserved_on', 'customer_email'].includes(field))) {
          console.error('BookNow validation fields:', fieldNames.join(', '));
        }
        fail(422, 'BOOKNOW_VALIDATION', message);
      }
      fail(409, 'UNCERTAIN', 'Запрос отправлен, но подтверждение ещё не получено. Уточните статус у администратора. Номер запроса ' + input.requestId);
    }
    db.prepare("UPDATE site_bookings SET state='confirmed', result=? WHERE request_id=?").run(JSON.stringify(result), input.requestId);
    return result;
  }
  return {catalog, staffers, slots, book, close: () => db.close()};
}
