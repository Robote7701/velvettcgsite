const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const audio=require('../booster-audio.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(options={}) {
  const contexts=[];
  function parameter() {
    return {value:0,events:[],setValueAtTime(value,at){this.value=value;this.events.push([value,at]);},linearRampToValueAtTime(value,at){this.events.push([value,at]);},exponentialRampToValueAtTime(value,at){this.events.push([value,at]);},cancelScheduledValues(){}};
  }
  class AudioContext {
    constructor(){this.state=options.suspended?'suspended':'running';this.currentTime=0;this.sampleRate=8000;this.destination={};this.nodes=[];this.sources=[];contexts.push(this);}
    node(){const node={connect(){},disconnect(){this.disconnected=true;}};this.nodes.push(node);return node;}
    source(){const node=this.node();Object.assign(node,{start(at){this.started=at;},stop(at){this.stopped=at;},end(){this.onended?.();}});this.sources.push(node);return node;}
    createGain(){return Object.assign(this.node(),{gain:parameter()});}
    createOscillator(){return Object.assign(this.source(),{frequency:parameter()});}
    createBufferSource(){return this.source();}
    createBiquadFilter(){return Object.assign(this.node(),{Q:parameter(),frequency:parameter()});}
    createBuffer(channels,length){const samples=new Float32Array(length);return {getChannelData:()=>samples};}
    resume(){return Promise.resolve(options.resume?.()).then(()=>{this.state='running';});}
  }
  return {host:{AudioContext,document:{hidden:false}},contexts};
}

test('audio starts only after interaction, and mute persists outside player saves',async()=>{
  const f=fixture(), values=new Map([['velvet-v03','untouched'],[audio.PREFERENCE_KEY,'1']]);
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const sound=audio.create({host:f.host,storage});
  assert.equal(f.contexts.length,0);
  sound.play('open');await settle();
  assert.equal(f.contexts.length,0);
  sound.setMuted(false);sound.play('rare');await settle();
  assert.equal(f.contexts.length,1);
  assert.ok(f.contexts[0].sources.length>0);
  sound.setMuted(true);
  assert.ok(f.contexts[0].sources.every(source=>source.stopped<=.03));
  assert.equal(audio.create({host:f.host,storage}).muted,true);
  assert.equal(values.get('velvet-v03'),'untouched');
});

test('all effects synthesize locally without using the random generator for booster draws',async()=>{
  const sandboxMath=Object.create(Math);sandboxMath.random=()=>{throw Error('Draw RNG consumed');};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../booster-audio.js'),'utf8'),{module,Math:sandboxMath});
  const f=fixture(), sound=module.exports.create({host:f.host});
  for(const kind of ['open','common','rare','epic','gold','summary']) {
    const before=f.contexts[0]?.sources.length||0;
    sound.play(kind);await settle();
    const context=f.contexts[0];
    assert.ok(context.sources.length>before,kind);
    assert.ok(context.sources.every(source=>Number.isFinite(source.started)&&Number.isFinite(source.stopped)),kind);
    sound.stop();
  }
  const context=f.contexts[0];
  for(const source of context.sources)source.end();
  assert.ok(context.nodes.slice(1).every(node=>node.disconnected),'finished voices release their nodes');
});

test('closing or muting while audio resumes cancels pending sounds',async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const f=fixture({suspended:true,resume:()=>pending}), sound=audio.create({host:f.host});
  sound.play('open');sound.stop();release();await settle();
  assert.equal(f.contexts[0].sources.length,0);
  sound.play('gold');sound.setMuted(true);await settle();
  assert.equal(f.contexts[0].sources.length,0);
  sound.setMuted(false);sound.play('common');await settle();
  assert.ok(f.contexts[0].sources.length>0);
  const count=f.contexts[0].sources.length;
  f.host.document.hidden=true;sound.play('gold');await settle();
  assert.equal(f.contexts[0].sources.length,count,'a delayed reveal in a hidden tab stays silent');
});

test('unsupported audio, blocked playback and inaccessible preference storage fail silently',async()=>{
  const badStorage={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};
  for(const host of [{},{AudioContext:class {constructor(){throw Error('unavailable');}}},fixture({suspended:true,resume:()=>Promise.reject(Error('autoplay blocked'))}).host]) {
    const sound=audio.create({host,storage:badStorage});
    assert.doesNotThrow(()=>{sound.play('open');sound.setMuted(true);sound.setMuted(false);});
    await sound.unlock();await settle();
    assert.equal(sound.muted,false);
  }
});
