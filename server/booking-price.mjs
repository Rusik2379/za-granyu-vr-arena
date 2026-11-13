// BookNow prices are integer minor units. The offer percentage comes from SQLite.
export function bookingQuote(priceMinor, quantity, discountPercent, currency = 'RUB') {
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) return null;
  const baseMinor = priceMinor * quantity;
  if (!Number.isSafeInteger(baseMinor)) return null;
  const discountMinor = Math.round(baseMinor * discountPercent / 100);
  const totalMinor = baseMinor - discountMinor;
  const format = value => new Intl.NumberFormat('ru-RU', {style: 'currency', currency}).format(value / 100);
  return {currency, baseMinor, discountMinor, totalMinor,
    baseLabel: format(baseMinor), discountLabel: format(discountMinor), totalLabel: format(totalMinor)};
}
