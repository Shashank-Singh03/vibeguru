#!/usr/bin/env node
// Install the actual tarball in an isolated directory, exercise its wrapper and
// MCP server against a real browser, and retain a machine-readable result.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { beginSuite, finishSuite, sourceRevision } from "./lib/test-history.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const packageInfo=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
const flag=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1]};
const binary=path.resolve(flag("--binary")||process.env.VIBEGURU_BINARY||path.join(root,"vibeguru"));
assert.ok(fs.existsSync(binary),"Build the escript or pass --binary <native-asset>.");
const header=fs.readFileSync(binary).subarray(0,160).toString("utf8");
const mode=/^#![^\n]*\bescript\b/.test(header)?"escript":"native";
assert.ok(!process.argv.includes("--require-native")||mode==="native","Release checks require a native Burrito asset.");
const npmCandidates=[process.env.NPM_CLI_JS,process.env.npm_execpath,path.join(path.dirname(process.execPath),"node_modules/npm/bin/npm-cli.js"),path.resolve(path.dirname(process.execPath),"../lib/node_modules/npm/bin/npm-cli.js")];
const npmCli=npmCandidates.find(p=>p&&p.endsWith(".js")&&fs.existsSync(p));
assert.ok(npmCli,"Set NPM_CLI_JS to npm's bin/npm-cli.js.");
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"vibeguru-package-smoke-"));
const fixtureRoot=path.join(root,"test-app");
let fixture, cleanFixture;

function command(executable,args,{cwd=root,env=process.env,expected=0,timeout=360000}={}){
  return new Promise((resolve,reject)=>{
    const commandStarted=performance.now();
    const child=spawn(executable,args,{cwd,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";
    const timer=setTimeout(()=>{child.kill();reject(new Error(`Timed out: ${args[0]}`))},timeout);
    child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
    child.on("error",error=>{clearTimeout(timer);reject(error)});
    child.on("close",code=>{clearTimeout(timer);
      const name=args[0]===npmCli?`npm ${args[1]}`:args[0]?.endsWith("vibeguru.js")?`CLI ${args[1]||"usage"}`:"fixture verifier";
      timings.push({name,duration_ms:Math.round(performance.now()-commandStarted),exit_code:code,expected_exit:expected});
      code===expected?resolve(stdout):reject(new Error(`Expected exit ${expected}, got ${code}: ${(stdout+stderr).slice(-8000)}`))});
  });
}
const npm=(args,options)=>command(process.execPath,[npmCli,...args],options);
// Packaging checks must not populate a founder's real product analytics.
const env={...process.env,VIBEGURU_BINARY:binary,VIBEGURU_TELEMETRY:"0",DO_NOT_TRACK:"1"};
const install=path.join(scratch,"install");fs.mkdirSync(install);
const suite=beginSuite("Package smoke", "npm run test:package");
let smokePassed=false, smokeFailure=null;
const started=performance.now();
const timings=[];

try{
  const pack=JSON.parse(await npm(["pack","--json","--ignore-scripts","--pack-destination",scratch]));
  const packedFiles=new Set(pack[0].files.map(file=>file.path));
  for(const required of ["scripts/lib/doctor.js","scripts/lib/telemetry.js","scripts/lib/telemetry-cli.js","mcp/server.js","driver-node/index.js","LICENSE","docs/GETTING_STARTED.md"])assert.ok(packedFiles.has(required),`Missing customer runtime/documentation: ${required}`);
  for(const file of packedFiles)assert.ok(!/^(reports|dashboard|benchmarks|test|site)\/|__pycache__|scripts\/(context-map\.py|desktop-prepare\.py|lab\.mjs|adversarial-lab\.mjs)/.test(file),`Internal lab file leaked into customer package: ${file}`);
  fs.writeFileSync(path.join(install,"package.json"),'{"private":true}');
  await npm(["install","--ignore-scripts","--no-audit","--no-fund",path.join(scratch,pack[0].filename)],{cwd:install,env});
  const installed=path.join(install,"node_modules/vibeguru");
  console.log("Fresh tarball installed; checking CLI setup and usage.");
  const requireInstalled=createRequire(path.join(installed,"package.json"));
  assert.equal(requireInstalled("./package.json").version,packageInfo.version);
  assert.ok(fs.existsSync(path.join(installed,"LICENSE")));
  assert.equal(requireInstalled("playwright/package.json").version,packageInfo.dependencies.playwright);
  const wrapper=path.join(installed,"bin/vibeguru.js");
  const {ensureChromium}=requireInstalled("./scripts/lib/setup.js");ensureChromium();
  await command(process.execPath,[wrapper,"doctor"],{env});
  await command(process.execPath,[wrapper],{env,expected:64});
  const initRoot=path.join(scratch,"configured");fs.mkdirSync(initRoot);
  const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(()=>resolve(port))})});
  const vite=path.join(fixtureRoot,"node_modules/vite/bin/vite.js");
  assert.ok(fs.existsSync(vite),"Run npm ci in test-app first.");
  fixture=spawn(process.execPath,[vite,"--host","127.0.0.1","--port",String(port),"--strictPort"],{cwd:fixtureRoot,stdio:["ignore","pipe","pipe"]});
  const url=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok}catch{}if(ready)break;await new Promise(r=>setTimeout(r,200))}
  assert.ok(ready,"Fixture did not start.");
  await command(process.execPath,[wrapper,"init","--root",initRoot,"--url",url],{env});
  const out=path.join(scratch,"reports");
  console.log("Checking the intentional defects and clean route in Chromium.");
  await command(process.execPath,[wrapper,"memory:client",url,"--root",fixtureRoot,"--out",out,"--cycles","4","--routes","14","--quiet"],{env,expected:1});
  const findings=JSON.parse(fs.readFileSync(path.join(out,"vibeguru-findings.json"),"utf8"));
  assert.equal(findings.verdict,"FAIL");assert.equal(findings.schema_version,2);
  await command(process.execPath,[path.join(root,"scripts/verify-fixtures.mjs"),path.join(out,"vibeguru-findings.json")]);
  for(const file of ["CLAUDE.md","vibeguru-report.md","vibeguru-report.html"])assert.ok(fs.existsSync(path.join(out,file)));

  const cleanFlow=path.join(scratch,"clean-flow.mjs");
  const cleanPort=await new Promise(resolve=>{const server=net.createServer();server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(()=>resolve(port))})});
  const cleanRoot=path.join(fixtureRoot,"clean");
  cleanFixture=spawn(process.execPath,[vite,"--host","127.0.0.1","--port",String(cleanPort),"--strictPort"],{cwd:cleanRoot,stdio:["ignore","pipe","pipe"]});
  const cleanUrl=`http://127.0.0.1:${cleanPort}`;
  ready=false;
  for(let i=0;i<100;i++){try{ready=(await fetch(cleanUrl)).ok}catch{}if(ready)break;await new Promise(r=>setTimeout(r,200))}
  assert.ok(ready,"Clean control did not start.");
  fs.writeFileSync(cleanFlow,`export default async page=>{await page.locator('a[href="/clean"]').click();await page.getByRole('heading',{name:'Clean (control)',exact:true}).waitFor();await page.locator('a[href="/"]').click();await page.getByRole('heading',{name:'Home',exact:true}).waitFor()}`);
  const cleanOut=path.join(scratch,"clean");
  console.log("Checking independent clean and failed-flow verdicts.");
  await command(process.execPath,[wrapper,"memory:client",cleanUrl,"--root",cleanRoot,"--out",cleanOut,"--flow",cleanFlow,"--cycles","4","--quiet"],{env});
  assert.equal(JSON.parse(fs.readFileSync(path.join(cleanOut,"vibeguru-findings.json"),"utf8")).verdict,"PASS");
  const failedFlow=path.join(scratch,"failed-flow.mjs");fs.writeFileSync(failedFlow,"export default async()=>{throw new Error('agreed step failed')}");
  const partialOut=path.join(scratch,"partial");
  await command(process.execPath,[wrapper,"memory:client",cleanUrl,"--root",cleanRoot,"--out",partialOut,"--flow",failedFlow,"--cycles","3","--quiet"],{env,expected:3});
  assert.equal(JSON.parse(fs.readFileSync(path.join(partialOut,"vibeguru-findings.json"),"utf8")).verdict,"INCONCLUSIVE");
  await command(process.execPath,[wrapper,"memory:client","http://127.0.0.1:1","--out",path.join(scratch,"error"),"--quiet"],{env,expected:2});

  const {Client}=await import(pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
  const {StdioClientTransport}=await import(pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
  const client=new Client({name:"package-smoke",version:"1"});
  console.log("Checking installed MCP handshake, browser verification and filtered verdict.");
  await client.connect(new StdioClientTransport({command:process.execPath,args:[wrapper,"mcp"],cwd:fixtureRoot,env,stderr:"pipe"}));
  try{
    assert.equal(client.getServerVersion().version,packageInfo.version);
    const response=await client.callTool({name:"verify_runtime",arguments:{root:fixtureRoot,url,cycles:4,routes:14}},undefined,{timeout:360000});
    assert.ok(!response.isError,JSON.stringify(response));assert.match(response.content[0].text,/^FAIL/);
    const filtered=await client.callTool({name:"read_findings",arguments:{route:"/nonexistent"}});
    assert.match(filtered.content[0].text,/FAIL/);
  }finally{await client.close()}

  const output=path.resolve(flag("--out")||path.join(root,"reports",`package-smoke-${process.platform}-${process.arch}.json`));
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify({version:packageInfo.version,platform:`${process.platform}:${process.arch}`,mode,passed:true,node:process.version,duration_ms:Math.round(performance.now()-started),timings,package_files:packedFiles.size,package_size_bytes:pack[0].size,source_revision:suite.source_revision,execution_identity_stable:sourceRevision()===suite.source_revision,binary_sha256:createHash("sha256").update(fs.readFileSync(binary)).digest("hex"),checks:["production-package-boundary","fresh-tarball-install","CLI-doctor","CLI-init","CLI-usage-64","CLI-FAIL-1","clean-flow-PASS-0","failed-flow-INCONCLUSIVE-3","execution-ERROR-2","MCP-handshake-and-verify","filtered-verdict","fixture-signatures-and-control"]},null,2));
  smokePassed=true;
  console.log(`Package smoke passed (${mode}): ${output}`);
}catch(error){
  smokeFailure=error;
  throw error;
}finally{
  finishSuite(suite,{status:smokePassed?"PASS":"ERROR",failures:smokeFailure?[{name:"Package smoke",message:smokeFailure.message}]:[],mode,
    log_path:smokePassed?path.relative(root,path.resolve(flag("--out")||path.join(root,"reports",`package-smoke-${process.platform}-${process.arch}.json`))).replaceAll("\\","/"):null});
  for(const server of [fixture,cleanFixture])if(server){server.kill();await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once("close",resolve);setTimeout(resolve,3000)})}
  const resolved=path.resolve(scratch);
  assert.ok(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith("vibeguru-package-smoke-"));
  fs.rmSync(resolved,{recursive:true,force:true});
}
