'use strict';
// PCM WAV editing only: no game rules or runtime dependencies. Source/licence:
// https://opengameart.org/content/medieval-sound-effects-weapon-textures (CC0)
// node tools/prepare-foley.js <extracted pack folder> [--build]
const fs = require('node:fs'), path = require('node:path');
function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii',0,4) !== 'RIFF' || b.toString('ascii',8,12) !== 'WAVE') throw Error('Not WAV: '+file);
  let fmt, data;
  for (let p=12;p+8<=b.length;) {
    const size=b.readUInt32LE(p+4), tag=b.toString('ascii',p,p+4);
    if (tag==='fmt ') fmt=b.subarray(p+8,p+8+size);
    if (tag==='data') data=b.subarray(p+8,p+8+size);
    p+=8+size+(size%2);
  }
  if (!fmt || !data) throw Error('Missing WAV chunks');
  let format=fmt.readUInt16LE(0);
  const channels=fmt.readUInt16LE(2), rate=fmt.readUInt32LE(4), block=fmt.readUInt16LE(12), bits=fmt.readUInt16LE(14);
  if (format===65534) format=fmt.readUInt16LE(24);
  const pcm=new Float32Array(Math.floor(data.length/block));
  for (let i=0;i<pcm.length;i++) {
    for (let c=0;c<channels;c++) {
      const p=i*block+c*bits/8;
      pcm[i]+=(format===3 ? data.readFloatLE(p) : bits===16 ? data.readInt16LE(p)/32768 : bits===24 ? data.readIntLE(p,3)/8388608 : data.readInt32LE(p)/2147483648)/channels;
    }
  }
  return {pcm,rate,bits,channels};
}
function segments(w) {
  const hop=Math.floor(w.rate*.01), levels=[];
  for(let p=0;p<w.pcm.length;p+=hop) {
    let e=0; for(let i=p;i<Math.min(p+hop,w.pcm.length);i++) e+=w.pcm[i]**2;
    levels.push(Math.sqrt(e/hop));
  }
  const threshold=Math.max(...levels)*.065, result=[];
  for(let i=0;i<levels.length;i++) if(levels[i]>threshold) {
    const last=result.at(-1);
    if(last && i*.01-last.end<.22) last.end=(i+1)*.01;
    else result.push({start:i*.01,end:(i+1)*.01});
  }
  return result.filter(s=>s.end-s.start>.04).map(s=>({start:+Math.max(0,s.start-.025).toFixed(3),end:+(s.end+.04).toFixed(3)}));
}
function writeClip(w, start, end, target) {
  const rate=32000, length=Math.round((end-start)*rate), pcm=new Float32Array(length);
  let peak=0, low=0;
  const alpha=1-Math.exp(-2*Math.PI*95/rate);
  for(let i=0;i<length;i++) {
    const pos=(start+i/rate)*w.rate, p=Math.floor(pos), cutoff=.44*rate/w.rate;
    // Windowed-sinc low-pass resampling avoids folding the 192kHz recording's
    // high-frequency hiss into the audible band of the mobile-size asset.
    let x=0, total=0;
    for(let k=-48;k<=48;k++) {
      const d=p+k-pos, z=2*Math.PI*cutoff*d;
      const sinc=Math.abs(z)<1e-8?1:Math.sin(z)/z;
      const window=.42+.5*Math.cos(Math.PI*d/49)+.08*Math.cos(2*Math.PI*d/49);
      const weight=2*cutoff*sinc*window;
      x+=(w.pcm[p+k]||0)*weight;total+=weight;
    }
    x/=total||1;
    low+=alpha*(x-low);
    const fade=Math.min(1,i/(rate*.004),(length-1-i)/(rate*.025));
    pcm[i]=(x-low)*Math.max(0,fade); peak=Math.max(peak,Math.abs(pcm[i]));
  }
  const gain=.72/(peak||1), out=Buffer.alloc(44+length*2);
  out.write('RIFF',0);out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);
  out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(length*2,40);
  for(let i=0;i<length;i++) out.writeInt16LE(Math.round(pcm[i]*gain*32767),44+i*2);
  fs.writeFileSync(target,out);
  console.log(path.basename(target), (length/rate).toFixed(3)+'s',out.length+' bytes');
}
const folder=process.argv[2];
if(!folder) throw Error('Supply the extracted CC0 recording folder');
const files=['English Longbow Draw.wav','English Longbow Shoot.wav','Katana Swing.wav','Katana Sheath Fast.wav','Scythian Recurve Draw.wav','Scythian Recurve Shoot.wav','Crossbow Lever Trigger.wav','Scythian Recurve Arrow Passby.wav'];
for(const file of files) {
  const w=readWav(path.join(folder,file));
  console.log(file,`${w.rate}Hz/${w.bits}bit/${w.channels}ch`,(w.pcm.length/w.rate).toFixed(2)+'s',JSON.stringify(segments(w)));
}
if(process.argv.includes('--build')) {
  const output=path.resolve(__dirname,'../assets/sfx/foley');
  fs.mkdirSync(output,{recursive:true});
  const takes = [
    // Explicit takes chosen after inspecting the pack's waveform; keep this
    // table reproducible instead of shipping the whole ~90MB source archive.
    ['English Longbow Draw.wav',.04,1.38,'bow-draw.wav'],
    ['English Longbow Shoot.wav',.065,.49,'bow-release.wav'],
    ['English Longbow Shoot.wav',1.20,1.63,'bow-release-alt.wav'],
    ['Katana Swing.wav',.31,.72,'blade-air.wav'],
    ['Katana Sheath Fast.wav',2.42,2.88,'blade-scrape.wav'],
    ['Katana Sheath Fast.wav',5.51,5.98,'blade-scrape-alt.wav'],
    ['Crossbow Lever Trigger.wav',.66,1.55,'mechanism.wav'],
    ['Scythian Recurve Arrow Passby.wav',.69,1.66,'arrow-pass.wav'],
  ];
  for(const [source,start,end,name] of takes) writeClip(readWav(path.join(folder,source)),start,end,path.join(output,name));
}
