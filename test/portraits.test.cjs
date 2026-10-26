const {test}=require('node:test');
const assert=require('node:assert/strict');
const portraits=require('../portrait-info.js');
const {candidates,imageKind}=require('../scripts/sync-portraits.cjs');
function entry(){return {src:'assets/portraits/1.jpg',url:'https://commons.wikimedia.org/wiki/File:Person.jpg',license_name:'CC BY-SA 4.0',license:'CC BY-SA 4.0 · Photographer',license_url:'https://creativecommons.org/licenses/by-sa/4.0/',artist:'Photographer',sha256:'a'.repeat(64),retrieved_at:'2026-01-02T12:00:00Z',review_status:'approved'};}
test('only approved portraits with local paths, attribution and a licence are accepted',()=>{
 assert.equal(portraits.valid(entry(),1),true);
 for(const patch of [{review_status:'pending'},{src:'https://example.org/portrait.jpg'},{src:'assets/portraits/../1.jpg'},{src:'assets/portraits/1.svg'},{artist:''},{license_url:'javascript:alert(1)'},{url:'https://example.org/File:Person.jpg'},{license_name:'All rights reserved'}])assert.equal(portraits.valid({...entry(),...patch},1),false);
 assert.throws(()=>portraits.validate({schema_version:1,portraits:{101:entry()}}));
});
test('candidate selection rejects other people, shared photographs and explicit descriptions',()=>{
 const profile={id:1,stage_name:'Example Person',aliases:['Unrelated Actress']};
 const make=(title,description='A portrait at an awards event')=>({title:'File:'+title,imageinfo:[{mime:'image/jpeg',width:600,height:900,thumburl:'https://upload.wikimedia.org/portrait.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:'+title,extmetadata:{LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'},Artist:{value:'Photographer'},ImageDescription:{value:description}}}]});
 assert.equal(candidates(profile,[make('Example Person cropped.jpg')],[profile]).length,1);
 assert.equal(candidates(profile,[make('Unrelated Actress.jpg')],[profile]).length,0);
 assert.equal(candidates(profile,[make('Unrelated Actress - Photo credit Example Person (cropped).jpg')],[profile]).length,0);
 assert.equal(candidates(profile,[make('Example Person with colleague.jpg')],[profile]).length,0);
 assert.equal(candidates(profile,[make('Example Person.jpg','A topless photograph')],[profile]).length,0);
 assert.equal(candidates(profile,[make('Example Person.jpg','A portrait of the adult performer at a public event')],[profile]).length,1);
});
test('downloaded HTML cannot masquerade as a portrait',()=>{
 assert.equal(imageKind(Buffer.from([255,216,255,1])),'jpg');
 assert.throws(()=>imageKind(Buffer.from('<html>Access denied</html>')));
});
