const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KEY, validate, parse, create } = require('../save-storage.js');
function memory(initial = null) {
  const values = new Map(initial === null ? [] : [[KEY,initial]]);
  return { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key,value); }, raw:()=>values.get(KEY) ?? null };
}
test('legacy velvet-v03 saves retain coins, all card IDs, favorites and ticket time', () => {
  const old = { coins:1234, owned:{1:2,50:1,100:9}, favorites:{100:true,1:false}, tickets:4, ticketAt:123456, extra:'retained' };
  const m=memory(JSON.stringify(old));
  const store=create(m);
  assert.deepEqual(store.load(),old);
  assert.equal(m.raw(),JSON.stringify(old),'loading never writes');
  assert.equal(store.write(old),true);
  assert.deepEqual(JSON.parse(m.raw()),old);
});
test('old minimal save gains optional favorites without resetting the collection', () => {
  assert.deepEqual(parse('{"coins":0,"owned":{"100":3}}'),{coins:0,owned:{100:3},favorites:{}});
});
test('export/import round trip and raw legacy import', () => {
  const state={coins:600,owned:{100:7},favorites:{100:true},tickets:2,ticketAt:12345};
  const store=create(memory());
  assert.deepEqual(store.import(store.export(state)),state);
  assert.deepEqual(store.import(JSON.stringify(state)),state);
  assert.throws(()=>parse('{"format":"velvet-save","version":2,"state":{}}'));
});
test('invalid JSON and invalid types are rejected', () => {
  for(const value of [null,[],5,{coins:'600',owned:{}},{coins:-1,owned:{}},{coins:600,owned:[]},{coins:600,owned:{101:1}},{coins:600,owned:{1:-1}},{coins:600,owned:{1:1.5}},{coins:600,owned:{'01':1}},{coins:600,owned:{},favorites:{1:'yes'}},{coins:600,owned:{},tickets:11},{coins:600,owned:{},ticketAt:-1}]) {
    assert.throws(()=>validate(value));
  }
  assert.throws(()=>parse('{'));
});
test('corrupt existing save is never overwritten, original remains recoverable', () => {
  const m=memory('{broken');const messages=[];const store=create(m,m=>messages.push(m));
  const state=store.load();
  assert.equal(store.write(state),false);
  assert.equal(m.raw(),'{broken');
  assert.equal(store.original(),'{broken');
  assert.ok(messages.length>=2);
  assert.throws(()=>store.import('{"coins":-1}'));
  assert.equal(m.raw(),'{broken');
  store.import('{"coins":50,"owned":{"100":2}}');
  assert.equal(store.write({coins:51,owned:{100:2}}),true);
});
test('inaccessible storage and quota errors are handled; failed import does not return a replacement', () => {
  const messages=[];
  const store=create({getItem(){throw Error('denied')},setItem(){throw Error('quota')}},m=>messages.push(m));
  const state=store.load();
  assert.equal(store.write(state),false);
  assert.doesNotThrow(()=>store.export(state));
  assert.throws(()=>store.import('{"coins":600,"owned":{}}'),/denied/);
  assert.ok(messages.length>=2);
});
test('import backs up the exact previous save, including malformed data', () => {
  const m=memory('{broken');const store=create(m);
  store.load();
  store.import('{"coins":600,"owned":{"1":5}}');
  assert.equal(store.backup(),'{broken');
  assert.equal(JSON.parse(m.raw()).owned[1],5);
});
test('failed import storage write leaves the old save intact', () => {
  const original='{"coins":100,"owned":{"100":8}}';
  const m=memory(original);const messages=[];
  const store=create({getItem:m.getItem,setItem(key,value){if(key===KEY)throw Error('quota');m.setItem(key,value)}},m=>messages.push(m));
  store.load();
  assert.throws(()=>store.import('{"coins":600,"owned":{}}'),/quota/);
  assert.equal(m.raw(),original);
  assert.equal(store.backup(),original);
});
