'use strict';
// Loaded only by the GitHub Pages build. It never sends network requests.
(() => {
  const services = [
    {id:'preview-game',name:'Одиночная игра',duration:60,rates:[900,1200]},
    {id:'preview-team',name:'Закрытое мероприятие',duration:60,rates:[8000,11000]},
    {id:'preview-basic',name:'День за гранью',duration:120,rates:[12000,16000]},
    {id:'preview-max',name:'Своя вселенная',duration:180,rates:[17000,23000]}
  ];
  const time = minutes => String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
  const offset = (date,days) => new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
  const slotsFor = (service,date) => {
    const weekend = [0,5,6].includes(new Date(date+'T12:00:00Z').getUTCDay());
    return Array.from({length:13-service.duration/60},(_,i)=>({start:time((10+i)*60),end:time((10+i)*60+service.duration),quantity:1,priceMinor:service.rates[weekend?1:0]*100}));
  };
  window.ZGBookingPreviewAPI = async path => {
    const url = new URL(path,'https://preview.invalid/');
    if(url.pathname==='/catalog')return {locations:[{id:'preview-arena',name:'За Гранью · предпросмотр',timezone:'Asia/Barnaul',services:services.map(({rates,...service})=>({...service,autoAllocate:true,collective:false,kind:'individual'}))}]};
    const service=services.find(item=>item.id===url.searchParams.get('serviceId'));
    if(!service)throw new Error('Выбери формат для просмотра');
    const date=url.searchParams.get('date');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw new Error('Выбери дату для просмотра');
    if(url.pathname==='/calendar')return {dates:Array.from({length:Math.min(7,Math.max(1,Number(url.searchParams.get('days'))||7))},(_,i)=>({date:offset(date,i),count:slotsFor(service,offset(date,i)).length}))};
    if(url.pathname==='/slots')return {timezone:'Asia/Barnaul',currency:'RUB',slots:slotsFor(service,date)};
    throw new Error('Предпросмотр не создаёт записей');
  };
})();
