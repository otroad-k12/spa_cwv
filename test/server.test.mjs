import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHandler } from '../src/server.js';

const origin='https://demo.example';
const sample={session:'123e4567-e89b-12d3-a456-426614174000',metricId:'metric_1',name:'LCP',value:1200,route:'welcome',navigation:'hard',device:'desktop'};
const records=[];
const db={async query(_sql,args){if(args.length===7){records.push(args);return {rows:[]}}return {rows:records.map(r=>({name:r[2],value:r[3],route:r[4],navigation:r[5],device:r[6],recorded_at:'2026-11-12T00:00:00Z'}))}}};
const handler=createHandler({db,token:'test-secret',html:'<!doctype html><title>Demo</title>'});
async function call(path,{method='GET',originHeader,authorization,data}={}) {
  const req=Readable.from(data?[JSON.stringify(data)]:[]);
  req.url=path;req.method=method;req.headers={host:'demo.example',...(originHeader?{origin:originHeader}:{}),...(authorization?{authorization}:{})};
  const response={writeHead(status,headers){this.status=status;this.headers=headers},end(value){this.value=value}};
  await handler(req,response);return response;
}
test('ingest, origin validation, protected report, and deep link',async()=>{
  let result=await call('/api/events',{method:'POST',originHeader:origin,data:sample});
  assert.equal(result.status,202);assert.equal(records.length,1);
  result=await call('/api/events',{method:'POST',originHeader:'https://other.example',data:sample});
  assert.equal(result.status,403);
  result=await call('/api/events',{method:'POST',originHeader:origin,data:{...sample,name:'FCP'}});
  assert.equal(result.status,400);
  result=await call('/api/report');assert.equal(result.status,401);
  result=await call('/api/report?days=7',{authorization:'Bearer test-secret'});
  assert.equal(result.status,200);assert.equal(JSON.parse(result.value).events.length,1);
  result=await call('/preferences');assert.equal(result.status,200);assert.match(result.value,/Demo/);
});
