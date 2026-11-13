'use strict';
(() => {
  const previewPrizes = [5,7,10,5,7,5];
  const settings = window.ZG_PROMO_CONFIG || {mode:'preview',apiBase:''};
  let rules, bookingOffer;
  const storageKey = 'zg-wheel-preview-v2';
  function clientToken() {
    let value;
    try {value=localStorage.getItem('zg-wheel-client-v1');} catch {}
    if (!/^[a-f0-9]{64}$/.test(value||'')) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      value = [...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
      try {localStorage.setItem('zg-wheel-client-v1',value);} catch {throw Error('Разрешите сохранение данных сайта, чтобы получить бонус');}
    }
    return value;
  }
  function phoneNumber(value) {
    const raw=String(value).trim();
    if(!/^[+\d\s()\-]+$/.test(raw))throw Error('Укажите российский мобильный номер');
    let digits=raw.replace(/\D/g,'');
    if(digits.length===11&&digits[0]==='8')digits='7'+digits.slice(1);
    if(!/^79\d{9}$/.test(digits))throw Error('Укажите номер в формате +7 9XX XXX-XX-XX');
    return '+'+digits;
  }
  async function api(route,body) {
    const base=String(settings.apiBase||'').replace(/\/+$/,'');
    if(!base)throw Error('Приём заявок пока не подключён');
    const response=await fetch(base+'/'+route,{method:body?'POST':'GET',credentials:'omit',
      headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    let data;
    try{data=await response.json();}catch{throw Error('Сервис временно недоступен. Попробуйте позже');}
    if(!response.ok)throw Error(data.message||'Не удалось отправить заявку. Попробуйте позже');
    return data;
  }
  async function loadRules() {
    if(settings.mode==='preview')return {mode:'preview',prizes:settings.prizes||previewPrizes,validityDays:settings.validityDays||14};
    const config=await api('config');
    if(config.mode!=='live'||!Array.isArray(config.prizes)||config.prizes.length!==6||!config.prizes.every(n=>Number.isInteger(n)&&n>0&&n<=100)||!Number.isInteger(config.validityDays)||config.validityDays<1)throw Error('Акция временно недоступна');
    return config;
  }
  function wheelArtwork() {
    const colors=[['#ff6570','#d81735'],['#293c59','#111c30'],['#3aa3ff','#145ac4'],['#293c59','#111c30'],['#ff6570','#d81735'],['#293c59','#111c30']];
    const point=(angle,radius)=>[200+Math.sin(angle*Math.PI/180)*radius,200-Math.cos(angle*Math.PI/180)*radius];
    const gradients=colors.map(([light,dark],i)=>`<radialGradient id="sector-${i}" cx="45%" cy="0%" r="110%"><stop stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></radialGradient>`).join('');
    const sectors=rules.prizes.map((prize,i)=>{const [x1,y1]=point(i*60,183),[x2,y2]=point((i+1)*60,183),[tx,ty]=point(i*60+30,126);return `<path d="M200 200L${x1} ${y1}A183 183 0 0 1 ${x2} ${y2}Z" fill="url(#sector-${i})" stroke="#ffffff25" stroke-width="1"/><text x="${tx}" y="${ty+4}" text-anchor="middle" class="promo-sector-value">−${prize}<tspan class="promo-sector-percent">%</tspan></text><text x="${tx}" y="${ty+22}" text-anchor="middle" class="promo-sector-caption">НА ИГРУ</text>`}).join('');
    const dots=Array.from({length:36},(_,i)=>{const[x,y]=point(i*10,194);return `<circle cx="${x}" cy="${y}" r="2.4" fill="${i%3===0?'#ffb8be':'#7d91af'}"/>`}).join('');
    return `<div class="promo-wheel-stage"><div class="promo-wheel-orbit" aria-hidden="true"></div><div class="wheel-wrap"><span class="promo-pointer" aria-hidden="true"></span><div class="wheel" id="promo-wheel"><svg class="promo-wheel-svg" viewBox="0 0 400 400" aria-hidden="true"><defs>${gradients}<linearGradient id="wheel-rim" x2="1" y2="1"><stop stop-color="#7587a5"/><stop offset=".35" stop-color="#23324c"/><stop offset=".65" stop-color="#0b1424"/><stop offset="1" stop-color="#4b607f"/></linearGradient></defs><circle cx="200" cy="200" r="199" fill="url(#wheel-rim)"/><circle cx="200" cy="200" r="185" fill="#09101d"/>${sectors}${dots}<circle cx="200" cy="200" r="183" fill="none" stroke="#ffffff45" stroke-width="1"/></svg></div><div class="promo-wheel-hub" aria-hidden="true"><span>ЗА ГРАНЬЮ</span><small>ТВОЯ УДАЧА</small></div></div><div class="promo-wheel-caption"><span></span> Крути колесо — забирай скидку <span></span></div></div>`;
  }
  function draw() {
    const preview=rules.mode==='preview';
    modal(`<div class="promo-layout"><div class="promo-art"><div class="promo-art-topline"><span>ЗА ГРАНЬЮ / VR-АРЕНА</span><span class="promo-max">ДО −${Math.max(...rules.prizes)}%</span></div>${wheelArtwork()}<div class="promo-art-footer">${icon('gift')} Скидка на следующее посещение</div></div><div class="promo-details"><div class="eyebrow">${preview?'Предпросмотр акции':'Подарок перед игрой'}</div><h2 id="modal-title">КОЛЕСО<br><span>ТВОЕЙ УДАЧИ</span></h2><p class="modal-intro">${preview?'Введи вымышленные имя и телефон, чтобы проверить колесо и увидеть свой результат.':'Оставь имя и телефон, крути колесо и забирай скидку на следующее посещение.'}</p><div class="promo-benefits"><span>${icon('gift')} Скидка до ${Math.max(...rules.prizes)}%</span><span>${icon('clock')} ${rules.validityDays} дней на игру</span></div><form id="promo-form"><div class="form-grid"><label class="field"><span>Твоё имя</span><input name="name" required minlength="2" maxlength="80" autocomplete="given-name" placeholder="Как тебя зовут"></label><label class="field"><span>Номер телефона</span><input name="phone" type="tel" required maxlength="24" autocomplete="tel" inputmode="tel" placeholder="+7 (999) 123-45-67"></label></div><label class="promo-honeypot" aria-hidden="true">Ваш сайт<input name="website" tabindex="-1" autocomplete="off"></label><label class="consent"><input name="consent" type="checkbox" required><span>${preview?'Ввожу вымышленные данные для проверки формы':'Согласен на обработку имени и телефона для сохранения результата колеса и использования скидки'}</span></label><p class="promo-error" id="promo-error" role="alert"></p><button class="btn" type="submit" id="promo-spin">${preview?'Прокрутить для примера':'Крутить колесо'} ${icon('arrow')}</button><p class="promo-rules">${preview?'Пробный режим — бонус недействителен, заявка в CRM не отправляется.':'Один номер участвует один раз. Администратор проверит номер при использовании скидки.'}</p></form><div id="promo-result" class="promo-result" role="status" aria-live="polite"></div></div></div>`,'wheel-modal promo-modal');
    $('.promo-tab')?.setAttribute('aria-expanded','true');
  }
  async function open() {
    try {rules=await loadRules();draw();}catch(error){toast(error.message);}
  }
  async function previewClaim(data) {
    const phone=phoneNumber(data.phone);
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(phone)))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const previous=readStore(storageKey,null);
    if(previous){if(previous.phoneHash!==hash)throw Error('В этом браузере колесо уже проверяли');return {...previous.result,repeated:true};}
    const random=crypto.getRandomValues(new Uint32Array(1))[0];
    const sector=random%rules.prizes.length;
    const result={id:'ПРИМЕР-'+crypto.randomUUID().slice(0,8).toUpperCase(),sector,discountPercent:rules.prizes[sector],expiresAt:new Date(Date.now()+rules.validityDays*86400000).toISOString(),delivery:'preview',repeated:false};
    if(!writeStore(storageKey,{phoneHash:hash,result}))throw Error('Не удалось сохранить пример результата');
    return result;
  }
  function resultMarkup(result) {
    const preview=rules.mode==='preview';
    const expiry=new Date(result.expiresAt).toLocaleDateString('ru-RU',{timeZone:'Asia/Barnaul'});
    return `<div class="promo-discount">−${result.discountPercent}%</div><h3>${preview?'ПРИМЕР ТВОЕГО БОНУСА':'ТВОЯ СКИДКА НА ИГРУ'}</h3><p>${result.repeated?'Этот номер уже участвовал — показываем прежний результат. ':''}${preview?'Пробный результат сохранён в браузере. Заявка в CRM не отправлялась.':'Забери скидку на бронь: выбери услугу и свободное время в следующем окне. Имя и телефон уже будут заполнены.'}</p><span class="reference">${esc(result.id)}</span><p>${preview?'Пример срока':'Посетить арену до'}: ${expiry}</p>${!preview && window.ZGBooking?.enabled?`<button class="btn" type="button" data-promo-book>Применить скидку к брони ${icon('arrow')}</button>`:''}<button class="btn btn-outline" type="button" data-action="close">Вернуться на сайт ${icon('arrow')}</button>`;
  }
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='promo-form')return;
    event.preventDefault();
    const form=event.target;
    if(!form.reportValidity())return;
    const button=$('#promo-spin'),error=$('#promo-error');
    button.disabled=true;error.textContent='';
    let result;
    try {
      const data=Object.fromEntries(new FormData(form));
      data.phone=phoneNumber(data.phone);data.name=data.name.trim();
      if(data.name.length<2)throw Error('Укажите имя от двух символов');
      data.consent=true;data.clientToken=clientToken();
      result=rules.mode==='preview'?await previewClaim(data):await api('claim',data);
      if(!Number.isInteger(result.sector)||result.sector<0||result.sector>=6||result.discountPercent!==rules.prizes[result.sector]||!Number.isFinite(Date.parse(result.expiresAt)))throw Error('Не удалось получить результат. Повторите запрос — бонус не изменится');
      bookingOffer={promo:result,name:data.name,phone:data.phone};
      if(!form.isConnected)return;
      const wheel=$('#promo-wheel');
      wheel.style.transform=`rotate(${2160+360-(result.sector*60+30)}deg)`;
      button.textContent=result.repeated?'Показываем твой бонус…':'Колесо выбирает скидку…';
      const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(!reduced)await new Promise(resolve=>setTimeout(resolve,3600));
      if(!form.isConnected)return;
      form.hidden=true;$('#promo-result').innerHTML=resultMarkup(result);
    } catch(failure) {if(form.isConnected){error.textContent=failure.message;button.disabled=false;button.textContent=rules.mode==='preview'?'Прокрутить для примера':'Крутить колесо';}}
  });
  document.addEventListener('click', event => {
    if(event.target.closest('[data-promo-book]') && rules?.mode==='live' && bookingOffer) window.ZGBooking?.open(bookingOffer);
  });
  window.ZGPromo=Object.freeze({open});
})();
