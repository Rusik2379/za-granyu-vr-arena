'use strict';
(() => {
  let hintSequence = 0;
  const phoneHint = 'Мобильный номер РФ: +7 9XX XXX-XX-XX';
  function validate(input, showError = false) {
    const digits = input.value.replace(/\D/g, '').replace(/^8/, '7');
    const message = !digits ? '' : /^79\d{9}$/.test(digits) ? ''
      : digits.length < 11 ? 'Введите номер полностью: +7 9XX XXX-XX-XX'
      : 'Укажите мобильный номер РФ, который начинается с +7 9';
    input.setCustomValidity(message);
    const hint = input.parentElement.querySelector('[data-phone-hint]');
    const invalid = !!message && (showError || input.dataset.phoneError === 'true' || digits.length === 11);
    if (invalid) input.dataset.phoneError = 'true';
    input.setAttribute('aria-invalid', String(invalid));
    if (hint) {hint.textContent = invalid ? message : phoneHint; hint.classList.toggle('is-error', invalid);}
  }
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
      if (input.dataset.phonePrepared) continue;
      input.dataset.phonePrepared = 'true';
      input.placeholder = '+7 9XX XXX-XX-XX';
      input.inputMode = 'tel';
      input.autocomplete = 'tel';
      if (input.value) input.value = format(input.value);
      const hint = document.createElement('small');
      hint.id = 'phone-hint-' + ++hintSequence;
      hint.className = 'phone-hint'; hint.dataset.phoneHint = ''; hint.setAttribute('aria-live', 'polite');
      input.insertAdjacentElement('afterend', hint);
      const caption = input.labels?.[0]?.querySelector('span');
      if (caption && !input.hasAttribute('aria-label') && !input.hasAttribute('aria-labelledby')) {
        caption.id ||= 'phone-label-' + hintSequence;
        input.setAttribute('aria-labelledby', caption.id);
      }
      input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), hint.id].filter(Boolean).join(' '));
      validate(input);
    }
  }
  document.addEventListener('focusin', event => {
    if (event.target.matches('input[type=tel]') && !event.target.value) {event.target.value = '+7 '; validate(event.target);}
  });
  document.addEventListener('focusout', event => {if (event.target.matches('input[type=tel]')) validate(event.target, true);});
  document.addEventListener('invalid', event => {if (event.target.matches('input[type=tel]')) validate(event.target, true);}, true);
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
    validate(input);
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
