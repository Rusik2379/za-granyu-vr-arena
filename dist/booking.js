'use strict';
(() => {
  const settings = window.ZG_BOOKING_CONFIG || {enabled: false};
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const option = (value, label) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  const localDate = (days = 0) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Barnaul', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(Date.now() + days * 86400000));
  let catalogPromise;

  function clientToken() {
    let value = localStorage.getItem('zg-wheel-client-v1');
    if (!/^[a-f0-9]{64}$/.test(value || '')) {
      value = Array.from(crypto.getRandomValues(new Uint8Array(32)), number => number.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('zg-wheel-client-v1', value);
    }
    return value;
  }

  async function api(path, body) {
    const response = await fetch(settings.apiBase + '/' + path, {method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(28000)});
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.message || 'Не удалось получить ответ BookNow');
      error.code = data.error;
      throw error;
    }
    return data;
  }

  function form(opts = {}) {
    const id = 'booknow-' + crypto.randomUUID();
    queueMicrotask(() => mount(document.getElementById(id), opts));
    const offer = opts.promo;
    return `<form id="${id}" class="booking-form booknow-form">
      ${offer ? `<div class="booking-discount"><div class="booking-discount-heading"><span class="booking-discount-icon">${icon('gift')}</span><div><strong>Твоя скидка −${escapeHtml(offer.discountPercent)}%</strong><span>На выбранную бронь · до ${escapeHtml(new Date(offer.expiresAt).toLocaleDateString('ru-RU', {timeZone: 'Asia/Barnaul'}))}</span></div></div><p>Имя и телефон уже заполнены. Выбери услугу и время — бонус закрепится за записью. Администратор применит скидку к сумме заказа в BookNow.</p></div>` : ''}
      <fieldset class="booking-fields"><legend class="form-section-title">01 / Услуга и свободное время</legend>
        <div class="form-grid">
          <label class="field" data-location><span>Локация</span><select name="locationId" required disabled>${option('', 'Загружаем BookNow…')}</select></label>
          <label class="field full"><span>Услуга</span><select name="serviceId" required disabled>${option('', 'Сначала выберите локацию')}</select></label>
          <label class="field" data-staffer><span>Инструктор / арена</span><select name="stafferId" disabled></select></label>
          <label class="field"><span>Дата посещения</span><input type="date" name="date" required min="${localDate()}" max="${localDate(90)}" value="${localDate()}"></label>
          <label class="field"><span>Свободное время</span><select name="time" required disabled>${option('', 'Выберите услугу')}</select></label>
          <div class="booking-calendar full" hidden><p class="booking-calendar-title">Ближайшие даты <span>Время Барнаула · UTC+7</span></p><div class="booking-days" data-days aria-label="Доступные даты"></div><p class="muted small" data-calendar-note aria-live="polite"></p></div>
          <label class="field" data-quantity hidden><span>Количество мест</span><select name="quantity">${option('1', '1')}</select></label>
          <label class="field"><span>Гостей в компании</span><select name="guests">${Array.from({length: 10}, (_, index) => option(String(index + 1), String(index + 1))).join('')}</select></label>
          <p class="muted small full" data-service-note></p>
        </div>
      </fieldset>
      <fieldset class="booking-fields"><legend class="form-section-title">02 / Контакты для записи</legend>
        <div class="form-grid">
          <label class="field"><span>Как тебя зовут</span><input name="name" required minlength="2" maxlength="80" autocomplete="given-name" value="${escapeHtml(opts.name || '')}"></label>
          <label class="field"><span>Телефон</span><input name="phone" type="tel" required maxlength="24" autocomplete="tel" placeholder="+7 (999) 123-45-67" value="${escapeHtml(opts.phone || '')}"></label>
          <label class="field full"><span>Email · необязательно</span><input name="email" type="email" maxlength="254" autocomplete="email"></label>
          <label class="field full"><span>Пожелания · необязательно</span><input name="message" maxlength="500" placeholder="Количество и возраст игроков, повод, пожелания"></label>
        </div>
      </fieldset>
      <label class="promo-honeypot" aria-hidden="true">Ваш сайт<input name="website" tabindex="-1" autocomplete="off"></label>
      <div class="booking-form-bottom">
        <div class="booking-total"><span>${offer ? 'Предварительно со скидкой' : 'Стоимость выбранного сеанса'}</span><div class="booking-total-amount"><del data-before hidden></del><strong data-total>Выберите сеанс</strong></div></div>
        <p class="booking-savings" data-savings hidden aria-live="polite"></p>
        <p class="muted small" data-availability aria-live="polite">Проверяем доступные услуги…</p>
        <label class="consent"><input type="checkbox" name="callback"><span>Перезвоните мне для уточнения деталей</span></label>
        <label class="consent"><input type="checkbox" name="consent" required><span>Согласен на обработку и передачу имени, телефона, email и пожеланий в BookNow для оформления записи${offer ? ' и использования скидки' : ''}.</span></label>
        <p class="promo-error" data-error role="alert"></p>
        <div class="form-actions"><button class="btn" type="submit" disabled>${offer ? 'Записаться со скидкой' : 'Забронировать время'}</button></div>
      </div>
    </form>`;
  }

  async function mount(element, opts) {
    if (!element) return;
    const field = name => element.elements.namedItem(name);
    const submit = element.querySelector('[type=submit]');
    const error = element.querySelector('[data-error]');
    const availability = element.querySelector('[data-availability]');
    let location;
    let service;
    let slots = [];
    let generation = 0;
    let calendarGeneration = 0;
    let calendarDates = [];
    let requestId = crypto.randomUUID();
    let busy = false;
    let locked = false;

    function highlightDate() {
      element.querySelectorAll('[data-date]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.date === field('date').value));
      });
    }

    async function loadCalendar() {
      const version = ++calendarGeneration;
      calendarDates = [];
      const calendar = element.querySelector('.booking-calendar');
      const note = element.querySelector('[data-calendar-note]');
      const days = element.querySelector('[data-days]');
      days.innerHTML = '';
      calendar.hidden = !service;
      if (!service || (!service.autoAllocate && !field('stafferId').value)) return;
      note.textContent = 'Загружаем ближайшие 14 дней…';
      try {
        const result = await api('calendar?' + new URLSearchParams({locationId: location.id, serviceId: service.id,
          stafferId: field('stafferId').value, date: field('date').value}));
        if (version !== calendarGeneration || !element.isConnected) return;
        calendarDates = result.dates;
        days.innerHTML = calendarDates.map(day => {
          const date = new Date(day.date + 'T12:00:00Z');
          return `<button type="button" class="booking-day" data-date="${escapeHtml(day.date)}" aria-pressed="false" ${day.count ? '' : 'disabled'}
            aria-label="${escapeHtml(date.toLocaleDateString('ru-RU', {timeZone: result.timezone, day: 'numeric', month: 'long'}))}: ${day.count ? 'есть свободное время' : 'нет свободного времени'}">
            <span>${escapeHtml(date.toLocaleDateString('ru-RU', {timeZone: result.timezone, weekday: 'short'}))}</span>
            <strong>${escapeHtml(date.toLocaleDateString('ru-RU', {timeZone: result.timezone, day: 'numeric', month: '2-digit'}))}</strong>
            <small>${day.count ? 'есть время' : 'нет мест'}</small></button>`;
        }).join('');
        highlightDate();
        note.textContent = 'Недоступные дни нельзя выбрать здесь. Другую дату можно указать в поле выше.';
      } catch (failure) {
        if (version === calendarGeneration && element.isConnected) note.textContent = failure.message;
      }
    }

    function summary() {
      const slot = slots.find(item => item.start === field('time').value);
      const total = element.querySelector('[data-total]');
      const before = element.querySelector('[data-before]');
      const savings = element.querySelector('[data-savings]');
      before.hidden = true;
      savings.hidden = true;
      const quantity = Number(field('quantity').value || 1);
      if (!slot) {total.textContent = 'Выберите сеанс'; submit.disabled = true; return;}
      const discount = opts.promo?.discountPercent || 0;
      if (slot.priceLabel && Number.isSafeInteger(slot.priceMinor)) {
        const format = amount => new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'RUB'}).format(amount / 100);
        const base = slot.priceMinor * quantity;
        const reduction = Math.round(base * discount / 100);
        total.textContent = format(base - reduction);
        if (discount) {
          before.textContent = format(base);
          before.hidden = false;
          savings.textContent = `Экономия ${format(reduction)} · скидка ${discount}% из колеса`;
          savings.hidden = false;
        }
      } else total.textContent = 'Уточняется у администратора';
      submit.disabled = busy || locked;
    }

    function updateQuantity() {
      const slot = slots.find(item => item.start === field('time').value);
      const count = service?.collective ? Math.min(10, slot?.quantity || 1) : 1;
      field('quantity').innerHTML = Array.from({length: count}, (_, index) => option(String(index + 1), String(index + 1))).join('');
      element.querySelector('[data-quantity]').hidden = !service?.collective;
      summary();
    }

    async function loadSlots() {
      const version = ++generation;
      slots = [];
      submit.disabled = true;
      field('time').disabled = true;
      field('time').innerHTML = option('', 'Проверяем свободное время…');
      element.querySelector('[data-total]').textContent = 'Выберите сеанс';
      element.querySelector('[data-before]').hidden = true;
      element.querySelector('[data-savings]').hidden = true;
      if (!service || !field('date').value || (!service.autoAllocate && !field('stafferId').value)) return;
      availability.textContent = 'Проверяем расписание BookNow…';
      try {
        const query = new URLSearchParams({locationId: location.id, serviceId: service.id,
          stafferId: field('stafferId').value, date: field('date').value});
        const result = await api('slots?' + query);
        if (version !== generation || !element.isConnected) return;
        slots = result.slots;
        field('time').innerHTML = option('', slots.length ? 'Выберите свободное время' : 'На эту дату свободных сеансов нет') +
          slots.map(slot => option(slot.start, slot.start + '–' + slot.end)).join('');
        field('time').disabled = !slots.length;
        availability.textContent = slots.length ? 'Свободные сеансы из BookNow · часовой пояс ' + result.timezone : 'Выберите другую дату или услугу';
        updateQuantity();
      } catch (failure) {
        if (version !== generation || !element.isConnected) return;
        field('time').innerHTML = option('', 'Не удалось загрузить расписание');
        availability.textContent = failure.message;
      }
    }

    async function loadService() {
      const version = ++generation;
      ++calendarGeneration;
      calendarDates = [];
      element.querySelector('.booking-calendar').hidden = true;
      service = location.services.find(item => item.id === field('serviceId').value);
      slots = [];
      submit.disabled = true;
      field('stafferId').innerHTML = '';
      field('stafferId').disabled = true;
      field('time').disabled = true;
      field('time').innerHTML = option('', 'Выберите услугу');
      element.querySelector('[data-staffer]').hidden = !service || service.autoAllocate;
      element.querySelector('[data-service-note]').textContent = service
        ? `${service.duration ? service.duration + ' минут. ' : ''}${service.collective ? 'Количество мест определяет число бронируемых мест.' : 'Оформляется один сеанс выбранной услуги.'} Число гостей передадим администратору.` : '';
      summary();
      if (!service) return;
      try {
        if (!service.autoAllocate) {
          const result = await api('staffers?' + new URLSearchParams({locationId: location.id, serviceId: service.id}));
          if (version !== generation || !element.isConnected) return;
          field('stafferId').innerHTML = result.staffers.map(item => option(item.id, item.name)).join('');
          field('stafferId').disabled = false;
          element.querySelector('[data-staffer]').hidden = result.staffers.length === 1;
        }
        await Promise.all([loadCalendar(), loadSlots()]);
      } catch (failure) {
        if (version === generation && element.isConnected) availability.textContent = failure.message;
      }
    }

    function loadLocation(locations) {
      location = locations.find(item => item.id === field('locationId').value);
      field('serviceId').innerHTML = option('', 'Выберите услугу') + (location?.services || []).map(item => option(item.id, item.name)).join('');
      field('serviceId').disabled = !location;
      return loadService();
    }

    element.addEventListener('change', event => {
      error.textContent = '';
      switch (event.target.name) {
        case 'serviceId': void loadService(); break;
        case 'stafferId': void loadCalendar(); void loadSlots(); break;
        case 'date':
          highlightDate();
          if (!calendarDates.some(day => day.date === field('date').value)) void loadCalendar();
          void loadSlots(); break;
        case 'time': updateQuantity(); break;
        case 'quantity': summary(); break;
      }
    });
    element.addEventListener('click', event => {
      const button = event.target.closest('[data-date]');
      if (!button || button.disabled || busy || locked) return;
      field('date').value = button.dataset.date;
      field('date').dispatchEvent(new Event('change', {bubbles: true}));
    });
    element.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || locked || !element.reportValidity()) return;
      busy = true;
      submit.disabled = true;
      const buttonText = submit.textContent;
      submit.textContent = 'Оформляем запись…';
      error.textContent = '';
      const data = Object.fromEntries(new FormData(element));
      const controls = [...element.elements].filter(control => !control.disabled);
      controls.forEach(control => {control.disabled = true;});
      try {
        const result = await api('create', {...data, requestId, clientToken: clientToken(),
          consent: true, callback: field('callback').checked, quantity: Number(data.quantity || 1), promoId: opts.promo?.id || null});
        if (!element.isConnected) return;
        element.innerHTML = `<div class="success"><div class="success-icon">${icon('check')}</div>
          <h3>Запись оформлена в BookNow</h3><p>${escapeHtml(result.service)}</p>
          <p>${escapeHtml(new Date(result.start).toLocaleString('ru-RU', {timeZone: result.timezone, dateStyle: 'long', timeStyle: 'short'}))}</p>
          <p>${escapeHtml(result.status)}</p><span class="reference">${escapeHtml(result.id)}</span>
          ${result.discountPercent ? `<div class="booking-success-discount"><strong>Скидка ${escapeHtml(result.discountPercent)}% закреплена за бронью</strong>
            ${result.quote ? `<p>Предварительно к оплате <b>${escapeHtml(result.quote.totalLabel)}</b> вместо ${escapeHtml(result.quote.baseLabel)}</p>` : ''}
            <p>Бонус и расчёт переданы администратору. Он применит скидку к сумме заказа в BookNow.</p></div>` : ''}</div>`;
        locked = true;
      } catch (failure) {
        if (!element.isConnected) return;
        error.textContent = failure.code ? failure.message : 'Не удалось получить подтверждение. Запись могла быть создана. Уточните её у администратора. Номер запроса ' + requestId;
        if (!failure.code || failure.code === 'UNCERTAIN' || failure.code === 'DUPLICATE' || failure.code === 'PROMO_USED') locked = true;
        else if (failure.code) requestId = crypto.randomUUID();
      } finally {
        busy = false;
        if (element.isConnected && !locked) {controls.forEach(control => {control.disabled = false;}); submit.textContent = buttonText; summary();}
      }
    });

    try {
      if (!catalogPromise) catalogPromise = api('catalog').catch(failure => {catalogPromise = null; throw failure;});
      const result = await catalogPromise;
      if (!element.isConnected) return;
      field('locationId').innerHTML = result.locations.map(item => option(item.id, item.name)).join('');
      field('locationId').disabled = false;
      element.querySelector('[data-location]').hidden = result.locations.length === 1;
      field('locationId').addEventListener('change', () => {void loadLocation(result.locations);});
      availability.textContent = result.locations.length ? 'Выберите услугу и дату посещения' : 'В BookNow пока нет доступных локаций';
      await loadLocation(result.locations);
    } catch (failure) {
      if (element.isConnected) {
        availability.textContent = failure.message;
        field('locationId').innerHTML = option('', 'Онлайн-запись недоступна');
      }
    }
  }

  function open(opts = {}) {
    modal(`<div class="eyebrow">Онлайн-запись</div><h2 id="modal-title">${opts.promo ? 'ЗАПИСАТЬСЯ СО СКИДКОЙ' : 'ТВОЯ СЛЕДУЮЩАЯ ИГРА'}</h2>
      <p class="modal-intro">Выбери услугу и свободный сеанс.${opts.duration ? ' Выбранный на сайте формат — ' + escapeHtml(opts.duration) + ' мин. Найди соответствующую услугу ниже.' : ''}</p>${form(opts)}`, 'booking-modal');
  }
  function privacy() {
    modal(`<div class="eyebrow">Онлайн-запись</div><h2 id="modal-title">ОБРАБОТКА ДАННЫХ ЗАПИСИ</h2><div class="article-modal">
      <p>Форма записи передаёт имя, телефон, email и пожелания на сервер сайта и в BookNow для оформления посещения.</p>
      <p>После колеса сервер сохраняет имя, телефон, процент скидки и срок действия. При бронировании бонус связывается с записью и передаётся в её примечании. Администратор проверяет номер и применяет скидку в CRM.</p>
      <p>В браузере сохраняется случайный идентификатор для защиты от повторного участия. Серверная база с результатами колеса и подтверждениями записи размещается отдельно от файлов сайта.</p>
      <p>Другие демонстрационные формы сайта сохраняют тестовые данные только в текущем браузере.</p>
      <button class="btn btn-outline" data-action="close">Понятно</button></div>`);
  }
  window.ZGBooking = Object.freeze({enabled: settings.enabled === true, form, open, privacy});
})();
