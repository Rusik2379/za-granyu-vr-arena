'use strict';
(() => {
  function format(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits[0] === '8') digits = '7' + digits.slice(1);
    else if (digits[0] !== '7') digits = '7' + digits;
    digits = digits.slice(0, 11);
    const number = digits.slice(1);
    let result = '+7';
    if (number) result += ' ' + number.slice(0, 3);
    if (number.length > 3) result += ' ' + number.slice(3, 6);
    if (number.length > 6) result += '-' + number.slice(6, 8);
    if (number.length > 8) result += '-' + number.slice(8, 10);
    return result;
  }
  function prepare(root) {
    if (!(root instanceof Element || root instanceof Document)) return;
    const inputs = [...(root.matches?.('input[type=tel]') ? [root] : []), ...root.querySelectorAll('input[type=tel]')];
    for (const input of inputs) {
      input.placeholder = '+7 9XX XXX-XX-XX';
      input.inputMode = 'tel';
      input.autocomplete = 'tel';
      if (input.value) input.value = format(input.value);
    }
  }
  document.addEventListener('focusin', event => {
    if (event.target.matches('input[type=tel]') && !event.target.value) event.target.value = '+7 ';
  });
  document.addEventListener('input', event => {
    const input = event.target;
    if (!input.matches('input[type=tel]')) return;
    const raw = input.value;
    const caret = input.selectionStart ?? raw.length;
    let preceding = raw.slice(0, caret).replace(/\D/g, '').length;
    const digits = raw.replace(/\D/g, '');
    if (digits && !['7','8'].includes(digits[0])) preceding++;
    input.value = format(raw);
    let position = 0, count = 0;
    while (position < input.value.length && count < preceding) {
      if (/\d/.test(input.value[position])) count++;
      position++;
    }
    input.setSelectionRange(position, position);
  });
  document.addEventListener('keydown', event => {
    const input = event.target;
    if (!input.matches('input[type=tel]') || event.key !== 'Backspace' || input.selectionStart !== input.selectionEnd) return;
    const position = input.selectionStart;
    if (position > 3 && /[ -]/.test(input.value[position - 1])) {
      event.preventDefault();
      input.value = input.value.slice(0, position - 2) + input.value.slice(position);
      input.setSelectionRange(position - 2, position - 2);
      input.dispatchEvent(new Event('input', {bubbles:true}));
    }
  });
  prepare(document);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) prepare(node);
  }).observe(document.body, {childList:true, subtree:true});
  window.ZGPhone = Object.freeze({format});
})();
