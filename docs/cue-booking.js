'use strict';
(() => {
  const theme = Object.freeze({accent: '#FF303D', background: '#10141E', radius: 4});
  const widgetUrl = 'https://4304.cue.business/widget/19664?color=ff303d&background=10141e&radius=4';
  const sdkUrl = 'https://4304.cue.business/widget/embed.v1.js?v=1.2.0';
  let sdkPromise;
  let instance;
  let observer;
  let visibilityObserver;

  function loadSdk() {
    if (window.CueBooking?.version === '1.2.0') return Promise.resolve(window.CueBooking);
    if (!sdkPromise) {
      sdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.async = true;
        script.src = sdkUrl;
        script.onload = () => window.CueBooking?.init ? resolve(window.CueBooking) : reject(new Error('Cue SDK unavailable'));
        script.onerror = () => {script.remove(); reject(new Error('Cue SDK unavailable'));};
        document.head.appendChild(script);
      }).catch(error => {sdkPromise = null; throw error;});
    }
    return sdkPromise;
  }

  function shell() {
    queueMicrotask(() => {
      const root = document.getElementById('cue-booking-w5vwv1xg');
      if (!root) return;
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {observer.disconnect(); void mount(root);}
      }, {rootMargin: '300px'});
      observer.observe(root);
      visibilityObserver = new IntersectionObserver(entries => {
        document.body.classList.toggle('cue-booking-active', entries.some(entry => entry.isIntersecting));
      }, {rootMargin: '-100px 0px -100px 0px'});
      visibilityObserver.observe(root.closest('.booking-section'));
    });
    return `<div class="cue-booking-shell">
      <div class="cue-booking-header"><div class="cue-booking-heading"><span class="cue-booking-icon">${icon('calendar')}</span><div><h3>ТВОЁ ВРЕМЯ ЗА ГРАНЬЮ</h3><p>Расписание, доступные места и стоимость — в одном окне</p></div></div><span class="cue-booking-live"><i></i> ОНЛАЙН-ЗАПИСЬ</span></div>
      <div class="cue-booking-guide" aria-label="Шаги бронирования"><span><b>01</b> Выбери свободное время</span><span><b>02</b> Укажи участников</span><span><b>03</b> Заполни контакты</span></div>
      <div class="cue-booking-content">
        <div class="cue-booking-status" role="status" aria-live="polite"><span class="cue-booking-spinner" aria-hidden="true"></span><span data-cue-status>Загружаем расписание арены…</span><button type="button" class="text-link" data-cue-retry hidden>Повторить загрузку</button></div>
        <div id="cue-booking-w5vwv1xg" data-cue-booking-root></div>
      </div>
      <div class="cue-booking-footer"><span>${icon('shield')} Бронирование и данные обрабатываются в Cue</span><a href="${widgetUrl.replaceAll('&', '&amp;')}" target="_blank" rel="noopener noreferrer">Открыть в отдельном окне ${icon('arrow')}</a></div>
    </div>`;
  }

  async function mount(root) {
    if (!root.isConnected || root.dataset.state === 'loading' || root.dataset.state === 'ready') return;
    root.dataset.state = 'loading';
    const shell = root.closest('.cue-booking-shell');
    const status = shell.querySelector('.cue-booking-status');
    const label = shell.querySelector('[data-cue-status]');
    const retry = shell.querySelector('[data-cue-retry]');
    status.hidden = false;
    status.classList.remove('cue-booking-status-error');
    retry.hidden = true;
    label.textContent = 'Загружаем расписание арены…';
    const failed = () => {
      root.dataset.state = 'error';
      status.hidden = false;
      status.classList.add('cue-booking-status-error');
      label.textContent = 'Не удалось загрузить расписание. Повтори попытку или открой запись в отдельном окне.';
      retry.hidden = false;
    };
    retry.onclick = () => {instance?.destroy(); instance = null; void mount(root);};
    try {
      const sdk = await loadSdk();
      if (!root.isConnected) return;
      instance = sdk.init({target: root, url: widgetUrl, theme, ecommerce: false, events: {
        ready: () => {root.dataset.state = 'ready'; status.hidden = true;},
        error: failed
      }});
    } catch {if (root.isConnected) failed();}
  }

  function open() {
    const section = document.getElementById('booking');
    const root = document.getElementById('cue-booking-w5vwv1xg');
    if (!section || !root) return;
    if (document.getElementById('modal-root')?.hasChildNodes()) closeModal();
    if (location.hash !== '#booking') history.pushState(null, '', '#booking');
    section.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
    section.focus({preventScroll: true});
    void mount(root);
  }

  function destroy() {
    observer?.disconnect(); visibilityObserver?.disconnect(); instance?.destroy(); instance = null;
    document.body.classList.remove('cue-booking-active');
  }

  function privacy() {
    modal(`<div class="eyebrow">Онлайн-запись</div><h2 id="modal-title">ДАННЫЕ БРОНИРОВАНИЯ</h2><div class="article-modal"><p>Онлайн-запись оформляется через виджет Cue. Контактные данные и параметры посещения вводятся в форме Cue и обрабатываются по условиям, указанным в ней перед отправкой.</p><p>Согласия, политика конфиденциальности и условия бронирования доступны в самом виджете.</p><p>Остальные формы обратной связи, отзывы и колесо скидок пока работают в демонстрационном режиме. Для них используйте вымышленные данные.</p><button class="btn btn-outline" data-action="close">Понятно ${icon('check')}</button></div>`);
  }
  window.ZGCue = Object.freeze({shell, open, destroy, privacy});
})();
