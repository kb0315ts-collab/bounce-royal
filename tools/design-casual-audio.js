'use strict';
// Deterministic offline edits of the credited CC0 Foley + authored material
// resonances. This creates game assets, not recordings of real new performances.
// node tools/design-casual-audio.js [--check]
const fs = require('node:fs');
const path = require('node:path');
const RATE=32000, TAU=Math.PI*2;
const input=path.resolve(__dirname,'../assets/sfx/foley');
const output=path.resolve(__dirname,'../assets/sfx/casual');
const check=process.argv.includes('--check');
let seed=0x71c36a29;
const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296*2-1;};
const blank=s=>new Float64Array(Math.ceil(s*RATE));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function read(name) {
  const b=fs.readFileSync(path.join(input,name+'.wav'));
  if(b.readUInt32LE(24)!==RATE||b.readUInt16LE(22)!==1||b.readUInt16LE(34)!==16) throw Error('Expected mono PCM '+name);
  const a=new Float64Array(b.readUInt32LE(40)/2);
  for(let i=0;i<a.length;i++)a[i]=b.readInt16LE(44+2*i)/32768;
  return a;
}
function mix(a,b,start=0,gain=1,rate=1) {
  const offset=Math.round(start*RATE);
  for(let i=0;i+offset<a.length&&i*rate<b.length-1;i++) {
    const p=i*rate,k=Math.floor(p);a[i+offset]+=(b[k]+(b[k+1]-b[k])*(p-k))*gain;
  }
  return a;
}
function cut(a,from,to) {
  const b=a.slice(Math.round(from*RATE),Math.round(to*RATE));
  for(let i=0;i<b.length;i++)b[i]*=clamp(Math.min(i/(RATE*.002),(b.length-1-i)/(RATE*.008)),0,1);
  return b;
}
function band(a,hz,q=.8) {
  let x1=0,x2=0,y1=0,y2=0;const b=new Float64Array(a.length);
  for(let i=0;i<a.length;i++) {
    const f=typeof hz==='function'?hz(i/a.length):hz,w=TAU*clamp(f,45,11000)/RATE,alpha=Math.sin(w)/(2*q),a0=1+alpha;
    const y=(alpha*a[i]-alpha*x2+2*Math.cos(w)*y1-(1-alpha)*y2)/a0;
    x2=x1;x1=a[i];y2=y1;y1=y;b[i]=y;
  }
  return b;
}
function hp(a,hz) {
  const b=new Float64Array(a.length),k=1-Math.exp(-TAU*hz/RATE);let low=0;
  for(let i=0;i<a.length;i++){low+=k*(a[i]-low);b[i]=a[i]-low;}return b;
}
function air(dur,hz,gain,q=.8) {
  const a=blank(dur);for(let i=0;i<a.length;i++)a[i]=random();
  const b=band(a,hz,q);
  for(let i=0;i<b.length;i++){const t=i/RATE;b[i]*=Math.min(1,t/.004)*Math.exp(-t/(dur*.18))*gain;}
  return b;
}
function wood(dur,f,gain) {
  const a=blank(dur);let phase=0;
  for(let i=0;i<a.length;i++) {
    const t=i/RATE;phase+=TAU*f*(1+.11*Math.exp(-t/.007))/RATE;
    // A short hollow material attack: inharmonic body, no long pitched tail.
    a[i]=(Math.sin(phase)+.34*Math.sin(phase*2.73)+.15*Math.sin(phase*4.11))*Math.min(1,t/.0015)*Math.exp(-t/(dur*.15))*gain;
  }
  return a;
}
function pluck(dur,f,gain) {
  const a=blank(dur);let p=0;
  for(let i=0;i<a.length;i++) {
    const t=i/RATE;p+=TAU*f*(1+.45*Math.exp(-t/.02))/RATE;
    for(let k=1;k<=5;k++)a[i]+=Math.sin(p*k)*gain/(k*.9)*Math.exp(-t/(.09/k**.45))*Math.min(1,t/.001);
  }
  return a;
}
function draw() {
  const a=blank(1.22);
  mix(a,band(read('action-bow-draw'),u=>1250+u*1500,1.1),0,.9,1.36);
  mix(a,band(read('bow-draw'),1050,.8),.02,.13,1.1);
  // Two subtly separated hand pulls, with a quiet final taut-string tremor.
  for(let i=0;i<a.length;i++) {const u=i/a.length;a[i]*=(u>.36&&u<.43?.60:1)*Math.min(1,u*12,(1-u)*14);}
  mix(a,pluck(.22,238,.026),.93,.22);
  return a;
}
function release() {
  const a=blank(.37);
  mix(a,hp(read('bow-release'),720),0,.72,1.15);
  mix(a,pluck(.29,284,.075),.004);
  mix(a,band(read('arrow-pass'),u=>1500+3000*Math.sin(Math.PI*u),1.7),.012,.35,3.3);
  return a;
}
function pistol() {
  const a=blank(.11);
  mix(a,wood(.085,218,.14));
  mix(a,air(.04,u=>3900-u*1800,.42));
  mix(a,cut(read('mechanism'),.08,.14),.032,.36,1.75);
  return a;
}
function shotgun() {
  const a=blank(.24);
  mix(a,air(.16,u=>2400-u*1700,.65));
  mix(a,wood(.18,138,.17),.002);
  mix(a,air(.055,3700,.19),.047);
  mix(a,cut(read('mechanism'),.46,.56),.073,.34,1.5);
  return a;
}
function mine() {
  const a=blank(.23);mix(a,wood(.075,305,.10));
  mix(a,cut(read('mechanism'),.045,.15),.035,.70,1.55);
  mix(a,cut(read('mechanism'),.46,.53),.122,.42,1.65);
  return a;
}
function dash() {
  const a=blank(.28);mix(a,hp(read('blade-air'),650),0,.76,1.58);
  mix(a,band(cut(read('blade-scrape'),.04,.13),3800,2.1),.035,.28,1.35);
  mix(a,air(.22,u=>950+3800*Math.sin(Math.PI*u),.35,1.6),.008);
  return a;
}
function fall() {
  const a=blank(.35);mix(a,wood(.13,245,.12));
  mix(a,air(.22,u=>1700-1200*u,.28,1.3),.012);
  mix(a,wood(.085,167,.055),.145);mix(a,wood(.06,220,.022),.235);
  return a;
}
function master(a) {
  const b=hp(a,110);let max=0;
  for(let i=0;i<b.length;i++){b[i]*=clamp(Math.min(i/(RATE*.001),(b.length-i-1)/(RATE*.012)),0,1);max=Math.max(max,Math.abs(b[i]));}
  for(let i=0;i<b.length;i++)b[i]*=.68/(max||1);
  return b;
}
function encode(a) {
  const b=Buffer.alloc(44+2*a.length);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(RATE,24);b.writeUInt32LE(RATE*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(a.length*2,40);
  for(let i=0;i<a.length;i++)b.writeInt16LE(Math.round(clamp(a[i],-1,1)*32767),44+2*i);return b;
}
const takes={'bow-draw':master(draw()),'bow-release':master(release()),'pistol':master(pistol()),'shotgun':master(shotgun()),'mine-place':master(mine()),'dagger-dash':master(dash()),'fall':master(fall())};
const burst=blank(1.56);for(let t=0;t<1.5;t+=.12)mix(burst,takes.pistol,t,.68);takes['barrage-preview']=burst;
if(!check)fs.mkdirSync(output,{recursive:true});
for(const [name,a] of Object.entries(takes)) {
  const b=encode(a),dest=path.join(output,name+'.wav');
  if(check){if(!fs.existsSync(dest)||!fs.readFileSync(dest).equals(b))throw Error('Rebuild differs: '+name);}else fs.writeFileSync(dest,b);
  let peak=0,power=0;for(const x of a){if(!Number.isFinite(x))throw Error('Invalid PCM');peak=Math.max(peak,Math.abs(x));power+=x*x;}
  if(peak>.69||Math.sqrt(power/a.length)<.005)throw Error('Level invalid: '+name);
  console.log(name+': '+(a.length/RATE).toFixed(3)+'s, '+b.length+' bytes, peak '+peak.toFixed(3)+', RMS '+Math.sqrt(power/a.length).toFixed(3));
}
