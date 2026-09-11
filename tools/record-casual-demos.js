'use strict';
// Capture the ACTUAL Phaser renderer into six silent H.264 MP4s. No custom
// imitation renderer, game-rule changes or live title simulation is required.
// node tools/record-casual-demos.js <playwright-module-path> [baseUrl] [clip 1..6]
// Add --normalize-existing to repair earlier fragmented recordings without re-encoding.
// Add --cosmic for the space-sports theme; casual recordings remain untouched.
const fs = require('node:fs');
const path = require('node:path');
const playwright = require(process.argv[2] || 'playwright');
const baseUrl = process.argv[3] || 'http://localhost:8080';
if (!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(baseUrl)) throw Error('Record only a local development server');
const only = Number(process.argv[4] || 0);
const cosmic = process.argv.includes('--cosmic');
const output = path.resolve(__dirname, cosmic ? '../assets/title-demos-cosmic' : '../assets/title-demos-casual');
const seconds = 15;
fs.mkdirSync(output, { recursive:true });

// Chromium's MediaRecorder writes fragmented MP4: loadedmetadata can initially
// report ONLY the first fragment's duration. Its render-callback count also is
// not the encoded frame count. Flatten our single-track H.264 output into a
// normal fast-start MP4, keeping the encoded samples and their actual DTS.
// This is lossless container work, not a speed change or a second encode.
function atoms(buffer, start = 0, end = buffer.length) {
  const result = [];
  for (let at = start; at < end;) {
    if (at + 8 > end) throw Error('Truncated MP4 atom');
    let size = buffer.readUInt32BE(at), header = 8;
    if (size === 1) { size = Number(buffer.readBigUInt64BE(at + 8)); header = 16; }
    if (size === 0) size = end - at;
    if (size < header || at + size > end) throw Error('Invalid MP4 atom size');
    result.push({ type:buffer.toString('ascii',at+4,at+8), at, data:at+header, end:at+size });
    at += size;
  }
  return result;
}
function box(type, ...parts) {
  const body = Buffer.concat(parts), head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8); head.write(type,4,'ascii');
  return Buffer.concat([head,body]);
}
function integers(...values) {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((n,i) => b.writeUInt32BE(n >>> 0,i*4));
  return b;
}
function normalizeRecording(input) {
  const top = atoms(input), moov = top.find(x => x.type === 'moov'), ftyp = top.find(x => x.type === 'ftyp');
  if (!moov || !ftyp) throw Error('Missing MP4 headers');
  const children = a => atoms(input,a.data,a.end);
  const child = (a,type) => { const found=children(a).find(x=>x.type===type); if(!found) throw Error('Missing '+type); return found; };
  const raw = a => input.subarray(a.at,a.end);
  const tracks = children(moov).filter(x=>x.type==='trak');
  if (tracks.length !== 1) throw Error('Expected one silent video track');
  const track=tracks[0], mdia=child(track,'mdia'), mdhd=child(mdia,'mdhd'), mvhd=child(moov,'mvhd');
  const scaleOf = a => input.readUInt32BE(a.data + (input[a.data] === 1 ? 20 : 12));
  const timescale=scaleOf(mdhd), movieScale=scaleOf(mvhd), samples=[];
  const fragments=top.filter(x=>x.type==='moof');
  if (!fragments.length) throw Error('Input is already a flat MP4; no normalization needed');
  for (const fragment of fragments) {
    const traf=child(fragment,'traf'), tfhd=child(traf,'tfhd'), tfdt=child(traf,'tfdt');
    const tfFlags=input.readUIntBE(tfhd.data+1,3);
    let pos=tfhd.data+8, base=fragment.at, defaultDuration=0, defaultSize=0, defaultFlags=0;
    if (tfFlags & 1) { base=Number(input.readBigUInt64BE(pos)); pos+=8; }
    if (tfFlags & 2) pos+=4;
    if (tfFlags & 8) { defaultDuration=input.readUInt32BE(pos); pos+=4; }
    if (tfFlags & 16) { defaultSize=input.readUInt32BE(pos); pos+=4; }
    if (tfFlags & 32) defaultFlags=input.readUInt32BE(pos);
    let dts=input[tfdt.data]===1 ? Number(input.readBigUInt64BE(tfdt.data+4)) : input.readUInt32BE(tfdt.data+4);
    for (const trun of children(traf).filter(x=>x.type==='trun')) {
      const flags=input.readUIntBE(trun.data+1,3), count=input.readUInt32BE(trun.data+4);
      let p=trun.data+8, offset=0, firstFlags=defaultFlags;
      if (!(flags&1)) throw Error('Recording fragment must have an explicit data offset');
      offset=base+input.readInt32BE(p); p+=4;
      if (flags&4) { firstFlags=input.readUInt32BE(p); p+=4; }
      for (let n=0;n<count;n++) {
        let duration=defaultDuration,size=defaultSize,sampleFlags=n===0?firstFlags:defaultFlags;
        if(flags&256){duration=input.readUInt32BE(p);p+=4;}
        if(flags&512){size=input.readUInt32BE(p);p+=4;}
        if(flags&1024){sampleFlags=input.readUInt32BE(p);p+=4;}
        if(flags&2048){if(input.readInt32BE(p)!==0)throw Error('B-frame composition offsets are not supported');p+=4;}
        if(!size||!duration||!top.some(a=>a.type==='mdat'&&offset>=a.data&&offset+size<=a.end)) throw Error('Invalid encoded sample');
        samples.push({dts,duration,size,sync:!(sampleFlags&0x10000),bytes:input.subarray(offset,offset+size)});
        offset+=size; dts+=duration;
      }
    }
  }
  if (!samples.length || !samples[0].sync) throw Error('Recording must start with an H.264 keyframe');
  // Preserve any small timestamp gap between fragments in the preceding sample.
  for(let n=0;n<samples.length-1;n++) {
    const delta=samples[n+1].dts-samples[n].dts;
    if(delta<=0)throw Error('Non-monotonic MP4 sample timestamps');
    samples[n].duration=delta;
  }
  const duration=samples.reduce((sum,s)=>sum+s.duration,0), movieDuration=Math.ceil(duration/timescale*movieScale);
  const runs=[];
  for(const s of samples){const last=runs[runs.length-1];if(last&&last[1]===s.duration)last[0]++;else runs.push([1,s.duration]);}
  const withDuration=(a,value,isTrack=false)=>{
    const b=Buffer.from(raw(a)), version=input[a.data];
    const relative=a.data-a.at+(version===1?(isTrack?28:24):(isTrack?20:16));
    if(version===1)b.writeBigUInt64BE(BigInt(value),relative);else b.writeUInt32BE(value,relative);
    return b;
  };
  const minf=child(mdia,'minf'), stbl=child(minf,'stbl'), stsd=raw(child(stbl,'stsd'));
  const sync=samples.flatMap((s,n)=>s.sync?[n+1]:[]);
  const makeMoov=offset=>{
    const tables=box('stbl',stsd,
      box('stts',integers(0,runs.length,...runs.flat())),
      box('stsc',integers(0,1,1,samples.length,1)),
      box('stsz',integers(0,0,samples.length,...samples.map(s=>s.size))),
      box('stco',integers(0,1,offset)),box('stss',integers(0,sync.length,...sync)));
    const newMinf=box('minf',...children(minf).map(a=>a.type==='stbl'?tables:raw(a)));
    const newMdia=box('mdia',...children(mdia).map(a=>a.type==='minf'?newMinf:a.type==='mdhd'?withDuration(a,duration):raw(a)));
    const newTrack=box('trak',...children(track).map(a=>a.type==='mdia'?newMdia:a.type==='tkhd'?withDuration(a,movieDuration,true):raw(a)));
    return box('moov',...children(moov).filter(a=>a.type!=='mvex').map(a=>a.type==='trak'?newTrack:a.type==='mvhd'?withDuration(a,movieDuration):raw(a)));
  };
  const provisional=makeMoov(0), header=raw(ftyp), finalMoov=makeMoov(header.length+provisional.length+8);
  return {bytes:Buffer.concat([header,finalMoov,box('mdat',...samples.map(s=>s.bytes))]),
    seconds:duration/timescale,frames:samples.length,fps:samples.length/(duration/timescale),fragmentCount:fragments.length};
}

(async () => {
  const browser = await playwright.chromium.launch({ headless:true, args:['--disable-background-timer-throttling','--disable-renderer-backgrounding'] });
  try {
    const report = [];
    for (let index = 0; index < 6; index++) {
      if (only && only !== index + 1) continue;
      const page = await browser.newPage({ viewport:{width:540,height:960}, deviceScaleFactor:1 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(baseUrl + '/index.html?recordTitle=1&titleScenario=' + index, { waitUntil:'domcontentloaded' });
      await page.waitForFunction(() => typeof scene !== 'undefined' && scene && window.BounceRoyalTitleRecording && typeof Phaser !== 'undefined');
      const name = 'title-demo-' + String(index+1).padStart(2,'0') + '.mp4';
      const existing = process.argv.includes('--normalize-existing');
      const capture = existing ? null : await page.evaluate(async ({duration,background}) => {
        const type = 'video/mp4;codecs=avc1.42E01E';
        if (!MediaRecorder.isTypeSupported(type)) throw Error('This browser lacks H.264 recording support');
        const film = document.createElement('canvas'); film.width = 540; film.height = 960;
        const pen = film.getContext('2d', {alpha:false});
        const bounds = canvas.getBoundingClientRect(), appBounds = document.getElementById('app').getBoundingClientRect();
        const stream = film.captureStream(30);
        const recorder = new MediaRecorder(stream, {mimeType:type,videoBitsPerSecond:900000});
        const chunks = [];
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        let last = performance.now(), endedAt = 0, frameCount = 0;
        function frame() {
          const now = performance.now();
          let dt = Math.max(0, (now-last)/1000); last = now;
          pen.fillStyle = background; pen.fillRect(0,0,540,960);
          // Read while the WebGL framebuffer is valid, immediately after render.
          pen.drawImage(canvas,bounds.left-appBounds.left,bounds.top-appBounds.top,bounds.width,bounds.height);
          frameCount++;
          if (Game.demo.result) {
            if (!endedAt) endedAt = now;
            if (now-endedAt > 800) { window.BounceRoyalTitleRecording.restart(); endedAt = 0; }
          } else {
            // Preserve real elapsed time even when the encoder makes a frame
            // late, while retaining the simulation's small update increments.
            while (dt > 0) { const step=Math.min(.05,dt); Game.demo.update(step); dt-=step; }
          }
          renderBattle(Game.demo);
        }
        phaserGame.events.on('postrender', frame);
        const stopped = new Promise((resolve,reject) => { recorder.onstop = resolve; recorder.onerror = event => reject(Error(event.error?.message || 'Recording failed')); });
        recorder.start(1000);
        await new Promise(resolve => setTimeout(resolve,duration*1000));
        recorder.stop(); await stopped;
        phaserGame.events.off('postrender', frame); stream.getTracks().forEach(track=>track.stop());
        const blob = new Blob(chunks,{type:'video/mp4'});
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary=''; for(let offset=0;offset<bytes.length;offset+=32768) binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
        return {base64:btoa(binary),frames:frameCount,seconds:duration};
      }, {duration:seconds,background:cosmic?'#141b33':'#80dcca'});
      if (errors.length) throw Error(errors.join('\n'));
      if (capture && capture.frames < seconds*20) throw Error('Recording renderer ran below 20 fps; rerun without other browser tests');
      const normalized=normalizeRecording(existing?fs.readFileSync(path.join(output,name)):Buffer.from(capture.base64,'base64'));
      const bytes=normalized.bytes;
      if(normalized.seconds<14.7||normalized.seconds>15.3)throw Error('Encoded duration differs from requested 15 seconds: '+normalized.seconds);
      if (bytes.length < 50000 || bytes.length > 3500000) throw Error('Unexpected recording size for ' + name);
      // Inspect the finished container before replacing the local preview file.
      const metadata=await page.evaluate(async base64=>{
        const buffer=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)), url=URL.createObjectURL(new Blob([buffer],{type:'video/mp4'}));
        const video=document.createElement('video'); video.preload='auto'; video.muted=true; video.src=url;
        await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('MP4 decode failed'));});
        const value={duration:video.duration,width:video.videoWidth,height:video.videoHeight};
        video.currentTime=Math.max(0,value.duration-0.15);
        await new Promise((resolve,reject)=>{video.onseeked=resolve;video.onerror=()=>reject(Error('MP4 tail seek failed'));});
        value.tailTime=video.currentTime; URL.revokeObjectURL(url); return value;
      },bytes.toString('base64'));
      if(Math.abs(metadata.duration-normalized.seconds)>.01||metadata.width!==540||metadata.height!==960)throw Error('Browser metadata does not match encoded timeline');
      fs.writeFileSync(path.join(output,name),bytes);
      const entry = {name,bytes:bytes.length,seconds:normalized.seconds,frames:normalized.frames,
        fps:Math.round(normalized.fps*100)/100,browserDuration:metadata.duration,tailSeekVerified:true,
        codec:'H.264',container:'non-fragmented MP4 (fast start)',width:540,height:960,sound:false};
      if(capture)entry.renderCallbacks=capture.frames;
      report.push(entry); console.log(JSON.stringify(entry));
      await page.close();
    }
    if (!only) fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({description:'Silent replays captured from the '+(cosmic?'cosmic sports':'casual')+' Phaser renderer. Actual encoded duration/frame counts verified in Chromium. Fast-start MP4 normalization preserves samples and playback speed. Earlier recordings remain in their original folders.',clips:report},null,2)+'\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
