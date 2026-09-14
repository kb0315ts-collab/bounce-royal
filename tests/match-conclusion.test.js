'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { annotate } = require('../js/match-conclusion.js');
const { Room } = require('../server/room.js');
const core = require('../server/game-core.js');
const { snapshot } = require('../server/snapshot.js');
const { netBattleView, lerpSnapshot } = require('../js/net.js');
const { Director } = require('../js/commentary-core.js');

function roomOf(coins = [2, 1, 0, 0]) {
  const logs = [[], [], [], []];
  const room = new Room(coins.map((_, i) => ({ name:'P'+i, charId:'cat',
    conn:{ alive:true, token:'test'+i, send:m=>logs[i].push(m) } })));
  clearInterval(room.tickTimer);
  room.players.forEach((p, i) => Object.assign(p, { coins:coins[i], eliminated:coins[i] <= 0,
    weaponId:'sword', elimOrder:coins[i] <= 0 ? i : 0 }));
  room.round = 7; room.phase = 'battle'; room.elimCounter = 4;
  room.battles = [new core.Battle('diamond', room.aliveOf())];
  room.logs = logs;
  return room;
}
const preview = room => annotate(room, copy => Room.prototype.resolveRound.call(copy));
const metrics = room => JSON.stringify({ players:room.players.map(({conn,...p})=>p),
  round:room.round, phase:room.phase, elimCounter:room.elimCounter,
  eventCoinReversalRound:room.eventCoinReversalRound,
  steer:room.battles.map(b=>b.fighters.map(f=>({steer:f.steer,splits:f.splitBalls.map(s=>s.steer)}))) });

test('decisive result announces the champion without touching real settlement, steering, RNG or messages', () => {
  const room = roomOf(); const b = room.battles[0];
  try {
    core.setSteerInput(b.fighters[0], 1, .8);
    b.finish(b.fighters[0], '격파');
    const before = metrics(room), random = Math.random;
    let conclusion;
    try { Math.random = () => { throw Error('preview consumed RNG'); }; conclusion = preview(room); }
    finally { Math.random = random; }
    assert.equal(conclusion.id, 0); assert.equal(b.matchConclusion, conclusion);
    assert.equal(metrics(room), before); assert.ok(room.logs.every(log=>!log.length));
    assert.equal(annotate(room, ()=>{throw Error('settled twice');}),null);
    room.resolveRound(); assert.deepEqual(room.aliveOf().map(p=>p.id),[conclusion.id]);
  } finally { room.close(); }
});

test('normal rounds, coin protection, surviving splits and unfinished other battles cannot announce final GG', () => {
  for (const kind of ['normal','troll','event','split','other']) {
    const room = roomOf(kind==='normal'?[2,2,0,0]:kind==='other'?[1,1,1,1]:undefined);
    try {
      const b=room.battles[0];
      if(kind==='troll')room.players[1].trollCondition=true;
      if(kind==='event')room.eventCoinReversalRound=room.round;
      if(kind==='split'){ b.fighters[1].mainDead=true;b.fighters[1].splitBalls=[{hp:10,dead:false}]; }
      else b.finish(b.fighters[0],'격파');
      if(kind==='other')room.battles.push(new core.Battle('diamond',room.players.slice(2)));
      assert.equal(preview(room),null,kind);assert.equal(b.matchConclusion,undefined,kind);
    }finally{room.close();}
  }
});

test('actual contract and event settlement determine who wins, not the last attacker', () => {
  for (const kind of ['gamble','troll-win','draw','both-out','ffa']) {
    const room=roomOf(kind==='gamble'?[3,2,0,0]:kind==='troll-win'?[1,2,0,0]:kind==='both-out'?[1,1,0,0]:kind==='ffa'?[1,1,1,0]:[2,1,0,0]);
    try {
      const b=room.battles[0];
      if(kind==='gamble')room.players[1].gamble=true;
      if(kind==='troll-win')room.players[0].trollCondition=true;
      if(kind==='ffa')b.eventFfa=true;
      b.finish(kind==='draw'||kind==='both-out'?null:b.fighters[0],kind==='draw'?'무승부':'체력 비율 판정');
      const conclusion=preview(room);
      if(kind==='ffa'){assert.equal(conclusion,null,'FFA runner-up retains their last coin');continue;}
      assert.equal(conclusion.id,kind==='troll-win'?1:0,kind);
      room.resolveRound();
      const actual=room.aliveOf()[0]||room.players[0];assert.equal(conclusion.id,actual.id,kind);
    }finally{room.close();}
  }
});

test('server tick carries GG in the first decisive snapshot, before roundEnd/gameOver delays', () => {
  const room=roomOf(); const b=room.battles[0];
  try {
    const before=snapshot(b); b.finish(b.fighters[0],'체력 비율 판정');
    room.snapAcc=1;room.tick();
    const packet=room.logs[0].find(m=>m.t==='s');
    assert.equal(packet.b.mc.id,0); assert.equal(packet.b.res.w,0);
    assert.equal(room.phase,'battle');assert.equal(room.players[1].coins,1);
    assert.ok(!room.logs[0].some(m=>m.t==='roundEnd'||m.t==='gameOver'));
    const blended=lerpSnapshot(before,packet.b,.5,50);
    const view=netBattleView(blended,room.publicPlayers(),0);
    assert.equal(view.matchConclusion.id,0);assert.ok(view.result);
    assert.equal(netBattleView(before,room.publicPlayers(),0).matchConclusion,undefined,'old servers remain compatible');
  }finally{room.close();}
});

test('GG at the decisive instant and later result-screen fallback share one match dedup key', () => {
  const d=new Director(),champion={id:0,name:'우승자',color:'#123456'};
  const line=d.decideMatch(champion,10,'match1');assert.equal(line.gg,true);
  assert.equal(d.decideMatch(champion,20,'match1'),null);
  assert.equal(d.finishMatch([{...champion,rank:1},{id:1,rank:2}],1000,'match1'),null);
  assert.equal(d.decideMatch(champion,2000,'match2').gg,true);
});
