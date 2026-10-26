const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const info=require('../profile-info.js');
const {mergeClaims,tpdbClaims,enrich}=require('../scripts/profile-enrichment.cjs');
const profile=()=>({id:1,stage_name:'Exemple Documentaire',rarity:'Commune',...info.defaults()});
const source=(id='a')=>({id,provider:'Documentation de test',url:'https://example.org/'+id,retrieved_at:'2026-01-02T12:00:00.000Z'});
const claim=(field,value,id='a')=>({field,value,source:source(id)});

test('all 100 encyclopedic profiles preserve catalogue IDs and have the new fields',()=>{
 const db=JSON.parse(fs.readFileSync(require.resolve('../data/personalities.json'),'utf8'));
 assert.equal(db.schema_version,2);assert.equal(db.profiles.length,100);
 for(const p of db.profiles){assert.doesNotThrow(()=>info.validate(p));for(const field of info.fields)assert.ok(Object.hasOwn(p,field));}
 assert.equal(new Set(db.profiles.map(p=>p.id)).size,100);
});
test('age uses the Paris calendar, birthday boundaries, leap dates and a documented death date',()=>{
 assert.equal(info.age('2000-10-24','2026-10-23'),25);
 assert.equal(info.age('2000-10-23','2026-10-23'),26);
 assert.equal(info.age('2000-02-29','2026-02-28'),25);
 assert.equal(info.age('2000-02-29','2026-03-01'),26);
 assert.equal(info.age('2000-02-30','2026-10-23'),null);
 assert.equal(info.age('2030-01-01','2026-10-23'),null);
 assert.equal(info.today(new Date('2026-10-22T22:30:00Z')),'2026-10-23');
 const p=mergeClaims(profile(),[claim('birth_date','1980-01-01'),claim('death_date','2020-01-01')]);
 assert.match(info.render(p),/Âge au décès<\/dt><dd>40 ans/);
});
test('TPDB maps only documented metadata and keeps original measurement notation',()=>{
 const record={id:'test-record',name:profile().stage_name,aliases:['Alias test'],extras:{nationality:'French',birthplace:'Une région, France',birthplace_code:'FR',birthday:'1990-06-15',career_start_year:2010,career_end_year:2020,height:'170cm',measurements:'34B-24-35'},bio:'Promotional material',image:'https://example.org/portrait.jpg'};
 const p=mergeClaims(profile(),tpdbClaims(profile(),record,'2026-01-02T12:00:00.000Z'));
 assert.equal(p.birth_country,'France');assert.equal(p.birth_city,null);
 assert.equal(p.body_measurements,'34B-24-35');assert.equal(p.known_for,null);
 assert.equal(p.career_status,null);assert.deepEqual(p.activities,[]);
 assert.equal(p.sources[0].provider,'ThePornDB');assert.equal(p.sources[0].retrieved_at,'2026-01-02T12:00:00.000Z');
 assert.ok(p.field_sources.birth_date.length);
 assert.throws(()=>tpdbClaims(profile(),{...record,name:'Autre identité'},source().retrieved_at));
});
test('partial birthday never produces an exact age',()=>{
 for(const type of ['YEAR','MONTH_YEAR']){
  const claims=tpdbClaims(profile(),{id:'test',name:profile().stage_name,extras:{birthday:'1990-01-01',birthday_type:type}},source().retrieved_at);
  const p=mergeClaims(profile(),claims);assert.doesNotMatch(info.render(p),/Âge<\/dt>/);
 }
 const claims=tpdbClaims(profile(),{id:'test',name:profile().stage_name,extras:{birthday:'1990-01-01',birthday_type:'DAY_MONTH'}},source().retrieved_at);
 assert.equal(claims.some(c=>c.field==='birth_date'),false);
});
test('known_for requires two to four sentences with explicit evidence, never generated from a bio',()=>{
 assert.throws(()=>mergeClaims(profile(),[claim('known_for','Une seule phrase.')]));
 const text='Cette personnalité a publié une œuvre documentée. Elle a reçu une distinction explicitement sourcée.';
 const p=mergeClaims(profile(),[claim('known_for',text)]);
 assert.equal(p.known_for,text);assert.match(info.render(p),/œuvre documentée/);
 assert.throws(()=>info.validate({...profile(),known_for:text}));
 assert.equal(info.validSummary('A. B. C. D. E.'),false);
});
test('conflicting values are retained, flagged and hidden pending verification; import is idempotent',()=>{
 const p=mergeClaims(profile(),[claim('birth_date','1990-01-01')]);
 const next=mergeClaims(p,[claim('birth_date','1991-01-01','b')]);
 assert.equal(p.conflicts.length,0);
 assert.equal(next.birth_date,'1990-01-01');assert.equal(next.conflicts.length,1);
 assert.deepEqual(next.conflicts[0].values.map(v=>v.value),['1990-01-01','1991-01-01']);
 assert.equal(info.documented(next,'birth_date'),null);
 assert.match(info.render(next),/Divergences à vérifier/);
 assert.doesNotMatch(info.render(next),/Âge<\/dt>/);
 assert.deepEqual(mergeClaims(next,[claim('birth_date','1991-01-01','b')]),next);
});
test('unsupported schemes and HTML cannot execute in profile text or sources',()=>{
 assert.throws(()=>mergeClaims(profile(),[{field:'birth_city',value:'Test',source:{...source(),url:'javascript:alert(1)'}}]));
 const p=mergeClaims(profile(),[claim('birth_city','<img src=x onerror=alert(1)>')]);
 assert.ok(info.render(p).includes('&lt;img'));assert.ok(!info.render(p).includes('<img'));
 assert.throws(()=>mergeClaims(profile(),[claim('birth_date','1990-02-30')]));
 assert.throws(()=>mergeClaims(profile(),[claim('id',8)]));
 assert.throws(()=>mergeClaims(profile(),[{...claim('birth_city','Test'),source:{...source(),retrieved_at:'2026-02-30T00:00:00Z'}}]));
});
test('a malformed batch never mutates the original catalogue or its identities',()=>{
 const db={profiles:[profile()]};const before=structuredClone(db);
 assert.throws(()=>enrich(db,{provider:'ThePornDB',profiles:[{id:1,data:{id:'test',name:'Other person'},retrieved_at:source().retrieved_at}]}));
 assert.deepEqual(db,before);
});
test('a valid editorial batch enriches a copy and preserves game data',()=>{
 const db={profiles:[{...profile(),rarity:'Légendaire',attack:42}]};
 const before=structuredClone(db);
 const next=enrich(db,{format:'velvet-documentary-evidence',version:1,profiles:[{id:1,stage_name:profile().stage_name,claims:[claim('activities',['Activité documentée'])]}]});
 assert.deepEqual(db,before);assert.equal(next.profiles.length,1);
 assert.equal(next.profiles[0].rarity,'Légendaire');assert.equal(next.profiles[0].attack,42);
 assert.equal(next.profiles[0].stage_name,profile().stage_name);
 assert.deepEqual(next.profiles[0].activities,['Activité documentée']);
});
