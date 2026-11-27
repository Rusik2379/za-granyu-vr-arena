import {DatabaseSync} from 'node:sqlite';

export function bookingNotification(input,result) {
  const date=new Date(result.start),end=new Date(result.end);
  const options={timeZone:result.timezone};
  const day=date.toLocaleDateString('ru-RU',{...options,day:'numeric',month:'long',year:'numeric'});
  const clock=value=>value.toLocaleTimeString('ru-RU',{...options,hour:'2-digit',minute:'2-digit'});
  const period=clock(date)+' — '+clock(end);
  const discount=result.discountPercent||0;
  return {
    name:input.name.trim(),phone:input.phone,email:input.email||null,
    subject:(input.name.includes('ТЕСТ')?'ТЕСТ — ':'')+'Новая запись с сайта',
    service:result.service,budget:result.priceLabel||null,city:'Барнаул',source:'za-granyu22.ru',page_url:'https://za-granyu22.ru/#booking',
    description:[`${day}, ${period} (Барнаул).`,input.message,
      discount?`Колесо: скидка ${discount}%. ${result.quote?'Предварительно со скидкой '+result.quote.totalLabel+'. ':''}Скидку в сумме заказа BookNow применяет администратор.`:''].filter(Boolean).join('\n'),
    fields:{'Дата игры':day,'Время игры':period,'Гостей':Number(input.guests||1),'Длительность, мин':result.durationMinutes,
      'Скидка':discount+'%','BookNow ID':result.id,'Номер запроса':result.requestId,'Перезвонить':input.callback===true}
  };
}

export function createBookingNotifications({databasePath,url,transport=fetch,now=Date.now,intervalMs=15000}) {
  if(new URL(url).protocol!=='https:')throw new Error('Notification gateway must use HTTPS');
  const db=new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS booking_notifications (
      request_id TEXT PRIMARY KEY,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,delivery_id INTEGER,created_at INTEGER NOT NULL
    );`);
  let running=null,closing=false;
  function enqueue(id,payload,transaction=db) {
    transaction.prepare('INSERT OR IGNORE INTO booking_notifications(request_id,payload,created_at) VALUES(?,?,?)')
      .run(id,JSON.stringify(payload),now());
  }
  async function deliver() {
    for(let count=0;count<10&&!closing;count++) {
      const row=db.prepare(`SELECT * FROM booking_notifications WHERE attempts<10 AND
        (state='pending' AND next_attempt<=? OR state='sending' AND locked_until<=?) ORDER BY created_at LIMIT 1`).get(now(),now());
      if(!row)break;
      db.prepare("UPDATE booking_notifications SET state='sending',attempts=attempts+1,locked_until=? WHERE request_id=?").run(now()+30000,row.request_id);
      try {
        const response=await transport(url,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'zg-booking-'+row.request_id},
          body:row.payload,redirect:'error',signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error('Gateway status '+response.status);
        const receipt=await response.json();
        if(!Number.isSafeInteger(receipt.delivery_id)||receipt.delivery_id<1)throw new Error('Invalid gateway receipt');
        db.prepare("UPDATE booking_notifications SET state='accepted',payload='{}',locked_until=0,delivery_id=? WHERE request_id=?").run(receipt.delivery_id,row.request_id);
      }catch{
        db.prepare('UPDATE booking_notifications SET state=?,locked_until=0,next_attempt=? WHERE request_id=?')
          .run(row.attempts+1>=10?'failed':'pending',now()+Math.min(3600000,15000*2**row.attempts),row.request_id);
        console.error('Booking notification queued for retry');
      }
    }
  }
  function flush() {
    if(closing)return Promise.resolve();
    if(running)return running;
    running=deliver().finally(()=>{running=null;if(closing)db.close();});
    return running;
  }
  function wake(){queueMicrotask(()=>void flush().catch(()=>console.error('Booking notification queue unavailable')));}
  const timer=intervalMs?setInterval(wake,intervalMs):null;timer?.unref();
  function close(){closing=true;clearInterval(timer);if(!running)db.close();}
  return {enqueue,flush,wake,close};
}
