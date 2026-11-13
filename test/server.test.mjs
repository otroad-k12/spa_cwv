import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../src/server.js';

const origin='https://demo.example';
const id='123e4567-e89b-12d3-a456-426614174000';
const viewId='123e4567-e89b-12d3-a456-426614174001';
const view={action:'start',viewId,visitId:id,session:id,testerId:id,route:'welcome',navigation:'hard',browser:'Chrome',browserVersion:'151',device:'desktop',softSupported:true,clsSupported:true,libraryStatus:'pending',clientTime:new Date().toISOString()};
const sample={session:id,viewId,metricId:'metric_1',name:'LCP',value:1200,route:'welcome',navigation:'hard',device:'desktop'};
const records={views:[],events:[]};
const db={async query(sql,args){
  if(sql.includes('INSERT INTO rum_views')){records.views.push(args);return {rows:[]}}
  if(sql.includes('INSERT INTO rum_events')){records.events.push(args);return {rows:[]}}
  if(sql.includes('FROM rum_views'))return {rows:records.views.map(r=>({view_id:r[0],visit_id:r[1],session_id:r[2],tester_id:r[3],route:r[4],navigation:r[5],browser:r[6],browser_version:r[7],device:r[8],soft_supported:r[9],client_time:r[10],library_status:r[11],started_at:new Date().toISOString(),ended_at:r[12]||null,cls_supported:r[13]}))};
  if(sql.includes('FROM rum_events'))return {rows:records.events.map(r=>({name:r[2],value:r[3],route:r[4],navigation:r[5],device:r[6],view_id:r[7],recorded_at:new Date().toISOString()}))};
  return {rows:[]};
}};
const handler=createHandler({db,token:'test-secret',html:'<!doctype html><title>Demo</title>'});
async function call(path,{method='GET',originHeader,authorization,data}={}) {
  const req=Readable.from(data?[JSON.stringify(data)]:[]);
  req.url=path;req.method=method;req.headers={host:'demo.example',...(originHeader?{origin:originHeader}:{}),...(authorization?{authorization}:{})};
  const response={writeHead(status,headers){this.status=status;this.headers=headers},end(value){this.value=value}};
  await handler(req,response);return response;
}
test('view denominator, metric ingest, validation, protected report, deep link',async()=>{
  let result=await call('/api/views',{method:'POST',originHeader:origin,data:view});
  assert.equal(result.status,202);assert.equal(records.views.length,1);
  const missingView={...view,viewId:'123e4567-e89b-12d3-a456-426614174002',route:'profile',navigation:'soft',action:'end'};
  result=await call('/api/views',{method:'POST',originHeader:origin,data:missingView});
  assert.equal(result.status,202);assert.equal(records.views.length,2);
  result=await call('/api/events',{method:'POST',originHeader:origin,data:sample});
  assert.equal(result.status,202);assert.equal(records.events.length,1);
  result=await call('/api/views',{method:'POST',originHeader:'https://other.example',data:view});assert.equal(result.status,403);
  result=await call('/api/events',{method:'POST',originHeader:origin,data:{...sample,name:'FCP'}});assert.equal(result.status,400);
  result=await call('/api/report');assert.equal(result.status,401);
  result=await call('/api/report?days=7',{authorization:'Bearer test-secret'});
  assert.equal(result.status,200);const report=JSON.parse(result.value);assert.equal(report.events.length,1);assert.equal(report.views.length,2);assert.equal(report.events[0].view_id,report.views[0].view_id);
  assert.equal(report.views[1].route,'profile');
  assert.equal(report.views[0].cls_supported,true);
  assert.ok(report.views[1].ended_at);
  result=await call('/preferences');assert.equal(result.status,200);assert.match(result.value,/Demo/);
});
test('browser-detection output satisfies the view collector',async()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const start=html.indexOf('function browserInfo()');
  const end=html.indexOf('const softSupported=',start);
  const source=`const ua=navigator.userAgent;${html.slice(start,end)};({browser,browserVersion})`;
  for(const navigator of [
    {userAgent:'Chrome/151.0',userAgentData:{brands:[{brand:'Google Chrome',version:'151'}]}},
    {userAgent:'Mozilla/5.0 Version/19.0 Safari/605.1.15'}
  ]){
    const detected=runInNewContext(source,{navigator});
    assert.ok(detected.browserVersion,`${detected.browser} lacks browserVersion`);
    const response=await call('/api/views',{method:'POST',originHeader:origin,data:{...view,viewId:randomUUID(),browser:detected.browser,browserVersion:detected.browserVersion}});
    assert.equal(response.status,202);
  }
});
test('capture statuses exclude unsupported CLS and app-only transitions',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const start=html.indexOf('function viewStatus(');
  const end=html.indexOf('const viewType=',start);
  const status=runInNewContext(`${html.slice(start,end)};viewStatus`,{Date});
  const completed={view_id:'view',navigation:'hard',ended_at:new Date().toISOString(),library_status:'loaded'};
  assert.equal(status({...completed,browser:'Firefox',cls_supported:null},'CLS',new Map()),'Unsupported');
  assert.equal(status({...completed,browser:'Safari',cls_supported:false},'CLS',new Map()),'Unsupported');
  assert.equal(status({...completed,browser:'Google Chrome',cls_supported:true},'CLS',new Map()),'No value');
  assert.equal(status({...completed,navigation:'app',cls_supported:true},'LCP',new Map()),'Unsupported');
  assert.equal(status({...completed,browser:'Firefox',cls_supported:null},'LCP',new Map()),'No value');
});
test('portal browser-mix reference sums to its declared denominator',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const start=html.indexOf('const portalMix=');
  const end=html.indexOf('const percent=',start);
  const mix=runInNewContext(`${html.slice(start,end)};portalMix`);
  assert.equal(mix.softCandidate+mix.noSoft+mix.unclassified,mix.total);
  assert.equal(Math.round(1000*mix.softCandidate/mix.total)/10,41.6);
});
