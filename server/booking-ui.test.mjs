import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('submit remains clickable for native field validation after choosing a time, but locks during requests',()=>{
 const source=readFileSync(new URL('../dist/booking.js',import.meta.url),'utf8');
 const summary=source.slice(source.indexOf('    function summary()'),source.indexOf('    function updateQuantity()'));
 const fields=Object.fromEntries(['name','phone','quantity','terms','consent','website','email'].map(key=>[key,{value:'',checked:false,willValidate:true,validity:{valid:true},disabled:false}]));
 fields.quantity.value='1';
 const nodes={};const submit={disabled:true};
 const context=vm.createContext({field:key=>fields[key],element:{elements:Object.values(fields),querySelector:key=>nodes[key]||= {}},submit,
   selectedRange:{priceMinor:120000},opts:{},settings:{},busy:false,locked:false,slotsLoading:false,calendarLoading:false});
 vm.runInContext(summary,context);
 const update=()=>vm.runInContext('summary()',context);
 update();assert.equal(submit.disabled,false);
 // Incomplete contacts and unchecked required consents must expose validation on click.
 fields.phone.value='+7 555 444-33-32';update();assert.equal(submit.disabled,false);
 fields.terms.checked=true;fields.consent.checked=true;update();assert.equal(submit.disabled,false);
 context.busy=true;update();assert.equal(submit.disabled,true);
 context.busy=false;context.slotsLoading=true;update();assert.equal(submit.disabled,true);
 context.slotsLoading=false;context.calendarLoading=true;update();assert.equal(submit.disabled,true);
 context.calendarLoading=false;context.locked=true;update();assert.equal(submit.disabled,true);
 context.locked=false;context.settings.preview=true;update();assert.equal(submit.disabled,true);
 context.settings.preview=false;context.selectedRange=null;update();assert.equal(submit.disabled,true);
});
