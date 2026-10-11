"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const https=require("node:https");
const {PassThrough}=require("node:stream");
const {EventEmitter}=require("node:events");
const {createHash}=require("node:crypto");
const {download}=require("../scripts/lib/download");
const {checksumFor}=require("../scripts/lib/setup");
const {launchSpec}=require("../scripts/lib/launch");

test("release checksums require an exact asset and valid hash",()=>{
  const hash="a".repeat(64);
  assert.equal(checksumFor(`${hash}  vibeguru-windows-x64.exe\n`,"vibeguru-windows-x64.exe"),hash);
  assert.throws(()=>checksumFor(`${hash}  other-file`,"vibeguru-linux-x64"),/missing/);
  assert.throws(()=>checksumFor("bad  vibeguru-linux-x64","vibeguru-linux-x64"),/missing/);
});

test("download follows relative HTTPS redirects and only caches verified bytes",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"vibeguru-download-test-"));
  const dest=path.join(root,"binary"),original=https.get,urls=[];
  const payload=Buffer.from("verified executable");
  https.get=(url,options,callback)=>{
    urls.push(String(url));const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=()=>req;
    queueMicrotask(()=>{
      const res=new PassThrough();res.statusCode=urls.length===1?302:200;res.headers=urls.length===1?{location:"./binary"}:{};res.complete=true;callback(res);
      setImmediate(()=>res.end(payload));
    });return req;
  };
  try{
    await download("https://release.example/assets/start",dest,{sha256:createHash("sha256").update(payload).digest("hex")});
    assert.deepEqual(urls,["https://release.example/assets/start","https://release.example/assets/binary"]);
    assert.deepEqual(fs.readFileSync(dest),payload);
    await assert.rejects(download("https://release.example/binary",dest,{sha256:"0".repeat(64)}),/checksum/);
    assert.deepEqual(fs.readFileSync(dest),payload,"mismatch must not replace the verified binary");
  }finally{https.get=original;assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true})}
});

test("interrupted stream fails without leaving a cached executable",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"vibeguru-download-test-"));
  const dest=path.join(root,"binary"),original=https.get;
  https.get=(_url,_options,callback)=>{
    const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=()=>req;
    queueMicrotask(()=>{const res=new PassThrough();res.statusCode=200;res.headers={};res.complete=false;callback(res);setImmediate(()=>{res.write("partial");res.emit("aborted");res.destroy()})});return req;
  };
  try{
    await assert.rejects(download("https://release.example/binary",dest),/interrupted/);
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(fs.existsSync(dest),false);assert.deepEqual(fs.readdirSync(root),[]);
  }finally{https.get=original;assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true})}
});

test("development escripts preserve arguments through the platform launcher",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"vibeguru-launch-test-")),binary=path.join(root,"binary with spaces");
  try{
    fs.writeFileSync(binary,"#!/usr/bin/env escript\ncompiled body");
    const args=["run","--root","a project with spaces"];
    assert.deepEqual(launchSpec(binary,args),{command:process.platform==="win32"?"escript.exe":"escript",args:[binary,...args]});
    fs.writeFileSync(binary,"MZnative executable");assert.deepEqual(launchSpec(binary,args),{command:binary,args});
  }finally{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true})}
});

function mockDownloads(t, responder) {
  const original = https.get;
  const requests = [];
  https.get = (url, _options, callback) => {
    const req = new EventEmitter();
    req.url = String(url);
    req.setTimeout = () => req;
    req.destroy = () => { req.destroyed = true; return req; };
    requests.push(req);
    queueMicrotask(() => responder(req, callback, requests.length));
    return req;
  };
  t.after(() => { https.get = original; });
  return requests;
}

function downloadDestination(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibeguru-download-test-"));
  t.after(async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, dest: path.join(root, "binary") };
}

test("release downloads reject unsafe URLs before opening a connection", async t => {
  const { dest } = downloadDestination(t);
  const requests = mockDownloads(t, () => assert.fail("unsafe URL opened a connection"));
  for (const url of ["http://github.com/file", "https://token@github.com/file", "https://evil.example/file", "https://github.com:444/file"]) {
    await assert.rejects(download(url, dest, { allowedHosts: ["github.com"] }), /HTTPS|credentials|allowlist/);
  }
  await assert.rejects(download("https://github.com/file", dest, { sha256: "bad" }), /checksum/);
  await assert.rejects(download("https://github.com/file", dest, { maxBytes: 0 }), /positive/);
  assert.equal(requests.length, 0);
});

test("release redirect policy is applied on every hop", async t => {
  const { root, dest } = downloadDestination(t);
  const requests = mockDownloads(t, (_req, callback) => {
    const res = new PassThrough();
    res.statusCode = 302; res.headers = { location: "https://evil.example/payload" };
    callback(res);
  });
  await assert.rejects(download("https://github.com/file", dest, { allowedHosts: ["github.com"] }), /allowlist/);
  assert.equal(requests.length, 1);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("oversized advertised and streamed downloads cannot replace an existing executable", async t => {
  const { root, dest } = downloadDestination(t);
  fs.writeFileSync(dest, "previous verified binary");
  mockDownloads(t, (_req, callback, count) => {
    const res = new PassThrough(); res.statusCode = 200;
    res.headers = count === 1 ? { "content-length": "100" } : {};
    res.complete = true; callback(res);
    if (count !== 1) setImmediate(() => res.end("one byte beyond"));
  });
  await assert.rejects(download("https://release.example/file", dest, { maxBytes: 4 }), /byte limit/);
  await assert.rejects(download("https://release.example/file", dest, { maxBytes: 4 }), /byte limit/);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(fs.readFileSync(dest, "utf8"), "previous verified binary");
  assert.deepEqual(fs.readdirSync(root), ["binary"]);
});

test("a redirect chain shares a single wall-clock deadline", async t => {
  const { root, dest } = downloadDestination(t);
  const requests = mockDownloads(t, (req, callback) => {
    setTimeout(() => {
      if (req.destroyed) return;
      const res = new PassThrough(); res.statusCode = 302;
      res.headers = { location: "./next" }; callback(res);
    }, 70);
  });
  const started = Date.now();
  await assert.rejects(download("https://release.example/start", dest, { timeoutMs: 180 }), /timed out/);
  assert.ok(Date.now() - started < 450, "redirects must not restart the deadline");
  assert.ok(requests.length < 5);
  assert.ok(requests.at(-1).destroyed);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("a trickling response cannot evade the whole-download deadline", async t => {
  const { root, dest } = downloadDestination(t);
  let stream, interval;
  t.after(() => clearInterval(interval));
  const requests = mockDownloads(t, (_req, callback) => {
    stream = new PassThrough(); stream.statusCode = 200; stream.headers = {}; stream.complete = false;
    callback(stream); interval = setInterval(() => { if (!stream.destroyed) stream.write("x"); }, 15);
  });
  await assert.rejects(download("https://release.example/start", dest, { timeoutMs: 100 }), /timed out/);
  assert.ok(requests[0].destroyed);
  assert.ok(stream.destroyed);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(fs.readdirSync(root), []);
});
