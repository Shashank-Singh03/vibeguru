#!/usr/bin/env node
// Fail closed before npm publication if matching, tested native assets are absent.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
try{
  const mix=fs.readFileSync(path.join(root,"mix.exs"),"utf8").match(/version: "([^"]+)"/)[1];
  assert.equal(mix,pkg.version,"npm and engine versions differ");
  assert.ok(!execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8"}).trim(),"Commit reviewed changes before publishing.");
  const commit=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  const tagCommit=execFileSync("git",["rev-list","-n","1",`v${pkg.version}`],{cwd:root,encoding:"utf8"}).trim();
  assert.equal(commit,tagCommit,"Publish the exact reviewed release tag.");
  const api=`https://api.github.com/repos/Shashank-Singh03/vibeguru/releases/tags/v${pkg.version}`;
  const response=await fetch(api,{headers:{"User-Agent":"vibeguru-release-check"},signal:AbortSignal.timeout(30000)});
  assert.ok(response.ok,`Matching GitHub release is unavailable (${response.status}). Build and validate it first.`);
  const release=await response.json();assert.ok(!release.draft,"Release is still a draft.");
  const names=new Set(release.assets.map(a=>a.name));
  for(const name of ["vibeguru-linux-x64","vibeguru-windows-x64.exe","vibeguru-macos-x64","vibeguru-macos-arm64","SHA256SUMS","smoke-results.json"])assert.ok(names.has(name),`Missing release asset: ${name}`);
  const proofResponse=await fetch(release.assets.find(a=>a.name==="smoke-results.json").browser_download_url,{signal:AbortSignal.timeout(30000)});
  assert.ok(proofResponse.ok,"Could not read native smoke results.");
  const proof=await proofResponse.json();assert.equal(proof.version,pkg.version);assert.equal(proof.commit,commit);
  const checksumResponse=await fetch(release.assets.find(a=>a.name==="SHA256SUMS").browser_download_url,{signal:AbortSignal.timeout(30000)});
  assert.ok(checksumResponse.ok,"Could not read release checksums.");
  const {checksumFor}=await import("./lib/setup.js");
  const checksums=await checksumResponse.text();
  const assets={"linux:x64":"vibeguru-linux-x64","win32:x64":"vibeguru-windows-x64.exe","darwin:x64":"vibeguru-macos-x64","darwin:arm64":"vibeguru-macos-arm64"};
  for(const platform of ["linux:x64","win32:x64","darwin:x64","darwin:arm64"]){
    const result=proof.platforms.find(p=>p.platform===platform);
    assert.ok(result?.passed&&result.mode==="native"&&result.version===pkg.version,`No passing native smoke for ${platform}`);
    assert.equal(result.binary_sha256,checksumFor(checksums,assets[platform]),`Smoke proof does not match release binary for ${platform}`);
  }
  console.log(`Release v${pkg.version} is aligned and has passing native smoke results.`);
}catch(error){console.error(`Release blocked: ${error.message}`);process.exitCode=1}
