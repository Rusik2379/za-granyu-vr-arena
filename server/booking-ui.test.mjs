import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('the actual form summary enables submission only with a time, valid fields and both consents',()=>{
 const source=readFileSync(new URL('../dist/booking.js',import.meta.url),'utf8');
 const summary=source.slice(source.indexOf('    function summary()'),source.indexOf('    function updateQuantity()'));
 const fields=Object.fromEntries(['name','phone','quantity','terms','consent','website','email'].map(key=>[key,{value:'',checked:false,willValidate:true,validity:{valid:true},disabled:false}]));
 fields.quantity.value='1';
 const nodes={};const submit={disabled:true};
 const context=vm.createContext({field:key=>fields[key],element:{elements:Object.values(fields),querySelector:key=>nodes[key]||= {}},submit,
   selectedRange:{priceMinor:120000},opts:{},settings:{},busy:false,locked:false,slotsLoading:false,calendarLoading:false});
 vm.runInContext(summary,context);
 const update=()=>vm.runInContext('summary()',context);
 update();assert.equal(submit.disabled,true);
 fields.name.value='Проверка';fields.phone.value='+7 913 257-00-33';update();assert.equal(submit.disabled,true);
 fields.terms.checked=true;update();assert.equal(submit.disabled,true);
 fields.consent.checked=true;update();assert.equal(submit.disabled,false);
 fields.phone.value='+7 913';update();assert.equal(submit.disabled,true);
 fields.phone.value='+7 913 257-00-33';fields.name.value='  ';update();assert.equal(submit.disabled,true);
 fields.name.value='Проверка';fields.email.validity.valid=false;update();assert.equal(submit.disabled,true);
 fields.email.validity.valid=true;fields.consent.checked=false;update();assert.equal(submit.disabled,true);
 fields.consent.checked=true;context.slotsLoading=true;update();assert.equal(submit.disabled,true);
 context.slotsLoading=false;context.selectedRange=null;update();assert.equal(submit.disabled,true);
});
