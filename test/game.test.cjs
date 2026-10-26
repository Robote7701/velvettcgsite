const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const storage = require('../save-storage.js');
const profileInfo = require('../profile-info.js');
const portraitInfo = require('../portrait-info.js');
const audioInfo = require('../booster-audio.js');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const profiles = JSON.parse(fs.readFileSync(require.resolve('../data/personalities.json'), 'utf8')).profiles;

// Run the actual inline game. Only network bootstrapping is disabled.
function game(saved = null, failWrite = false, reducedMotion = false) {
  const elements = new Map();
  const writes = [];
  const timers = new Map();
  let timerId = 0;
  const classes = () => ({ add() {}, remove() {}, toggle() {}, contains() { return false; } });
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: id === 'collectionFilter' ? 'all' : '', style: {}, classList: classes(), textContent: '', innerHTML: '', attributes: {}, setAttribute(key,value) { this.attributes[key]=value; }, focus() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    VelvetStorage: storage, VelvetProfiles:profileInfo, VelvetPortraits:portraitInfo, VelvetAudio:audioInfo, console: { warn() {} }, URLSearchParams, URL,
    localStorage: { getItem: key => key === storage.KEY ? saved : null, setItem(key, value) { if (failWrite) throw Error('quota'); writes.push([key, value]); if(key===storage.KEY)saved=value; } },
    document: { getElementById: element, querySelector: () => element('notice'), querySelectorAll: () => [], addEventListener() {}, body: { classList: classes() } },
    window: { addEventListener() {}, scrollTo() {}, matchMedia: () => ({ matches: reducedMotion }) },
    setInterval() {}, setTimeout(callback, delay) { timers.set(++timerId, {callback, delay}); return timerId; }, clearTimeout(id) { timers.delete(id); }, confirm: () => true, alert() {}
  });
  vm.runInContext(script.replace(/^loadProfilesDatabase\(\);$/m, '').replace(/^loadPortraits\(\);$/m, ''), context);
  return { run: code => vm.runInContext(code, context), writes, element, timers, tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); } };
}

test('100 stable identities match the JSON catalogue; two volumes of 50', () => {
  const g = game();
  const cards = JSON.parse(g.run('JSON.stringify(cards)'));
  assert.equal(cards.length, 100);
  assert.equal(new Set(cards.map(c => c.id)).size, 100);
  assert.deepEqual(cards.map(c => [c.id, c.name, c.rarity]), profiles.map(p => [p.id, p.stage_name, p.rarity]));
  assert.deepEqual(cards.map(c => c.id), Array.from({ length: 100 }, (_, i) => i + 1));
  for (const edition of [1, 2]) {
    g.run(`selectedEdition=${edition};`);
    const ids = new Set();
    // Visit the first and last entry in each weighted group.
    for (const r of [0, .04, .20, .55]) for (const position of [0, .999999]) {
      const id = g.run(`{let values=[${r},${position}];Math.random=()=>values.shift();pick().id}`);
      ids.add(id);
      assert.ok(id >= (edition - 1) * 50 + 1 && id <= edition * 50);
    }
    assert.ok(ids.has((edition - 1) * 50 + 1));
    assert.ok(ids.has(edition * 50));
  }
  assert.ok(cards.slice(50).every(c => c.rarity === 'Commune'), 'Volume II unchanged');
});

test('exact probability boundaries: 4%, 16%, 35%, 45% in both volumes', () => {
  const g = game();
  for (const edition of [1, 2]) {
    g.run(`selectedEdition=${edition}`);
    for (const [r, first, last] of [[0,1,5],[.039999,1,5],[.04,6,12],[.199999,6,12],[.20,13,22],[.549999,13,22],[.55,23,50],[.999999,23,50]]) {
      for (const [position, expected] of [[0,first],[.999999,last]]) {
        assert.equal(g.run(`{let values=[${r},${position}];Math.random=()=>values.shift();pick().id}`), expected + (edition-1)*50);
      }
    }
    const counts = [0,0,0,0];
    for (let i=0; i<100; i++) {
      const id = g.run(`{let values=[${(i+.5)/100},0];Math.random=()=>values.shift();pick().id}`) - (edition-1)*50;
      counts[id <= 5 ? 0 : id <= 12 ? 1 : id <= 22 ? 2 : 3]++;
    }
    assert.deepEqual(counts,[4,16,35,45]);
  }
});

for (const batch of [1,3,5,10]) test(`x${batch}: five cards per booster, saved before interrupted reveal`, () => {
  const g = game();
  g.run(`Math.random=()=>0;selectBatch(${batch});openPack()`);
  assert.equal(g.run('packPulls.length'), batch*5);
  assert.equal(g.run('state.owned[1]'), batch*5);
  const persisted = JSON.parse(g.writes.at(-1)[1]);
  assert.equal(persisted.owned[1], batch*5);
  assert.equal(persisted.tickets, 10-batch);
  g.run('closeBoosterOverlay()');
  assert.equal(g.run('revealBusy'), false);
  assert.equal(g.run('state.owned[1]'), batch*5);
  assert.equal(game(JSON.stringify(persisted)).run('state.owned[1]'),batch*5);
});

for(const batch of [3,5,10]) test(`x${batch}: one opening lets every card in the lot be revealed before the final summary`,()=>{
  for(const edition of [1,2]) {
    const g=game();
    g.run(`Date.now=()=>10000000;state.ticketAt=10000000;var randomCalls=0;Math.random=()=>{randomCalls++;return .3};selectEdition(${edition});selectBatch(${batch});openPack()`);
    const saved=g.run('JSON.stringify(state)'), writes=g.writes.length;
    assert.equal(g.run('randomCalls'),batch*10);
    assert.match(g.element('overlayContent').innerHTML,new RegExp('Ouverture de '+batch+' boosters'));
    assert.equal(g.timers.size,1);
    g.run('openPack()');
    g.tick();
    for(let index=1;index<=batch*5;index++) {
      const reveal=g.element('overlayContent').innerHTML;
      assert.equal(g.run('revealIndex'),index);
      assert.match(reveal,new RegExp('CARTE '+index+' / '+batch*5+'<'));
      assert.match(reveal,/id="revealCard"/);
      assert.doesNotMatch(reveal,/batch-result-grid|BOOSTER SUIVANT/);
      assert.equal(g.timers.size,0,'cards wait for the player instead of advancing automatically');
      g.run('nextReveal()');
    }
    const result=g.element('overlayContent').innerHTML;
    assert.match(result,new RegExp(batch*5+' cartes obtenues'));
    assert.match(result,/batch-result-grid/);
    assert.match(result,new RegExp('batch-duplicate">×'+batch*5));
    assert.doesNotMatch(result,/nextPack|revealCard|BOOSTER SUIVANT/);
    assert.equal(g.timers.size,0);
    g.run('openPack()');
    assert.equal(g.run('randomCalls'),batch*10);
    assert.equal(g.run('JSON.stringify(state)'),saved);
    assert.equal(g.writes.length,writes);
    g.run('finishReveal()');
  }
});

test('closing the intro cancels its timer; reduced motion and early reveal never skip a card', () => {
  const g=game(null,false,true);
  g.run('Math.random=()=>0;openPack()');
  assert.ok([...g.timers.values()][0].delay<=200,'no long animated wait with reduced motion');
  g.run('finishReveal()');
  assert.equal(g.timers.size,0);
  assert.equal(g.run('state.owned[1]'),5);
  g.run('openPack();nextReveal()');
  assert.equal(g.timers.size,0,'early reveal cancels the pending introduction');
  assert.equal(g.run('revealIndex'),1);
  assert.equal(g.run('state.owned[1]'),10);
  g.run('finishReveal()');
});

test('a single booster still reveals its five saved cards one by one, common first and legendary last', () => {
  const g=game();
  const draws=[1,14,8,25,23], expected=[25,23,14,8,1];
  g.run(`Date.now=()=>10000000;state.ticketAt=10000000;var draws=${JSON.stringify(draws)},drawIndex=0;pick=()=>cards[draws[drawIndex++]-1];openPack()`);
  const saved=g.run('JSON.stringify(state)'), writes=g.writes.length;
  assert.deepEqual(JSON.parse(g.run('JSON.stringify(packPulls.map(c=>c.id))')),draws);
  g.tick();
  for(let index=0;index<5;index++) {
    const name=profiles[expected[index]-1].stage_name;
    assert.ok(g.element('overlayContent').innerHTML.includes('<div class="reveal-name">'+name+'</div>'));
    g.run('nextReveal()');
  }
  assert.match(g.element('overlayContent').innerHTML,/Vos 5 cartes/);
  assert.deepEqual(JSON.parse(g.run('JSON.stringify(packPulls.map(c=>c.id))')),draws);
  assert.equal(g.run('drawIndex'),5);
  assert.equal(g.run('JSON.stringify(state)'),saved);
  assert.equal(g.writes.length,writes);
});

test('the combined pile reveals duplicates individually, common cards first, and counts all cards in its summary',()=>{
  const g=game(),draws=[1,14,8,25,23,6,24,2,13,3,22,7,50,5,23];
  const expected=[25,23,24,50,23,14,13,22,8,6,7,1,2,3,5];
  g.run(`var draws=${JSON.stringify(draws)},drawIndex=0;pick=()=>cards[draws[drawIndex++]-1];selectBatch(3);openPack()`);
  const persisted=JSON.parse(g.writes.at(-1)[1]);
  g.tick();
  for(const id of expected) {
    const reveal=g.element('overlayContent').innerHTML;
    assert.ok(reveal.includes('<div class="reveal-name">'+profiles[id-1].stage_name+'</div>'));
    g.run('nextReveal()');
  }
  const result=g.element('overlayContent').innerHTML;
  const ids=[...result.matchAll(/<span>#(\d{3})<\/span>/g)].map(match=>Number(match[1]));
  assert.deepEqual(ids,[23,24,25,50,13,14,22,6,7,8,1,2,3,5]);
  assert.match(result,/14 personnalités différentes/);
  assert.match(result,/batch-duplicate">×2/);
  const totals=[...result.matchAll(/class="drop-result \w+"><strong>(\d+)<\/strong>/g)].map(match=>Number(match[1]));
  assert.deepEqual(totals,[5,3,3,4]);
  assert.equal(totals.reduce((sum,count)=>sum+count,0),15);
  assert.equal(persisted.owned[23],2);
  assert.deepEqual(JSON.parse(g.run('JSON.stringify(packPulls.map(c=>c.id))')),draws);
});

test('closing or explicitly skipping halfway through x10 preserves all fifty saved draws',()=>{
  for(const action of ['closeBoosterOverlay()','showBatchSummary()']) {
    const g=game();
    g.run('Date.now=()=>10000000;state.ticketAt=10000000;var randomCalls=0;Math.random=()=>{randomCalls++;return 0};selectBatch(10);openPack()');
    const saved=g.run('JSON.stringify(state)'),writes=g.writes.length;
    g.tick();
    for(let index=1;index<25;index++)g.run('nextReveal()');
    assert.match(g.element('overlayContent').innerHTML,/CARTE 25 \/ 50/);
    assert.match(g.element('overlayContent').innerHTML,/Tout révéler et voir le bilan/);
    g.run(action);
    if(action.startsWith('show'))assert.match(g.element('overlayContent').innerHTML,/50 cartes obtenues/);
    else {
      assert.equal(g.run('revealBusy'),false);
      g.run('nextReveal()');
      assert.equal(g.element('overlayContent').innerHTML,'');
    }
    assert.equal(g.run('randomCalls'),100);
    assert.equal(g.run('JSON.stringify(state)'),saved);
    assert.equal(g.writes.length,writes);
    assert.equal(g.timers.size,0);
    assert.equal(game(saved).run('state.owned[1]'),50);
  }
});

test('displayed drop rates match actual card rarities in both volumes without changing the save',()=>{
  const g=game(), before=g.run('JSON.stringify(state)'), writes=g.writes.length;
  for(const [edition,expected] of [[1,[45,35,16,4]],[2,[100,0,0,0]]]) {
    g.run(`selectEdition(${edition})`);
    const rates=JSON.parse(g.run('JSON.stringify(dropRates().map(rate=>Math.round(rate.probability*100)))'));
    assert.deepEqual(rates,expected);
    const shown=[...g.element('dropRates').innerHTML.matchAll(/<strong>(\d+) %<\/strong>/g)].map(match=>Number(match[1]));
    assert.deepEqual(shown,expected);
    assert.equal(rates.reduce((sum,value)=>sum+value,0),100);
  }
  assert.match(g.element('dropRateNote').textContent,/50 cartes sont actuellement communes/);
  assert.equal(g.run('JSON.stringify(state)'),before);
  assert.equal(g.writes.length,writes);
});

test('Volume II keeps its existing common rarities and stable draw order', () => {
  const g=game(), draws=[100,51,88,67,59];
  g.run(`var draws=${JSON.stringify(draws)},drawIndex=0;pick=()=>cards[draws[drawIndex++]-1];selectEdition(2);openPack()`);
  assert.deepEqual(JSON.parse(g.run('JSON.stringify(revealCards.map(c=>c.id))')),draws);
  assert.equal(g.run('revealCards.every(c=>c.rarity==="Commune")'),true);
});

test('sound controls update both buttons and only store a separate audio preference', () => {
  const g=game(), before=g.run('JSON.stringify(state)');
  g.run('toggleBoosterSound()');
  assert.equal(g.element('soundToggle').attributes['aria-pressed'],'false');
  assert.equal(g.element('overlaySoundToggle').attributes['aria-label'],'Activer les sons');
  assert.deepEqual(g.writes.at(-1),[audioInfo.PREFERENCE_KEY,'1']);
  g.run('toggleBoosterSound()');
  assert.equal(g.element('soundToggle').attributes['aria-pressed'],'true');
  assert.deepEqual(g.writes.at(-1),[audioInfo.PREFERENCE_KEY,'0']);
  assert.equal(g.run('JSON.stringify(state)'),before);
  assert.ok(g.writes.every(([key])=>key===audioInfo.PREFERENCE_KEY));
});

test('100 credits per missing booster, tickets consumed first; insufficient balance changes nothing', () => {
  const g = game();
  g.run('state.tickets=2;state.coins=600;selectBatch(5);openPack()');
  assert.equal(g.run('state.coins'),300);
  assert.equal(g.run('state.tickets'),0);
  const poor = game();
  poor.run('state.tickets=0;state.coins=99;selectBatch(1);openPack()');
  assert.equal(poor.run('state.coins'),99);
  assert.equal(poor.run('Object.keys(state.owned).length'),0);
});

test('one ticket every five minutes, remainder retained, cap at ten; future clock handled', () => {
  const g = game();
  g.run('Date.now=()=>10000000;state.tickets=2;state.ticketAt=10000000-299999;refillTickets()');
  assert.equal(g.run('state.tickets'),2);
  g.run('state.ticketAt=10000000-300000;refillTickets()');
  assert.equal(g.run('state.tickets'),3);
  g.run('state.ticketAt=10000000-650000;refillTickets()');
  assert.equal(g.run('state.tickets'),5);
  assert.equal(g.run('state.ticketAt'),9950000);
  g.run('state.ticketAt=0;refillTickets()');
  assert.equal(g.run('state.tickets'),10);
  g.run('state.tickets=1;state.ticketAt=10000001;refillTickets()');
  assert.equal(g.run('state.ticketAt'),10000000);
  assert.equal(g.run('state.tickets'),1);
});

test('storage failure during opening keeps gains exportable and does not block reveal', () => {
  const g = game(null, true);
  g.run('openPack()');
  assert.equal(g.run('packPulls.length'),5);
  assert.equal(g.run('revealBusy'),true);
  assert.match(g.element('saveStatus').textContent,/Enregistrement impossible/);
  assert.equal(Object.values(JSON.parse(g.run('saveStorage.export(state)')).state.owned).reduce((a,b)=>a+b,0),5);
  g.run('finishReveal()');
  assert.equal(g.run('revealBusy'),false);
});

test('free credits, DEBUG refill and selectable batches remain available', () => {
  const g = game();
  g.run('claimCredits();state.tickets=0;debugAddTickets()');
  assert.equal(g.run('state.coins'),1100);
  assert.equal(g.run('state.tickets'),10);
  assert.deepEqual([...html.matchAll(/data-count="(\d+)"/g)].map(m=>Number(m[1])),[1,3,5,10]);
  assert.match(html,/DEBUG/);
});

test('UI export/import restores state and refreshes collection', async () => {
  const g=game();
  g.run('state.owned[100]=9;state.favorites[100]=true;state.coins=321;var downloaded;downloadSave=(text)=>{downloaded=text};exportSave();state.owned={};state.favorites={};state.coins=0');
  await g.run('importSave({files:[{text:async()=>downloaded}],value:"selected"})');
  assert.equal(g.run('state.owned[100]'),9);
  assert.equal(g.run('state.favorites[100]'),true);
  assert.equal(g.run('state.coins'),321);
  assert.equal(g.element('ownedCount').textContent,1);
  assert.match(g.element('saveStatus').textContent,/importée et enregistrée/);
});

test('UI rejects invalid imports, cancellation, active reveals and storage failure without replacing state', async () => {
  const imported='{"coins":200,"owned":{"100":8}}';
  for(const mode of ['invalid','cancel','reveal','quota']) {
    const g=game(null,mode==='quota');
    if(mode==='cancel')g.run('confirm=()=>false');
    if(mode==='reveal')g.run('openPack()');
    const before=g.run('JSON.stringify(state)');
    await g.run(`importSave({files:[{text:async()=>${JSON.stringify(mode==='invalid'?'bad json':imported)}}],value:"selected"})`);
    assert.equal(g.run('JSON.stringify(state)'),before,mode);
  }
});

test('encyclopedic card shows documented sections, hides missing fields and never writes player data', () => {
  const g=game();
  const before=g.run('JSON.stringify(state)');const writes=g.writes.length;
  g.run('cards[99].profile={...VelvetProfiles.defaults(),id:100,stage_name:cards[99].name,height:"170cm",career_start_year:2010,sources:[{id:"fixture",provider:"Source de test",url:"https://example.org/fixture",retrieved_at:"2026-01-02T12:00:00Z"}],field_sources:{height:["fixture"],career_start_year:["fixture"]}};showCard(100)');
  const result=g.element('modalCard').innerHTML;
  for(const heading of ['Présentation','Mensurations','Carrière et notoriété','Sources'])assert.ok(result.includes(heading));
  assert.doesNotMatch(result,/Non renseigné|Récompenses|Pourquoi cette personnalité est-elle connue/);
  assert.match(result,/170cm/);
  assert.match(result,/VOL\. 02/);
  assert.equal(g.run('JSON.stringify(state)'),before);
  assert.equal(g.writes.length,writes);
  g.run('cards[99].profile=undefined;showCard(100)');
  assert.doesNotMatch(g.element('modalCard').innerHTML,/Mensurations|Carrière et notoriété|id="profile-sources"|Non renseigné/);
});

test('catalogue validates all 100 profiles before attaching any; game rarity stays unchanged', async () => {
  const g=game();
  const bad=structuredClone(profiles);bad.at(-1).stage_name='Incorrect';
  g.run(`fetch=async()=>({ok:true,json:async()=>(${JSON.stringify({profiles:bad})})})`);
  await g.run('loadProfilesDatabase()');
  assert.equal(g.run('cards.some(c=>c.profile!==undefined)'),false);
  g.run(`fetch=async()=>({ok:true,json:async()=>(${JSON.stringify({profiles})})})`);
  const before=g.run('JSON.stringify(state)');const writes=g.writes.length;
  await g.run('loadProfilesDatabase()');
  assert.equal(g.run('cards.filter(c=>c.profile).length'),100);
  assert.equal(g.run('cards.slice(50).every(c=>c.rarity==="Commune")'),true);
  assert.equal(g.run('JSON.stringify(state)'),before);
  assert.equal(g.writes.length,writes);
});

test('local portrait loading and image failures keep a fallback without touching player saves',async()=>{
 const g=game();
 const entry={src:'assets/portraits/1.jpg',url:'https://commons.wikimedia.org/wiki/File:Example.jpg',license_name:'CC BY-SA 4.0',license:'CC BY-SA 4.0 · Photographer',license_url:'https://creativecommons.org/licenses/by-sa/4.0/',artist:'Photographer',sha256:'a'.repeat(64),retrieved_at:'2026-01-02T12:00:00Z',review_status:'approved'};
 const before=g.run('JSON.stringify(state)');const writes=g.writes.length;
 g.run(`fetch=async()=>({ok:true,json:async()=>(${JSON.stringify({schema_version:1,portraits:{1:entry}})})})`);
 await g.run('loadPortraits()');
 assert.match(g.run('cardHtml(cards[0])'),/assets\/portraits\/1.jpg/);
 assert.match(g.run('cardHtml(cards[0])'),/card-monogram/);
 g.run('var brokenImage={hidden:false};portraitFailed(1,brokenImage)');
 assert.equal(g.run('brokenImage.hidden'),true);
 assert.doesNotMatch(g.run('cardHtml(cards[0])'),/<img/);
 assert.match(g.run('cardHtml(cards[0])'),/card-monogram/);
 assert.equal(g.run('JSON.stringify(state)'),before);assert.equal(g.writes.length,writes);
});
