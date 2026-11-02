import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPromoService, normalizePhone} from './promo-core.mjs';

const options={secret:'test-only-secret-with-more-than-32-characters',prizes:[5,7,10,5,7,5],validityDays:14,choose:()=>2};
const input={name:'Тестовый гость',phone:'+7 (999) 000-00-01',clientToken:'a'.repeat(40),consent:true};

test('normalizes phone variants and rejects malformed numbers',()=>{
  assert.equal(normalizePhone('8 (999) 000-00-01'),normalizePhone('+7 999 000 00 01'));
  for(const value of ['123','+7 999 000 00 01 ext2','799900000011','+1 9990000001'])assert.throws(()=>normalizePhone(value));
});
test('one result per phone survives retry, number formatting, restart and another browser',()=>{
  const directory=mkdtempSync(join(tmpdir(),'zg-promo-'));
  const databasePath=join(directory,'promo.sqlite');
  let service=createPromoService({...options,databasePath});
  try {
    const first=service.claim({...input,discountPercent:99},'ip');
    assert.equal(first.discountPercent,10);
    const retry=service.claim({...input,phone:'8 (999) 000-00-01'},'ip');
    assert.equal(first.id,retry.id);assert.equal(retry.repeated,true);
    service.close();service=createPromoService({...options,databasePath});
    assert.equal(service.claim(input,'new-ip').id,first.id);
    assert.throws(()=>service.claim({...input,clientToken:'b'.repeat(40)},'new-ip'),{code:'ALREADY_PLAYED'});
  } finally {service.close();rmSync(directory,{recursive:true,force:true});}
});
test('consent, honeypot and per-IP throttling cannot be skipped',()=>{
  const service=createPromoService({...options,databasePath:':memory:'});
  try {
    assert.throws(()=>service.claim({...input,consent:false},'one'),{code:'CONSENT'});
    assert.throws(()=>service.claim({...input,website:'spam'},'two'),{code:'INVALID'});
    for(let i=0;i<20;i++)service.claim(input,'shared-ip');
    assert.throws(()=>service.claim(input,'shared-ip'),{code:'RATE_LIMIT'});
    assert.equal(service.claim({...input,phone:'+79990000002'},'other-ip').repeated,false);
  } finally {service.close();}
});
test('lead is durable before delivery and retries preserve one external id',async()=>{
  let time=1800000000000;
  const service=createPromoService({...options,databasePath:':memory:',now:()=>time});
  try {
    const first=service.claim(input,'ip');
    const delivered=[];
    await service.dispatch(async lead=>{delivered.push(lead);throw Error('Unavailable');});
    assert.equal(service.claim(input,'ip').delivery,'pending');
    time+=16000;
    await service.dispatch(async lead=>delivered.push(lead));
    assert.equal(delivered.length,2);assert.equal(delivered[0].id,first.id);assert.equal(delivered[1].id,first.id);
    assert.equal(delivered[1].phoneVerified,false);
    assert.equal(delivered[1].phone,'+79990000001');
    assert.equal(service.claim(input,'ip').delivery,'delivered');
    await service.dispatch(async()=>assert.fail('must not deliver again'));
  } finally {service.close();}
});
test('concurrent retries do not dispatch the same lead twice',async()=>{
  const service=createPromoService({...options,databasePath:':memory:'});
  try {
    service.claim(input,'ip');let calls=0;
    const sender=async()=>{calls++;await Promise.resolve();};
    await Promise.all([service.dispatch(sender),service.dispatch(sender)]);
    assert.equal(calls,1);
  } finally {service.close();}
});
