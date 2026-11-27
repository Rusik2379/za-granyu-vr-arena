'use strict';
// Shared by the booking UI and server; prices and capacity always come from actual slots.
(() => {
  const minutes = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '')
    ? Number(value.slice(0,2)) * 60 + Number(value.slice(3)) : value === '24:00' ? 1440 : NaN;
  const time = value => String(Math.floor(value / 60)).padStart(2,'0') + ':' + String(value % 60).padStart(2,'0');
  function rangeFor(slots, start, count = 1) {
    if (count !== 1) return null;
    const first = slots.find(slot => slot.start === start);
    if (!first) return null;
    const begin = minutes(start);
    let finish = minutes(first.end);
    if (finish === 0 && begin > 0) finish = 1440;
    const unit = finish - begin;
    if (!Number.isFinite(unit) || unit <= 0 || unit * count > 720 || begin + unit * count > 1440 || count > 1 && unit % 60) return null;
    const chosen = [];
    for (let index = 0; index < count; index++) {
      const expected = begin + index * unit;
      const slot = slots.find(item => item.start === time(expected));
      if (!slot || Number(slot.quantity) < 1) return null;
      let end = minutes(slot.end);
      if (end === 0 && expected > 0) end = 1440;
      if (end !== expected + unit) return null;
      chosen.push(slot);
    }
    const known = chosen.every(slot => Number.isSafeInteger(slot.priceMinor) && slot.priceMinor >= 0);
    const price = known ? chosen.reduce((sum,slot) => sum + slot.priceMinor,0) : null;
    return {start, end:time(begin + unit * count), startMinutes:begin, endMinutes:begin + unit * count,
      unitMinutes:unit, durationMinutes:unit * count, slotsCount:count, slots:chosen,
      quantity:Math.min(...chosen.map(slot => Number(slot.quantity))), priceMinor:Number.isSafeInteger(price) ? price : null};
  }
  function choose(slots, selected, clicked) {
    return rangeFor(slots,clicked);
  }
  const api = Object.freeze({minutes,time,rangeFor,choose});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ZGBookingRange = api;
})();
