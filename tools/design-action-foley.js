'use strict';
// Render authored Foley composites offline. No audio DSP runs in the simulation.
// Inputs are the small CC0 takes already in assets/sfx/foley; see CREDITS.md.
// node tools/design-action-foley.js [--check]
const fs = require('node:fs');
const path = require('node:path');
const RATE = 32000, TAU = Math.PI * 2;
const folder = path.resolve(__dirname, '../assets/sfx/foley');
let seed = 0x492bae13;
function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
const white = () => random() * 2 - 1;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const buffer = seconds => new Float64Array(Math.ceil(seconds * RATE));
function curve(points, u) {
  if (u <= points[0][0]) return points[0][1];
  for (let n = 1; n < points.length; n++) {
    if (u <= points[n][0]) {
      const [a,x] = points[n-1], [b,y] = points[n];
      return x + (y-x) * (u-a) / (b-a);
    }
  }
  return points.at(-1)[1];
}
function read(name) {
  const wav = fs.readFileSync(path.join(folder, name + '.wav'));
  if (wav.readUInt32LE(24) !== RATE || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16) throw Error('Expected mono 32kHz PCM: ' + name);
  const out = new Float64Array(wav.readUInt32LE(40) / 2);
  for (let i=0;i<out.length;i++) out[i] = wav.readInt16LE(44+i*2) / 32768;
  return out;
}
function mix(out, src, at=0, gain=1, rate=1) {
  const start = Math.round(at * RATE);
  for (let i=0; start+i<out.length && i*rate<src.length-1;i++) {
    const pos=i*rate, p=Math.floor(pos), x=src[p]+(src[p+1]-src[p])*(pos-p);
    if(start+i>=0) out[start+i] += x * gain;
  }
  return out;
}
function windowed(src, from, to) {
  const clip = src.slice(Math.round(from*RATE), Math.round(to*RATE));
  for(let i=0;i<clip.length;i++) clip[i] *= Math.min(1,i/(RATE*.002),(clip.length-1-i)/(RATE*.012));
  return clip;
}
function highpass(src, f) {
  const out = new Float64Array(src.length), a=1-Math.exp(-TAU*f/RATE); let low=0;
  for(let i=0;i<src.length;i++) { low += a*(src[i]-low); out[i] = src[i]-low; }
  return out;
}
function band(src, freq, q=.8) {
  const out = new Float64Array(src.length); let y1=0,y2=0,x1=0,x2=0;
  for(let i=0;i<src.length;i++) {
    const f=typeof freq==='function'?freq(i/src.length):freq;
    const w=TAU*clamp(f,40,12000)/RATE, alpha=Math.sin(w)/(2*q), a0=1+alpha;
    const y=(alpha*src[i]-alpha*x2+2*Math.cos(w)*y1-(1-alpha)*y2)/a0;
    x2=x1;x1=src[i];y2=y1;y1=y;out[i]=y;
  }
  return out;
}
function air(seconds, frequencies, envelope, q=1) {
  const out=buffer(seconds); for(let i=0;i<out.length;i++) out[i]=white();
  const filtered=band(out,u=>curve(frequencies,u),q);
  for(let i=0;i<out.length;i++) filtered[i] *= curve(envelope,i/out.length);
  return filtered;
}
// An excited bank of decaying material modes, not a sliding electronic sine.
function modes(seconds, f, ratios, decay, excitation, drift=()=>1) {
  const out=buffer(seconds);
  for(let n=0;n<ratios.length;n++) {
    const [ratio, level]=ratios[n]; let y1=0,y2=0;
    const radius=Math.exp(-1/(RATE*decay/(1+n*.45)));
    for(let i=0;i<out.length;i++) {
      const t=i/RATE, hz=f*ratio*drift(t), drive=excitation[i] || 0;
      const y=2*radius*Math.cos(TAU*hz/RATE)*y1-radius*radius*y2+drive*Math.sin(TAU*hz/RATE);
      y2=y1;y1=y;out[i] += y*level;
    }
  }
  return out;
}
function impulse(seconds=.003) {
  const out=buffer(seconds); for(let i=0;i<out.length;i++) out[i]=white()*Math.exp(-i/(RATE*.0007));
  return out;
}
// Friction periodically sticks, then slips. Irregular micro-impulses excite a
// taut string's partials; pressure and pitch rise in separate pulling gestures.
function stringDraw() {
  const duration=1.68, out=buffer(duration), drive=buffer(duration);
  let phase=0, rate=75, drift=0, prev=0;
  const envelope=[[0,0],[.07,.2],[.15,.58],[.31,.8],[.36,.24],[.43,.62],[.60,1],[.69,.42],[.78,.87],[.9,.42],[1,0]];
  for(let i=0;i<drive.length;i++) {
    const u=i/drive.length;
    drift += .0015*(white()-drift);
    rate=55+100*u+80*drift; phase += rate/RATE;
    const slip=phase>=1; if(slip) phase-=1;
    const raw=white(), grit=raw-prev*.75;prev=raw;
    drive[i]=(slip? .09*(.5+random()):0) * curve(envelope,u) + grit*.0028*curve(envelope,u);
  }
  const tension=t=>curve([[0,1],[.32,1.2],[.61,1.56],[.84,1.74],[1,1.8]],t/duration);
  mix(out,modes(duration,138,[[1,.23],[2,.42],[3,.30],[4.03,.15],[5.1,.07]],.014,drive,tension));
  const rope=air(duration,[[0,1500],[.32,2050],[.7,2700],[1,2900]],envelope,.85);
  mix(out,rope,0,.12);
  // Low, dry wood friction is a substrate; the previous unprocessed recording
  // is deliberately not the foreground signature anymore.
  mix(out,band(read('bow-draw'),620,.7),.02,.16,.86);
  return out;
}
function stringRelease() {
  const out=buffer(.58), pluck=impulse(.009);
  // Pluck near the bridge: strong upper string modes, fast tension relaxation,
  // and frequency-dependent damping. No synthesized musical triangle sweep.
  mix(out,modes(.48,232,[[1,.18],[2,.42],[3,.29],[4,.14],[5,.08],[7,.035]],.12,pluck,t=>1+.55*Math.exp(-t/.027)),.004,.9);
  mix(out,highpass(read('bow-release'),900),0,.72);
  mix(out,air(.41,[[0,1850],[.12,4900],[.35,3000],[1,700]],[[0,0],[.055,.65],[.16,1],[.35,.55],[1,0]],1.7),.026,.30);
  mix(out,band(read('arrow-pass'),2200,1),.02,.28,2.8);
  return out;
}
function minePlace() {
  const out=buffer(.34), mechanism=read('mechanism');
  mix(out,modes(.16,188,[[1,.35],[1.62,.24],[2.74,.13],[4.1,.10]],.032,impulse()),0,.50);
  mix(out,air(.055,[[0,1900],[1,900]],[[0,0],[.025,1],[1,0]],.65),0,.25);
  // First the casing settles, then two close metal latches engage.
  mix(out,windowed(mechanism,.045,.18),.058,.65,1.35);
  mix(out,windowed(mechanism,.46,.56),.172,.40,1.25);
  return out;
}
function daggerDash() {
  const out=buffer(.38);
  mix(out,highpass(read('blade-air'),500),0,.7,1.25);
  mix(out,air(.32,[[0,1050],[.17,4600],[.34,5700],[.6,2300],[1,700]],[[0,0],[.09,.35],[.24,1],[.42,.7],[.68,.22],[1,0]],2.0),0,.70);
  mix(out,air(.19,[[0,800],[.24,2200],[1,400]],[[0,0],[.14,1],[.6,.3],[1,0]],.75),.012,.28);
  // A narrow blade edge passes the ear at the crest, without a fake hit at end.
  mix(out,band(windowed(read('blade-scrape'),.04,.14),4100,2),.066,.30,1.35);
  return out;
}
function swordSpin() {
  const out=buffer(1.04), blade=read('blade-air');
  // The simulation rotates two turns at 0.5 seconds per turn. Maintain an air
  // bed across turns, with one close bright pass and one far soft pass per turn.
  mix(out,air(1.02,[[0,700],[.2,1100],[.8,1100],[1,420]],[[0,0],[.08,.18],[.9,.18],[1,0]],.8),0,.44);
  for(let lap=0;lap<2;lap++) {
    const at=lap*.5;
    mix(out,blade,at+.035,.43,1.12);
    mix(out,air(.35,[[0,850],[.2,2350],[.4,3800],[.7,1600],[1,500]],[[0,0],[.1,.25],[.3,1],[.55,.78],[1,0]],1.8),at+.015,.64);
    mix(out,air(.20,[[0,1300],[.4,800],[1,600]],[[0,0],[.23,1],[1,0]],1.1),at+.28,.18);
  }
  return out;
}
function barrageLatch() {
  const out=buffer(.24);
  mix(out,windowed(read('mechanism'),.04,.17),0,.64,1.7);
  mix(out,windowed(read('mechanism'),.47,.57),.043,.42,1.9);
  mix(out,air(.19,[[0,750],[.27,1900],[1,650]],[[0,0],[.15,1],[1,0]],1.3),.023,.18);
  return out;
}
function barrageShot() {
  const out=buffer(.125);
  // Dry pressure crack, resonant chamber and bolt return. The short tail leaves
  // space between the simulation's 120ms shots; this is not a looped gun sample.
  mix(out,air(.05,[[0,5000],[.1,3000],[1,1200]],[[0,0],[.015,1],[.12,.7],[1,0]],.65),0,.66);
  mix(out,modes(.115,148,[[1,.36],[1.83,.21],[3.4,.13],[7.1,.03]],.02,impulse(.002)),.002,.8);
  mix(out,windowed(read('mechanism'),.085,.135),.033,.30,1.5);
  mix(out,air(.09,[[0,1450],[1,550]],[[0,0],[.04,.6],[1,0]],.8),.015,.15);
  return out;
}
function fall() {
  const out=buffer(.62);
  // Elastic shell buckles and releases air. One softer settling contact makes
  // a fall distinct from a mine's sharp detonation or shards of broken glass.
  mix(out,modes(.29,122,[[1,.42],[1.47,.20],[2.18,.08]],.049,impulse(.006),t=>1+.38*Math.exp(-t/.045)),0,.75);
  mix(out,air(.16,[[0,1800],[1,700]],[[0,0],[.04,1],[.23,.36],[1,0]],.7),0,.38);
  mix(out,air(.52,[[0,1200],[.15,2100],[.5,1100],[1,280]],[[0,0],[.07,.45],[.19,1],[.48,.64],[1,0]],1.4),.016,.27);
  mix(out,modes(.15,103,[[1,.32],[1.5,.13],[2.8,.07]],.024,impulse(.004)),.24,.23);
  return out;
}
function encode(pcm) {
  const out=Buffer.alloc(44+pcm.length*2);
  out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);
  out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(RATE,24);out.writeUInt32LE(RATE*2,28);
  out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(pcm.length*2,40);
  for(let i=0;i<pcm.length;i++) out.writeInt16LE(Math.round(clamp(pcm[i],-1,1)*32767),44+i*2);
  return out;
}
function master(raw, peak=.76) {
  const src=highpass(raw,65); let max=0;
  for(let i=0;i<src.length;i++) { src[i]*=Math.max(0,Math.min(1,i/(RATE*.0015),(src.length-1-i)/(RATE*.018)));max=Math.max(max,Math.abs(src[i])); }
  // Preserve crest factors and texture. Loudness is set per cue in audio-design.
  const gain=peak/(max || 1); for(let i=0;i<src.length;i++) src[i]*=gain;
  return src;
}
const takes = {
  'action-bow-draw':master(stringDraw()), 'action-bow-release':master(stringRelease()),
  'action-mine-place':master(minePlace()), 'action-dagger-dash':master(daggerDash()),
  'action-sword-spin':master(swordSpin()), 'action-barrage-start':master(barrageLatch()),
  'action-barrage-shot':master(barrageShot()), 'action-fall':master(fall()),
};
const burst=buffer(1.58);
// Listening-room illustration only. Gameplay plays action-barrage-shot once for
// each authoritative fireGun event, including attack-speed changes/stuns/death.
for(let t=0;t<1.5;t+=.12) mix(burst,takes['action-barrage-shot'],t,.70);
takes['action-barrage-preview']=burst;
for(const [name,pcm] of Object.entries(takes)) {
  const encoded=encode(pcm), target=path.join(folder,name+'.wav');
  if(process.argv.includes('--check')) {
    if(!fs.existsSync(target) || !fs.readFileSync(target).equals(encoded)) throw Error('Generated sound differs: '+name);
  } else fs.writeFileSync(target,encoded);
  let energy=0,peak=0;for(const x of pcm){if(!Number.isFinite(x))throw Error(name+': invalid PCM');energy+=x*x;peak=Math.max(peak,Math.abs(x));}
  if(peak>.85 || energy<.00001) throw Error(name+': invalid level');
  console.log(`${name}: ${(pcm.length/RATE).toFixed(3)}s, ${encoded.length} bytes, peak ${peak.toFixed(3)}, RMS ${Math.sqrt(energy/pcm.length).toFixed(3)}`);
}
