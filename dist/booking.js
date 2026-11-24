'use strict';
(() => {
  const settings = window.ZG_BOOKING_CONFIG || {enabled: false};
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const option = (value, label) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  const localDate = (days = 0) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Barnaul', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(Date.now() + days * 86400000));
  let catalogPromise;
  let sectionObserver;
  const ranges = window.ZGBookingRange;
  const serviceLabel = item => ({'Одиночная игра':'Игра · 1 час','Закрытое мероприятие':'Команда · 1 час','День за гранью':'Праздник базовый · 2 часа','Своя вселенная':'Праздник максимум · 3 часа'}[item.name] || item.name);
  const visibleServices = location => {
    const order = ['Одиночная игра','Закрытое мероприятие','День за гранью','Своя вселенная'];
    const rank = item => {const index = order.indexOf(item.name); return index < 0 ? order.length : index;};
    return (location?.services || []).filter(item => item.name !== 'Старт праздника').sort((a,b) => rank(a)-rank(b));
  };
  const durationLabel = minutes => minutes % 60 ? minutes + ' мин.' : minutes / 60 + ' ч';

  function clientToken() {
    let value = localStorage.getItem('zg-wheel-client-v1');
    if (!/^[a-f0-9]{64}$/.test(value || '')) {
      value = Array.from(crypto.getRandomValues(new Uint8Array(32)), number => number.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('zg-wheel-client-v1', value);
    }
    return value;
  }

  async function api(path, body) {
    if (settings.preview === true) {
      if (body || !window.ZGBookingPreviewAPI) throw new Error('Предпросмотр не создаёт записей');
      return window.ZGBookingPreviewAPI(path);
    }
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
      ${offer ? `<div class="booking-discount"><div class="booking-discount-heading"><span class="booking-discount-icon">${icon('gift')}</span><div><strong>Твоя скидка −${escapeHtml(offer.discountPercent)}%</strong><span>На выбранную бронь · до ${escapeHtml(new Date(offer.expiresAt).toLocaleDateString('ru-RU', {timeZone: 'Asia/Barnaul'}))}</span></div></div><p>Скидка учтена в расчёте. Администратор применит её к заказу при подтверждении записи.</p></div>` : ''}
      <fieldset class="booking-fields booking-format-fields"><legend class="form-section-title">Формат посещения</legend>
        <div class="form-grid">
          <label class="field full" data-location><span>Локация</span><select name="locationId" required disabled>${option('', 'Загружаем форматы…')}</select></label>
          <label class="field"><span>Формат игры</span><select name="serviceId" required disabled>${option('', 'Сначала выберите локацию')}</select></label>
          <label class="field full" data-staffer hidden><span>Инструктор / арена</span><select name="stafferId" disabled></select></label>
          <label class="field" data-quantity hidden><span>Количество мест</span><select name="quantity">${option('1', '1')}</select></label>
          <label class="field"><span>Гостей в компании</span><select name="guests">${Array.from({length: 10}, (_, index) => option(String(index + 1), String(index + 1))).join('')}</select></label>
          <p class="muted small full" data-service-note></p>
        </div>
      </fieldset>
      <fieldset class="booking-fields booking-schedule-fields"><legend class="form-section-title">Выбери день и часы</legend>
        <input type="hidden" name="date" value="${localDate()}"><input type="hidden" name="time" value=""><input type="hidden" name="slotsCount" value="1">
        <div class="booking-schedule">
          <div class="booking-week-panel"><div class="booking-week-header"><div><h3>Дата</h3><p data-week-title></p></div><div class="booking-week-controls"><button type="button" class="booking-week-nav" data-week="-1" aria-label="Предыдущая неделя">${icon('left')}</button><button type="button" class="booking-week-nav" data-week="1" aria-label="Следующая неделя">${icon('arrow')}</button></div></div>
            <div class="booking-quick-days" data-quick-days role="group" aria-label="Дни недели"></div>
            <p data-calendar-note class="booking-schedule-note" aria-live="polite">Загружаем свободные дни…</p>
          </div>
          <div class="booking-time-panel"><div class="booking-time-header"><div><h3>Часы игры</h3><p data-selected-date></p></div><span class="booking-hour-step">Барнаул · UTC+7</span></div>
            <div class="booking-slot-grid" data-slots role="group" aria-label="Свободное время"></div>
            <div class="booking-range-selection" hidden><div><span>Выбранное время</span><strong data-range-label></strong><small data-range-duration></small></div><button type="button" data-clear-range disabled>Сбросить</button></div><p class="booking-schedule-note" data-time-note aria-live="polite">Выбери день и нажми на свободные часы</p>
          </div>
        </div>
      </fieldset>
      <fieldset class="booking-fields"><legend class="form-section-title">Контакты для записи</legend>
        <div class="form-grid">
          <label class="field"><span>Как тебя зовут</span><input name="name" required minlength="2" maxlength="80" autocomplete="given-name" value="${escapeHtml(opts.name || '')}"></label>
          <label class="field"><span>Телефон</span><input name="phone" type="tel" required maxlength="24" autocomplete="tel" placeholder="+7 (999) 123-45-67" value="${escapeHtml(opts.phone || '')}"></label>
          <label class="field"><span>Email · необязательно</span><input name="email" type="email" maxlength="254" autocomplete="email"></label>
          <label class="field"><span>Пожелания · необязательно</span><input name="message" maxlength="500" placeholder="Возраст игроков, повод, пожелания"></label>
        </div>
      </fieldset>
      <label class="promo-honeypot" aria-hidden="true">Ваш сайт<input name="website" tabindex="-1" autocomplete="off"></label>
      <div class="booking-form-bottom">
        <div class="booking-total"><span>${offer ? 'Предварительно со скидкой' : 'Стоимость выбранного сеанса'}</span><div class="booking-total-amount"><del data-before hidden></del><strong data-total>Выберите сеанс</strong></div></div>
        <p class="booking-savings" data-savings hidden aria-live="polite"></p><p class="muted small" data-availability aria-live="polite">Проверяем доступные услуги…</p>
        <label class="consent"><input type="checkbox" name="callback"><span>Перезвоните мне для уточнения деталей</span></label>
        <label class="consent"><input type="checkbox" name="terms" required><span>Принимаю <a href="/terms/" target="_blank" rel="noopener">пользовательское соглашение</a>, включая возрастные ограничения и правила посещения.</span></label><label class="consent"><input type="checkbox" name="consent" required><span>Согласен на обработку и передачу данных в BookNow для оформления записи${offer ? ' и использования скидки' : ''} в соответствии с <a href="/privacy/" target="_blank" rel="noopener">политикой обработки персональных данных</a>.</span></label>
        <p class="promo-error" data-error role="alert"></p><div class="form-actions"><button class="btn" type="submit" disabled ${settings.preview ? 'hidden' : ''}>${offer ? 'Записаться со скидкой' : 'Забронировать время'}</button>${settings.preview ? '<a class="btn booking-preview-live" href="https://za-granyu22.ru/#booking" target="_blank" rel="noopener noreferrer">Продолжить на сайте арены</a>' : ''}</div>
      </div>
    </form>`;
  }

  async function mount(element, opts) {
    if (!element) return;
    const section = element.closest('.booking-section');
    if (section) {
      sectionObserver?.disconnect();
      sectionObserver = new IntersectionObserver(entries => document.body.classList.toggle('booking-in-view', entries.some(entry => entry.isIntersecting)), {rootMargin:'-100px 0px -100px 0px'});
      sectionObserver.observe(section);
    }
    const field = name => element.elements.namedItem(name);
    const submit = element.querySelector('[type=submit]');
    const error = element.querySelector('[data-error]');
    const availability = element.querySelector('[data-availability]');
    const slotsElement = element.querySelector('[data-slots]');
    const dateFormat = (date, options) => new Date(date + 'T12:00:00Z').toLocaleDateString('ru-RU', {timeZone: 'Asia/Barnaul', ...options});
    const offsetDate = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
    let location, service;
    let slots = [], selectedRange = null;
    let generation = 0, slotGeneration = 0, calendarGeneration = 0;
    let weekStart = localDate(), calendarDates = new Map(), calendarLoading = false, slotsLoading = false;
    let requestId = crypto.randomUUID();
    let busy = false, locked = false;

    function renderCalendar() {
      const weekEnd = offsetDate(weekStart, 6);
      const sameMonth = weekStart.slice(0, 7) === weekEnd.slice(0, 7);
      const endFormat = {day:'numeric',month:sameMonth ? 'long' : 'short',...(weekEnd.slice(0,4) !== localDate().slice(0,4) ? {year:'numeric'} : {})};
      element.querySelector('[data-week-title]').textContent = dateFormat(weekStart, sameMonth ? {day:'numeric'} : {day:'numeric',month:'short'}) + (sameMonth ? '–' : ' — ') + dateFormat(weekEnd, endFormat);
      element.querySelectorAll('[data-week]').forEach(button => {
        button.disabled = busy || locked || !service || (!service.autoAllocate && !field('stafferId').value) || calendarLoading || (Number(button.dataset.week) < 0 ? weekStart <= localDate() : offsetDate(weekStart,7) > localDate(90));
      });
      const days = element.querySelector('[data-quick-days]');
      days.setAttribute('aria-busy', String(calendarLoading));
      days.innerHTML = Array.from({length:7},(_,index) => {
        const day = offsetDate(weekStart,index);
        const count = calendarDates.get(day)?.count || 0;
        const label = dateFormat(day,{weekday:'short'});
        return `<button type="button" class="booking-quick-day${day === localDate() ? ' is-today' : ''}" data-date="${day}" aria-pressed="${day === field('date').value}" ${!service || calendarLoading || !count || day > localDate(90) ? 'disabled' : ''} aria-label="${escapeHtml(dateFormat(day,{day:'numeric',month:'long',weekday:'long'}))}${day === localDate() ? ', сегодня' : ''}: ${count ? 'есть свободное время' : 'нет сеансов'}"><span>${label}</span><strong>${escapeHtml(dateFormat(day,{day:'numeric'}))}</strong></button>`;
      }).join('');
    }

    function renderSlots() {
      element.querySelector('[data-selected-date]').textContent = dateFormat(field('date').value, {weekday:'long',day:'numeric',month:'long'});
      slotsElement.setAttribute('aria-busy', String(slotsLoading));
      const hours = [...new Set([...Array.from({length:12}, (_, index) => String(index + 10).padStart(2,'0') + ':00'), ...slots.map(slot => slot.start)])].sort();
      slotsElement.innerHTML = hours.map(time => {
        const slot = slots.find(item => item.start === time), at = ranges.minutes(time);
        const selected = selectedRange && at >= selectedRange.startMinutes && at < selectedRange.endMinutes;
        const classes = ['booking-slot', selected ? 'is-selected' : '', selected && at === selectedRange.startMinutes ? 'is-range-start' : '', selected && at + 60 === selectedRange.endMinutes ? 'is-range-end' : ''].join(' ');
        return `<button type="button" class="${classes}" data-slot="${time}" aria-pressed="${!!selected}" ${(!slot && !selected) || slotsLoading ? 'disabled' : ''} aria-label="${time}–${ranges.time(at+60)}${selected ? ', выбрано' : slot ? ', свободно' : ', недоступно'}"><strong>${time}</strong><small>${slot || selected ? 'до ' + ranges.time(at+60) : 'недоступно'}</small>${selected ? icon('check') : ''}</button>`;
      }).join('');
      element.querySelector('.booking-range-selection').hidden = !selectedRange;
      element.querySelector('[data-range-label]').textContent = selectedRange ? selectedRange.start + ' — ' + selectedRange.end : '';
      element.querySelector('[data-range-duration]').textContent = selectedRange ? 'Длительность ' + durationLabel(selectedRange.durationMinutes) + (selectedRange.slotsCount > 1 ? ' · ' + selectedRange.slotsCount + ' × ' + durationLabel(selectedRange.unitMinutes) : '') : 'Соседние часы объединятся в один интервал';
      element.querySelector('[data-clear-range]').disabled = !selectedRange;
    }

    async function loadCalendar({chooseAvailable = false} = {}) {
      const version = ++calendarGeneration;
      calendarDates = new Map();
      calendarLoading = !!service;
      renderCalendar();
      const note = element.querySelector('[data-calendar-note]');
      if (!service || (!service.autoAllocate && !field('stafferId').value)) {note.textContent = 'Выбери формат посещения'; calendarLoading = false; renderCalendar(); return;}
      note.textContent = 'Проверяем свободные даты…';
      const start = weekStart;
      const days = Math.min(7, Math.floor((Date.parse(localDate(90))-Date.parse(start))/86400000)+1);
      try {
        const result = await api('calendar?' + new URLSearchParams({locationId: location.id, serviceId: service.id,
          stafferId: field('stafferId').value, date: start, days: String(days)}));
        if (version !== calendarGeneration || !element.isConnected) return;
        calendarDates = new Map(result.dates.map(day => [day.date, day]));
        if (chooseAvailable && !calendarDates.get(field('date').value)?.count) {
          const next = result.dates.find(day => day.count && day.date <= localDate(90));
          if (next) field('date').value = next.date;
        }
        note.textContent = result.dates.some(day => day.count) ? '' : 'На этой неделе свободных сеансов нет. Перелистни следующую неделю';
      } catch (failure) {
        if (version === calendarGeneration && element.isConnected) note.textContent = failure.message;
      } finally {
        if (version === calendarGeneration && element.isConnected) {calendarLoading = false; renderCalendar();}
      }
    }

    function summary() {
      const slot = selectedRange;
      const total = element.querySelector('[data-total]'), before = element.querySelector('[data-before]'), savings = element.querySelector('[data-savings]');
      before.hidden = true; savings.hidden = true;
      if (!slot) {total.textContent = 'Выберите сеанс'; submit.disabled = true; return;}
      const quantity = Number(field('quantity').value || 1), discount = opts.promo?.discountPercent || 0;
      if (Number.isSafeInteger(slot.priceMinor)) {
        const format = amount => new Intl.NumberFormat('ru-RU', {style:'currency',currency:'RUB'}).format(amount / 100);
        const base = slot.priceMinor * quantity, reduction = Math.round(base * discount / 100);
        total.textContent = format(base - reduction);
        if (discount) {before.textContent = format(base); before.hidden = false; savings.textContent = `Экономия ${format(reduction)} · скидка ${discount}% из колеса`; savings.hidden = false;}
      } else total.textContent = 'Уточняется у администратора';
      submit.disabled = settings.preview === true || busy || locked || slotsLoading;
    }

    function updateQuantity() {
      const slot = selectedRange;
      const count = service?.collective ? Math.min(10, slot?.quantity || 1) : 1;
      const previous = Number(field('quantity').value || 1);
      field('quantity').innerHTML = Array.from({length:count}, (_, index) => option(String(index + 1), String(index + 1))).join('');
      field('quantity').value = String(Math.min(previous, count));
      element.querySelector('[data-quantity]').hidden = !service?.collective;
      summary();
    }

    async function loadSlots() {
      const version = ++slotGeneration;
      slots = []; selectedRange = null; field('time').value = ''; field('slotsCount').value = '1'; slotsLoading = !!service;
      renderSlots(); summary();
      const note = element.querySelector('[data-time-note]');
      if (!service || !field('date').value || (!service.autoAllocate && !field('stafferId').value)) {slotsLoading = false; note.textContent = 'Выбери день и нажми на свободные часы'; return;}
      note.textContent = 'Загружаем свободное время…'; availability.textContent = 'Проверяем расписание BookNow…';
      try {
        const result = await api('slots?' + new URLSearchParams({locationId:location.id,serviceId:service.id,stafferId:field('stafferId').value,date:field('date').value}));
        if (version !== slotGeneration || !element.isConnected) return;
        slots = result.slots.filter(slot => /^(?:[01]\d|2[0-3]):00$/.test(slot.start));
        calendarDates.set(field('date').value, {date:field('date').value,count:slots.length});
        renderCalendar();
        note.textContent = slots.length ? (service.duration > 60 ? 'Сеанс ' + durationLabel(service.duration) + ' выделится целиком. Соседние сеансы можно объединить.' : 'Выбери час начала. Нажми соседний час, чтобы продлить игру.') : 'На эту дату нет свободных сеансов. Выбери другую дату';
        availability.textContent = settings.preview ? 'Расписание для ознакомления. Свободное время и запись — на сайте арены.' : slots.length ? 'Свободное время подтверждено BookNow' : 'Выберите другую дату или услугу';
      } catch (failure) {
        if (version === slotGeneration && element.isConnected) {note.textContent = failure.message; availability.textContent = 'Не удалось обновить расписание. Выбери дату ещё раз';}
      } finally {
        if (version === slotGeneration && element.isConnected) {slotsLoading = false; renderSlots(); updateQuantity();}
      }
    }

    async function loadService() {
      const version = ++generation;
      ++calendarGeneration; ++slotGeneration;
      service = location?.services.find(item => item.id === field('serviceId').value);
      slots = []; selectedRange = null; field('slotsCount').value = '1'; calendarDates = new Map(); calendarLoading = !!service; slotsLoading = false;
      field('time').value = ''; field('stafferId').innerHTML = ''; field('stafferId').disabled = true;
      element.querySelector('[data-staffer]').hidden = true;
      element.querySelector('[data-service-note]').textContent = service ? `${service.duration ? service.duration + ' минут. ' : ''}${service.collective ? 'Количество мест определяет число бронируемых мест.' : 'Бронируется выбранный интервал.'} Игру выберешь на арене — инструктор поможет.` : '';
      weekStart = field('date').value;
      renderCalendar(); renderSlots(); updateQuantity();
      if (!service) {element.querySelector('[data-calendar-note]').textContent = 'Выбери формат посещения'; element.querySelector('[data-time-note]').textContent = 'Выбери день и нажми на свободные часы'; return;}
      try {
        if (!service.autoAllocate) {
          const result = await api('staffers?' + new URLSearchParams({locationId:location.id,serviceId:service.id}));
          if (version !== generation || !element.isConnected) return;
          field('stafferId').innerHTML = result.staffers.map(item => option(item.id,item.name)).join('');
          field('stafferId').disabled = !result.staffers.length;
          element.querySelector('[data-staffer]').hidden = result.staffers.length <= 1;
          if (!result.staffers.length) {
            calendarLoading = false;
            renderCalendar();
            availability.textContent = 'Для этого формата пока нет доступных инструкторов. Выбери другой формат';
            element.querySelector('[data-calendar-note]').textContent = availability.textContent;
            return;
          }
        }
        await loadCalendar({chooseAvailable:true});
        if (version === generation && element.isConnected) await loadSlots();
      } catch (failure) {if (version === generation && element.isConnected) {calendarLoading = false; renderCalendar(); availability.textContent = failure.message;}}
    }

    function loadLocation(locations) {
      location = locations.find(item => item.id === field('locationId').value);
      const services = visibleServices(location);
      field('serviceId').innerHTML = services.map(item => option(item.id,serviceLabel(item))).join('');
      const preferred = opts.format === 'private' ? 'Закрытое мероприятие'
        : ['birthday','corporate'].includes(opts.format) ? (Number(opts.duration) === 180 ? 'Своя вселенная' : 'День за гранью')
        : 'Одиночная игра';
      const packageName = {'Игра':'Одиночная игра','Команда':'Закрытое мероприятие','Праздник базовый':'День за гранью','Праздник максимум':'Своя вселенная'}[opts.package] || opts.package;
      const selected = services.find(item => item.name === packageName) || services.find(item => item.name === preferred);
      if (selected) field('serviceId').value = selected.id;
      field('serviceId').disabled = !services.length;
      return loadService();
    }

    element.addEventListener('zg:select-format', event => {
      if (busy || locked) return;
      Object.assign(opts, event.detail);
      if (location) void loadLocation([location]);
    });
    renderCalendar(); renderSlots();
    element.addEventListener('change', event => {
      error.textContent = '';
      switch(event.target.name) {
        case 'serviceId': void loadService(); break;
        case 'stafferId': {const version = ++generation; ++slotGeneration; slots = []; selectedRange = null; field('slotsCount').value = '1'; field('time').value = ''; renderSlots(); summary(); void (async () => {await loadCalendar({chooseAvailable:true}); if (version === generation && element.isConnected) await loadSlots();})(); break;}
        case 'quantity': summary(); break;
      }
    });
    element.addEventListener('click', event => {
      const button = event.target.closest('[data-date],[data-slot],[data-week],[data-clear-range]');
      if (!button || button.disabled || busy || locked) return;
      error.textContent = '';
      if (button.hasAttribute('data-week')) {
        const version = ++generation;
        ++slotGeneration;
        weekStart = offsetDate(weekStart, Number(button.dataset.week) * 7);
        if (weekStart < localDate()) weekStart = localDate();
        field('date').value = weekStart;
        selectedRange = null; slots = []; field('time').value = ''; field('slotsCount').value = '1';
        slotsLoading = true; renderSlots(); summary();
        void (async()=>{await loadCalendar({chooseAvailable:true}); if(version===generation&&element.isConnected)await loadSlots();})();
      } else if (button.hasAttribute('data-date')) {
        field('date').value = button.dataset.date; renderCalendar();
        void loadSlots();
      } else {
        const focused = document.activeElement === button, time = button.dataset.slot;
        selectedRange = button.hasAttribute('data-clear-range') ? null : ranges.choose(slots,selectedRange,time);
        field('time').value = selectedRange?.start || ''; field('slotsCount').value = String(selectedRange?.slotsCount || 1);
        renderSlots(); updateQuantity();
        if(focused&&time)element.querySelector('[data-slot="'+time+'"]:not(:disabled)')?.focus({preventScroll:true});
      }
    });
    element.addEventListener('submit', async event => {
      event.preventDefault();
      if (settings.preview === true) {error.textContent = 'Для оформления записи перейди на сайт арены.'; return;}
      if (busy || locked || !element.reportValidity()) return;
      if (!ranges.rangeFor(slots,field('time').value,Number(field('slotsCount').value))) {error.textContent = 'Выберите свободное время в календаре'; return;}
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
          consent: true, callback: field('callback').checked, quantity: Number(data.quantity || 1), slotsCount:Number(data.slotsCount || 1), terms:data.terms === 'on', promoId: opts.promo?.id || null});
        if (!element.isConnected) return;
        element.innerHTML = `<div class="success"><div class="success-icon">${icon('check')}</div>
          <h3>Запись оформлена в BookNow</h3><p>${escapeHtml(serviceLabel({name:result.service}))}</p>
          <p>${escapeHtml(new Date(result.start).toLocaleString('ru-RU', {timeZone: result.timezone, dateStyle: 'long', timeStyle: 'short'}))}</p>
          ${result.end ? `<p>До ${escapeHtml(new Date(result.end).toLocaleTimeString('ru-RU',{timeZone:result.timezone,hour:'2-digit',minute:'2-digit'}))} · ${escapeHtml(durationLabel(result.durationMinutes))}</p>` : ''}<p>${escapeHtml(result.status)}</p><span class="reference">${escapeHtml(result.id)}</span>
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
    modal(`<div class="eyebrow">Онлайн-запись</div><h2 id="modal-title">${opts.promo ? 'ИГРА СО СКИДКОЙ' : 'ТВОЯ СЛЕДУЮЩАЯ ИГРА'}</h2>
      <p class="modal-intro">${opts.promo ? 'Контакты уже заполнены. Выбери формат, день и часы игры.' : 'Выбери формат, день и часы игры.'}</p>${form(opts)}`, 'booking-modal');
  }
  function privacy() {document.querySelector('[data-privacy-link]')?.click();}
  window.ZGBooking = Object.freeze({enabled: settings.enabled === true, form, open, privacy});
})();
