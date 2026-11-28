import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPromoService} from './promo-core.mjs';
import {createBookingService, slotToUtc} from './booking-service.mjs';
import {BookNowError} from './booknow-client.mjs';
import {createSiteServer} from './site-server.mjs';
import {bookingQuote} from './booking-price.mjs';
import ranges from '../dist/booking-range.js';

const locationId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const clientToken = 'a'.repeat(64);

const intervalSlots = () => [12,13,14].map((hour,index) => ({start:hour+':00',end:(hour+1)+':00',quantity:index===1?2:5,price:90000+index*10000,price_formatted:'900 ₽'}));
function withIntervals(f, response = null) {
  const original = f.client.request;
  f.client.request = async (path,body) => {
    if(path.includes('/time-slots?')) return {timezone:'Asia/Barnaul',currency:'RUB',dates:[{date:'2026-11-11',slots:intervalSlots()}]};
    if(response && path==='/bookings'){f.calls.push(body);return response(body);}
    return original(path,body);
  };
}

test('choosing a different start replaces the session and never joins adjacent starts', () => {
  const slots=intervalSlots().map(slot=>({...slot,priceMinor:slot.price}));
  let chosen=ranges.choose(slots,null,'12:00');
  chosen=ranges.choose(slots,chosen,'13:00');
  assert.deepEqual([chosen.start,chosen.end,chosen.slotsCount,chosen.durationMinutes,chosen.priceMinor],['13:00','14:00',1,60,100000]);
  chosen=ranges.choose(slots,chosen,'14:00');
  assert.equal(chosen.start,'14:00');assert.equal(chosen.end,'15:00');
  assert.equal(ranges.choose(slots,chosen,'14:00').start,'14:00');
  assert.equal(ranges.rangeFor(slots,'12:00',2),null);
});

test('one selected service books its full 1, 2 or 3 hours in one provider request', async t => {
  for(const hours of [1,2,3]) {
    const f=setup(t);
    const originalList=f.client.list, originalRequest=f.client.request;
    f.client.list=async path=>(await originalList(path)).map(row=>path.includes('/services')?{...row,duration:hours*60}:row);
    f.client.request=async(path,body)=>path.includes('/time-slots?')
      ? {timezone:'Asia/Barnaul',currency:'RUB',dates:[{date:'2026-11-11',slots:[{start:'12:00',end:(12+hours)+':00',quantity:5,price:hours*100000}]}]}
      : originalRequest(path,body);
    const input=f.input(), result=await f.bookings.book(input);
    await f.bookings.book(input);
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].slots_count,1);
    assert.equal(result.durationMinutes,hours*60);assert.equal(result.slotsCount,1);
    assert.equal(result.end,'2026-11-11T'+String(5+hours).padStart(2,'0')+':00:00Z');
    assert.equal(result.quote.baseMinor,hours*100000);
  }
});

test('forged session counts, invalid capacity and missing agreement never create bookings', async t => {
  const f=setup(t);withIntervals(f);
  for(const slotsCount of [0,2,3,13,1.5]) await assert.rejects(f.bookings.book({...f.input(),slotsCount}),{code:'SINGLE_SESSION'});
  await assert.rejects(f.bookings.book({...f.input(),quantity:6}),{code:'QUANTITY'});
  await assert.rejects(f.bookings.book({...f.input(),terms:false}),{code:'TERMS'});
  assert.equal(f.calls.length,0);
});

test('a shortened provider reservation stays uncertain and is not submitted twice', async t => {
  const f=setup(t);withIntervals(f,body=>({uuid:randomUUID(),end_time:'2026-11-11T05:30:00Z'}));
  const input=f.input();
  await assert.rejects(f.bookings.book(input),{code:'UNCERTAIN'});
  await assert.rejects(f.bookings.book(input),{code:'UNCERTAIN'});
  assert.equal(f.calls.length,1);
});

function setup(t,notifications) {
  const directory = mkdtempSync(join(tmpdir(), 'zg-booking-'));
  const databasePath = join(directory, 'promo.sqlite');
  const secret = 'test-only-secret-'.repeat(4);
  let time = Date.parse('2026-11-10T00:00:00Z');
  const now = () => time;
  const promo = createPromoService({databasePath, secret, prizes: [5, 7, 10, 5, 7, 5], validityDays: 14, now, choose: () => 1});
  const calls = [];
  const client = {
    async list(path) {
      if (path === '/locations') return [{uuid: locationId, name: 'Тестовая арена', timezone: {name: 'Asia/Barnaul'}}];
      if (path.includes('/services')) return [{uuid: serviceId, name: 'Тестовый сеанс', live: true, live_in_widget: true,
        is_auto_allocated: true, is_collective: false, kind: 'individual', duration: {value: 60, label: 'minutes'}, price_formatted: '1 200,00 ₽'}];
      return [];
    },
    async request(path, body) {
      if (path.includes('/time-slots?')) return {timezone: 'Asia/Barnaul', currency: 'RUB',
        dates: [{date: '2026-11-11', slots: ['12:00', '14:00'].map(start => ({start, end: '15:00', quantity: '1', price: 120000, price_formatted: '1 200,00 ₽'}))},
          {date: '2026-11-12', slots: [{start: '12:00', end: '13:00', quantity: 0}]}]};
      assert.equal(path, '/bookings');
      calls.push(body);
      return {uuid: randomUUID(), start_time_local: '2026-11-11 12:00:00', order: {total_formatted: '1 200,00 ₽'}, status: {name: 'Новая'}};
    }
  };
  const bookings = createBookingService({client, promo, notifications, databasePath, secret, now});
  const input = () => ({requestId: randomUUID(), clientToken, locationId, serviceId, date: '2026-11-11', time: '12:00',
    name: 'Тест', phone: '+79990000001', consent: true, terms: true, message: 'Только тестовые данные', quantity: 1});
  const claim = () => promo.claim({name: 'Тест', phone: '+79990000001', consent: true, terms: true, clientToken}, 'test');
  t.after(() => {bookings.close(); promo.close(); rmSync(directory, {recursive: true, force: true});});
  return {bookings, promo, client, calls, input, claim, advance: milliseconds => {time += milliseconds;}};
}

test('only a successful new booking enqueues one notification in its confirmation transaction',async t=>{
 const queued=[];let wakes=0;
 const f=setup(t,{enqueue:(id,payload,transaction)=>{assert.equal(transaction.prepare('SELECT state FROM site_bookings WHERE request_id=?').get(id).state,'confirmed');queued.push({id,payload});},wake:()=>wakes++});
 const input=f.input();
 await assert.rejects(f.bookings.book({...input,requestId:randomUUID(),time:'11:00'}),{code:'SLOT'});
 const result=await f.bookings.book(input);await f.bookings.book(input);
 assert.equal(queued.length,1);assert.equal(wakes,1);assert.equal(queued[0].id,input.requestId);
 assert.equal(queued[0].payload.fields['BookNow ID'],result.id);
});

test('ordinary booking uses an actual slot in its timezone and ignores forged percentages', async t => {
  const f = setup(t);
  const result = await f.bookings.book({...f.input(), discountPercent: 99});
  assert.equal(result.discountPercent, 0);
  assert.equal(f.calls[0].reserved_on, '2026-11-11T05:00:00Z');
  assert.doesNotMatch(f.calls[0].booking_comment, /Колесо скидок/);
  assert.equal(slotToUtc('2027-07-01', '12:00', 'Europe/Berlin'), '2027-07-01T10:00:00Z');
  assert.equal(slotToUtc('2027-01-01', '12:00', 'Europe/Berlin'), '2027-01-01T11:00:00Z');
});

test('bonus percentage comes from SQLite and is passed to the CRM note', async t => {
  const f = setup(t), offer = f.claim();
  const result = await f.bookings.book({...f.input(), promoId: offer.id, discountPercent: 99});
  assert.equal(result.discountPercent, 7);
  assert.equal(result.promoId, offer.id);
  assert.deepEqual([result.quote.baseMinor, result.quote.discountMinor, result.quote.totalMinor], [120000, 8400, 111600]);
  assert.equal(result.discountApplication, 'administrator');
  assert.match(f.calls[0].booking_comment, /Колесо скидок: 7%/);
  assert.ok(f.calls[0].booking_comment.includes(offer.id));
  assert.match(f.calls[0].booking_comment, /Применить скидку вручную/);
  assert.ok(f.calls[0].booking_comment.includes(result.quote.totalLabel));
  await assert.rejects(f.bookings.book({...f.input(), time: '14:00', promoId: offer.id}), error => error.code === 'PROMO_USED');
  assert.equal(f.calls.length, 1);
});

test('bonus cannot be used with another phone or browser token', async t => {
  const f = setup(t), offer = f.claim();
  await assert.rejects(f.bookings.book({...f.input(), phone: '+79990000002', promoId: offer.id}), error => error.code === 'PROMO_OWNER');
  await assert.rejects(f.bookings.book({...f.input(), clientToken: 'b'.repeat(64), promoId: offer.id}), error => error.code === 'PROMO_OWNER');
  f.advance(15 * 86400000);
  assert.throws(() => f.promo.forBooking({id: offer.id, phone: '+79990000001', clientToken}), error => error.code === 'PROMO_EXPIRED');
  assert.equal(f.calls.length, 0);
});

test('repeated and concurrent submissions create at most one booking', async t => {
  const f = setup(t), input = f.input();
  const results = await Promise.allSettled([f.bookings.book(input), f.bookings.book(input)]);
  assert.equal(f.calls.length, 1);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  const result = await f.bookings.book(input);
  const retry = await f.bookings.book({...input, requestId: randomUUID()});
  assert.equal(result.id, retry.id);
  assert.equal(f.calls.length, 1);
});

test('a lost CRM response keeps both the request and bonus reserved', async t => {
  const f = setup(t), offer = f.claim();
  const original = f.client.request;
  f.client.request = async (path, body) => {
    if (path === '/bookings') {f.calls.push(body); throw new TypeError('Simulated timeout');}
    return original(path, body);
  };
  const input = {...f.input(), promoId: offer.id};
  await assert.rejects(f.bookings.book(input), error => error.code === 'UNCERTAIN');
  await assert.rejects(f.bookings.book(input), error => error.code === 'UNCERTAIN');
  await assert.rejects(f.bookings.book({...input, requestId: randomUUID()}), error => error.code === 'UNCERTAIN');
  await assert.rejects(f.bookings.book({...input, requestId: randomUUID(), time: '14:00'}), error => error.code === 'PROMO_USED');
  assert.equal(f.calls.length, 1);
});

test('a definite validation rejection allows a new corrected request', async t => {
  const f = setup(t), offer = f.claim();
  const original = f.client.request;
  let reject = true;
  f.client.request = async (path, body) => {
    if (path === '/bookings' && reject) {reject = false; throw new BookNowError(422, {errors: {booking: ['Taken']}});}
    return original(path, body);
  };
  await assert.rejects(f.bookings.book({...f.input(), promoId: offer.id}), error => error.code === 'BOOKNOW_VALIDATION');
  const result = await f.bookings.book({...f.input(), promoId: offer.id});
  assert.equal(result.discountPercent, 7);
  assert.equal(f.calls.length, 1);
});

test('unavailable slots and impossible quantities never reach POST /bookings', async t => {
  const f = setup(t);
  await assert.rejects(f.bookings.book({...f.input(), time: '13:00'}), error => error.code === 'SLOT');
  await assert.rejects(f.bookings.book({...f.input(), quantity: 10}), error => error.code === 'QUANTITY');
  assert.equal(f.calls.length, 0);
});

test('without credentials the runtime leaves demo mode active and rejects booking requests', async t => {
  const server = createSiteServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  assert.match(await (await fetch(origin + '/booknow-config.js')).text(), /"enabled":false/);
  const response = await fetch(origin + '/api/booking/catalog');
  assert.equal(response.status, 503);
});

test('calendar reflects free seats, rejects impossible dates and removes elapsed times', async t => {
  const f = setup(t);
  assert.equal((await f.bookings.catalog()).locations[0].services[0].duration, 60);
  assert.deepEqual((await f.bookings.calendar(f.input())).dates,
    [{date: '2026-11-11', count: 2}, {date: '2026-11-12', count: 0}]);
  await assert.rejects(f.bookings.calendar({...f.input(), date: '2026-11-31'}), {code: 'DATE'});
  f.advance(86400000 + 6 * 3600000); // 13:00 in Barnaul on the selected day.
  assert.deepEqual((await f.bookings.slots(f.input())).slots.map(slot => slot.start), ['14:00']);
  assert.equal(f.calls.length, 0);
});

test('today keeps actual future fractional-hour starts and rejects elapsed times', async t => {
  const f = setup(t), original = f.client.request;
  f.client.request = async (path, body) => {
    if (path.includes('/time-slots?')) return {timezone: 'Asia/Barnaul', currency: 'RUB',
      dates: [{date: '2026-11-11', slots: ['12:00', '12:15', '12:30', '12:45', '13:00', '25:00']
        .map(start => ({start, end: ranges.time(ranges.minutes(start)+60), quantity: 1, price: 120000, price_formatted: '1 200,00 ₽'}))},
        {date: '2026-11-12', slots: [{start: '12:15', end: '13:15', quantity: 1}]}]};
    return original(path, body);
  };
  f.advance(86400000 + 5 * 3600000 + 5 * 60000); // 12:05 on the day of the visit.
  assert.deepEqual((await f.bookings.slots(f.input())).slots.map(slot => slot.start), ['12:15','12:30','12:45','13:00']);
  assert.deepEqual((await f.bookings.calendar(f.input())).dates,
    [{date: '2026-11-11', count: 4}, {date: '2026-11-12', count: 1}]);
  await assert.rejects(f.bookings.book({...f.input(), time: '12:00'}), {code: 'SLOT'});
  const result=await f.bookings.book({...f.input(), time: '12:15'});
  assert.equal(result.start,'2026-11-11T05:15:00Z');
  assert.equal(result.end,'2026-11-11T06:15:00Z');
  assert.equal(f.calls.length, 1);
});

test('overlapping or adjacent starts always replace the selected session', () => {
  const slots=['14:50','15:05','15:50','16:50'].map(start=>({start,end:ranges.time(ranges.minutes(start)+60),quantity:1,priceMinor:120000}));
  const first=ranges.choose(slots,null,'14:50');
  const moved=ranges.choose(slots,first,'15:05');
  assert.equal(moved.start,'15:05');assert.equal(moved.slotsCount,1);
  const adjacent=ranges.choose(slots,first,'15:50');
  assert.equal(adjacent.start,'15:50');assert.equal(adjacent.end,'16:50');assert.equal(adjacent.slotsCount,1);
  assert.equal(adjacent.priceMinor,120000);
  assert.equal(ranges.choose(slots,moved,'15:05').start,'15:05');
});

test('a month calendar requests a bounded range and clips the single-day response', async t => {
  const f = setup(t), original = f.client.request, queries = [];
  f.client.request = async (path, body) => {if (path.includes('/time-slots?')) queries.push(new URL('https://test.invalid' + path).searchParams); return original(path, body);};
  await f.bookings.calendar({...f.input(), days: '31'});
  assert.equal(queries[0].get('range_start'), '2026-11-11');
  assert.equal(queries[0].get('range_end'), '2026-12-11');
  assert.deepEqual((await f.bookings.calendar({...f.input(), days: '1'})).dates, [{date: '2026-11-11', count: 2}]);
  for (const days of ['0', '32', '1.5', 'bad']) await assert.rejects(f.bookings.calendar({...f.input(), days}), {code: 'RANGE'});
});

test('a hidden service price also stays hidden in slot responses', async t => {
  const f = setup(t), original = f.client.list;
  f.client.list = async path => (await original(path)).map(row => path.includes('/services') ? {...row, is_price_hidden: true} : row);
  assert.equal((await f.bookings.catalog()).locations[0].services[0].priceLabel, '');
  assert.equal((await f.bookings.slots(f.input())).slots[0].priceLabel, '');
  assert.equal((await f.bookings.slots(f.input())).slots[0].priceMinor, null);
  assert.equal((await f.bookings.book(f.input())).quote, null);
});

test('enabling bookings does not enable the discount wheel', async t => {
  const f = setup(t);
  const server = createSiteServer({client: f.client, databasePath: ':memory:', secret: 'separate-promo-test-secret-'.repeat(3),
    origins: ['https://arena.example']});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.match(await (await fetch(base + '/booknow-config.js')).text(), /"enabled":true/);
  assert.match(await (await fetch(base + '/promo-config.js')).text(), /"mode":"preview"/);
  const response = await fetch(base + '/api/promo/claim', {method: 'POST', headers: {Origin: 'https://arena.example',
    'Content-Type': 'application/json'}, body: '{}'});
  assert.equal(response.status, 503);
});

test('discount calculations use minor units and handle free or hidden services', () => {
  assert.deepEqual([bookingQuote(10001, 2, 7).baseMinor, bookingQuote(10001, 2, 7).discountMinor,
    bookingQuote(10001, 2, 7).totalMinor], [20002, 1400, 18602]);
  assert.equal(bookingQuote(90000, 1, 10).totalMinor, 81000);
  assert.equal(bookingQuote(0, 1, 5).totalMinor, 0);
  assert.equal(bookingQuote(null, 1, 10), null);
});

test('live wheel API issues one offer and attaches the verified quote to one booking', async t => {
  const f = setup(t);
  const client = {...f.client, async request(path, body) {
    if (path.includes('/time-slots?')) return {timezone: 'Asia/Barnaul', currency: 'RUB', dates: [{
      date: new URL(path, 'https://example.test').searchParams.get('range_start'),
      slots: [{start: '12:00', end: '13:00', quantity: 1, price: 120000, price_formatted: '1 200,00 ₽'}]}]};
    return f.client.request(path, body);
  }};
  const origin = 'https://arena.example';
  const server = createSiteServer({client, databasePath: ':memory:', secret: 'live-wheel-test-secret-'.repeat(3), origins: [origin], promoEnabled: true});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (path, data) => {
    const response = await fetch(base + path, {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify(data)});
    return {status: response.status, data: await response.json()};
  };
  assert.match(await (await fetch(base + '/promo-config.js')).text(), /"mode":"live"/);
  const input = {...f.input(), date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)};
  const offer = await post('/api/promo/claim', input);
  assert.equal(offer.status, 200);
  assert.ok([5, 7, 10].includes(offer.data.discountPercent));
  assert.equal((await post('/api/promo/claim', input)).data.id, offer.data.id);
  const response = await post('/api/booking/create', {...input, promoId: offer.data.id, discountPercent: 99, totalMinor: 1});
  assert.equal(response.status, 200);
  assert.equal(response.data.discountPercent, offer.data.discountPercent);
  assert.equal(response.data.quote.totalMinor, 120000 - Math.round(120000 * offer.data.discountPercent / 100));
  assert.ok(f.calls[0].booking_comment.includes(offer.data.id));
  assert.ok(f.calls[0].booking_comment.includes(response.data.quote.totalLabel));
  assert.equal((await post('/api/booking/create', {...input, promoId: offer.data.id})).data.id, response.data.id);
  assert.equal(f.calls.length, 1);
});
