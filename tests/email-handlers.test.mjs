import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
async function load(file) { const source=await fs.readFile(new URL('../'+file,import.meta.url),'utf8'); return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')); }
const {onRequestPost:subscribe}=await load('functions/api/subscribe.ts');
const {onRequestGet:dryRun,onRequestPost:drip,nextEmail}=await load('functions/api/drip-cron.ts');
const env={BREVO_API_KEY:'test-only',DRIP_CRON_SECRET:'cron-test-only',DRIP_ENABLED:'true',DRIP_TEMPLATE_IDS:'1,2,3,4,5,6,7,8,9,10,11,12'};
const request=(body,headers={})=>new Request('https://deadhangs.com/api/subscribe',{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
test('signup validates input and origin before contacting provider',async(t)=>{ let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('unexpected')});for(const [body,headers,status] of [[{email:'bad'},{},400],[{email:'a@example.com'},{origin:'https://elsewhere.test'},403],['{',{},400],[{email:'a@example.com'},{'content-type':'text/plain'},415],['x'.repeat(4097),{},413]])assert.equal((await subscribe({request:request(body,headers),env})).status,status);assert.equal(calls,0);});
test('signup records consent list, preserves existing sequences and handles provider failure',async(t)=>{let payload;t.mock.method(globalThis,'fetch',async(_url,options)=>{payload=JSON.parse(options.body);return new Response('',{status:201})});assert.equal((await subscribe({request:request({email:' a@example.com '}),env})).status,200);assert.equal(payload.email,'a@example.com');assert.equal(payload.updateEnabled,false);assert.deepEqual(payload.listIds,[3]);globalThis.fetch=async()=>new Response(JSON.stringify({code:'duplicate_parameter'}),{status:400});assert.equal((await subscribe({request:request({email:'a@example.com'}),env})).status,200);globalThis.fetch=async()=>new Response('provider detail',{status:500});const failed=await subscribe({request:request({email:'a@example.com'}),env});assert.equal(failed.status,502);assert.ok(!(await failed.text()).includes('provider detail'));});

const cronRequest=(secret='cron-test-only',method='POST',query='')=>new Request('https://deadhangs.com/api/drip-cron'+query,{method,headers:{'x-cron-secret':secret}});
const contact={email:'sample+test@example.com',attributes:{SIGNUP_DATE:'2026-01-01',DRIP_LAST_SENT:'-1'}};
const template={isActive:true,subject:'Training',sender:{email:'sender@example.com'},htmlContent:'<a href="{{ unsubscribe }}">Unsubscribe</a>'};
function mockBrevo(t, contacts=[contact], responder) {
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/smtp/templates/'))return Response.json(template);
    if(url.includes('/contacts/lists/'))return Response.json({contacts});
    return responder ? responder(url,options) : new Response(null,{status:options?.method==='POST'?201:204});
  });
  return calls;
}
test('sending requires dedicated credentials and explicit activation',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must not send')});
  assert.equal((await drip({request:cronRequest(),env:{}})).status,401);
  assert.equal((await drip({request:cronRequest('wrong'),env})).status,401);
  assert.equal((await drip({request:cronRequest('test-only'),env:{BREVO_API_KEY:'test-only',DRIP_ENABLED:'true'}})).status,401);
  assert.deepEqual(await(await drip({request:cronRequest(),env:{...env,DRIP_ENABLED:'false'}})).json(),{ok:true,enabled:false,dryRun:false,sent:0});
  assert.equal(calls,0);
});
test('GET reports due counts without sending or updating contacts, even when enabled',async(t)=>{
  const calls=mockBrevo(t,[contact,{...contact,emailBlacklisted:true},{...contact,attributes:{SIGNUP_DATE:'2026-02-30',DRIP_LAST_SENT:'-1'}}]);
  const result=await dryRun({request:cronRequest('cron-test-only','GET'),env});const body=await result.json();
  assert.equal(result.status,200);assert.equal(body.dryRun,true);assert.equal(body.due,1);assert.equal(body.skipped,2);assert.equal(body.sent,0);assert.equal(body.ready,true);
  assert.ok(calls.every(c=>!c.options.method));assert.ok(!JSON.stringify(body).includes(contact.email));
});
test('missing configuration and invalid mappings fail closed without provider calls',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('unexpected')});
  for(const value of [undefined,'1,2','1,'.repeat(11)+'1','1,2,3,4,5,6,7,8,9,10,11,0']){
    const result=await dryRun({request:cronRequest(),env:{...env,DRIP_TEMPLATE_IDS:value}});assert.equal(result.status,503);
  }
  const result=await dryRun({request:cronRequest(),env:{DRIP_CRON_SECRET:'cron-test-only'}});assert.equal(result.status,503);assert.equal(calls,0);
});
test('inactive templates and missing unsubscribe tokens block sending before contact lookup',async(t)=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{calls.push(url);return Response.json({...template,isActive:false,htmlContent:'missing'})});
  const result=await drip({request:cronRequest(),env});const body=await result.json();assert.equal(result.status,503);assert.equal(body.sent,0);assert.equal(body.ready,false);assert.equal(calls.length,12);assert.ok(calls.every(u=>u.includes('/smtp/templates/')));
});
test('rejected email is not marked sent',async(t)=>{
  const calls=mockBrevo(t,[contact],()=>new Response(null,{status:500}));const result=await drip({request:cronRequest(),env});
  assert.equal(result.status,502);assert.equal(calls.filter(c=>c.options.method==='PUT').length,0);assert.equal((await result.json()).sent,0);
});
test('accepted email updates encoded contact and skips unsubscribed contacts',async(t)=>{
  const calls=mockBrevo(t,[{...contact,emailBlacklisted:true},contact]);const body=await(await drip({request:cronRequest(),env})).json();
  assert.equal(body.sent,1);assert.equal(body.accepted,1);const update=calls.find(c=>c.options.method==='PUT');assert.equal(update.url,'https://api.brevo.com/v3/contacts/sample%2Btest%40example.com');assert.deepEqual(JSON.parse(update.options.body),{attributes:{DRIP_LAST_SENT:'0'}});
});
test('failed progress update records accepted count and requires review',async(t)=>{
  mockBrevo(t,[contact],(_url,options)=>new Response(null,{status:options.method==='POST'?201:500}));const result=await drip({request:cronRequest(),env});const body=await result.json();
  assert.equal(result.status,502);assert.equal(body.reviewRequired,true);assert.equal(body.sent,0);assert.equal(body.accepted,1);
});
test('network failure after accepted send also requires review',async(t)=>{
  mockBrevo(t,[contact],(_url,options)=>{if(options.method==='PUT')throw Error('network');return new Response(null,{status:201})});
  const body=await(await drip({request:cronRequest(),env})).json();assert.equal(body.reviewRequired,true);assert.equal(body.accepted,1);
});
test('dry run is bounded to 200 contacts and reports continuation',async(t)=>{
  const calls=mockBrevo(t,Array.from({length:50},()=>contact));const body=await(await dryRun({request:cronRequest(),env})).json();
  assert.equal(body.scanned,200);assert.equal(body.due,200);assert.equal(body.nextOffset,200);assert.equal(body.truncated,true);assert.equal(calls.length,16);
});
test('send batch is capped and reports the next unprocessed contact',async(t)=>{
  mockBrevo(t,Array.from({length:50},(_,i)=>({...contact,email:'test'+i+'@example.com'})));const body=await(await drip({request:cronRequest(),env})).json();
  assert.equal(body.sent,15);assert.equal(body.truncated,true);assert.equal(body.nextOffset,15);
});
test('next email excludes missing enrollment marker, malformed dates and completed sequences',()=>{
  const now=Date.parse('2026-09-11T12:00:00Z');
  for(const attrs of [{SIGNUP_DATE:'2026-01-01'},{SIGNUP_DATE:'2026-02-30',DRIP_LAST_SENT:-1},{SIGNUP_DATE:'2027-01-01',DRIP_LAST_SENT:-1},{SIGNUP_DATE:'2026-01-01',DRIP_LAST_SENT:11},{SIGNUP_DATE:'2026-01-01',DRIP_LAST_SENT:''}])assert.equal(nextEmail({...contact,attributes:attrs},now),-1);
  assert.equal(nextEmail(contact,now),0);
});
const {default:worker}=await load('workers/drip-cron/index.ts');
test('scheduled worker does nothing until explicitly enabled',async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>{throw Error('must not send')});await worker.scheduled({},{});
});
test('scheduled worker uses POST and dedicated secret; incomplete runs fail visibly',async(t)=>{
  let options;t.mock.method(globalThis,'fetch',async(_url,opts)=>{options=opts;return Response.json({ok:true,enabled:true,truncated:false})});
  const config={DRIP_ENABLED:'true',DRIP_CRON_SECRET:'cron-test-only',DRIP_ENDPOINT:'https://deadhangs.com/api/drip-cron'};
  await worker.scheduled({},config);assert.equal(options.method,'POST');assert.equal(options.headers['x-cron-secret'],'cron-test-only');
  globalThis.fetch=async()=>Response.json({ok:true,enabled:true,truncated:true});await assert.rejects(()=>worker.scheduled({},config),/incomplete/);
});
