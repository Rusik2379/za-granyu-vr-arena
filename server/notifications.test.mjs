import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createBookingNotifications,bookingNotification} from './booking-notifications.mjs';

test('notification retries survive restart and keep the same idempotency key after a lost response',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'zg-notify-')),databasePath=join(directory,'test.sqlite');
 let time=100000,attempts=0;const received=[];
 const options={databasePath,url:'https://gateway.example.test/leads/site-test',now:()=>time,intervalMs:0,
  transport:async(url,input)=>{received.push(input);if(++attempts===1)throw new Error('Lost response');return new Response(JSON.stringify({delivery_id:12,status:'pending',duplicate:true}),{status:202});}};
 let queue=createBookingNotifications(options);
 try{
  queue.enqueue('test-request-1',{name:'Test',phone:'+79132570033',fields:{date:'test'}});
  queue.enqueue('test-request-1',{name:'Duplicate',fields:{}});
  await queue.flush();queue.close();time+=16000;queue=createBookingNotifications(options);
  await queue.flush();await queue.flush();
  assert.equal(received.length,2);assert.equal(received[0].body,received[1].body);
  assert.equal(received[0].headers['Idempotency-Key'],received[1].headers['Idempotency-Key']);
  const db=new DatabaseSync(databasePath),row=db.prepare('SELECT state,payload,delivery_id FROM booking_notifications').get();db.close();
  assert.equal(row.state,'accepted');assert.equal(row.payload,'{}');assert.equal(row.delivery_id,12);
 }finally{queue.close();rmSync(directory,{recursive:true,force:true});}
});

test('an enqueue rolled back with a booking transaction is never delivered',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'zg-notify-tx-')),databasePath=join(directory,'test.sqlite');
 let count=0;const queue=createBookingNotifications({databasePath,url:'https://gateway.example.test/leads/test',intervalMs:0,transport:async()=>{count++;return new Response('{}');}});
 const db=new DatabaseSync(databasePath);
 try{
  db.exec('BEGIN IMMEDIATE');queue.enqueue('rollback-request',{fields:{}},db);db.exec('ROLLBACK');
  await queue.flush();assert.equal(count,0);
 }finally{db.close();queue.close();rmSync(directory,{recursive:true,force:true});}
});

test('a booking notification states the real interval and keeps a manual discount distinct from the CRM total',()=>{
 const payload=bookingNotification({name:'Тест',phone:'+79132570033',guests:3,message:'Проверка'},
  {id:'crm-id',requestId:'request-id',service:'Одиночная игра',start:'2026-11-28T03:00:00Z',end:'2026-11-28T05:00:00Z',timezone:'Asia/Barnaul',durationMinutes:120,priceLabel:'2 400 ₽',discountPercent:5,quote:{totalLabel:'2 280 ₽'}});
 assert.equal(payload.fields['Время игры'],'10:00 — 12:00');assert.equal(payload.fields['Гостей'],3);
 assert.equal(payload.budget,'2 400 ₽');assert.match(payload.description,/2 280 ₽/);assert.match(payload.description,/администратор/);
 assert.equal(payload.fields['BookNow ID'],'crm-id');
});
