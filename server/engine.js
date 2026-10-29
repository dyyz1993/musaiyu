// 木虱鱼 duobi-v1 引擎 (前后端共用)
const PRESET = {
  name: "duobi-v1",
  startCards: 2,                   // 起手 2 张(SPEC: 起手2+补1=最多3)
  maxCards: 3,                     // 最多 3 张
  deckSize: 55,                 // 52 + 大小王 + 1 张万能鬼（v1.1 冻结：使三鬼可达，同源码版牌组）
  straightAce: ["QKA","A23"],   // QKA、A23 成顺；KA2 不成
  // R2 冻结顺序: 双鬼＞天公9＞天公8＞三鬼＞真豹子＞同花顺＞假豹子＞混顺＞普通＞木虱
  order: ["shuangGui","tianGong9","tianGong8","sanGui","zhenBaoZi","tongHuaShun","jiaBaoZi","hunShun","normal","muShi"],
  mult: { shuangGui:10, sanGui:15, zhenBaoZi:10, tongHuaShun:8, jiaBaoZi:6, hunShun:4, muShiAntiShuangGui:10, normal:1 },
  special: {
    muShiBeatsShuangGui: true,     // 循环克制: 木虱反克双鬼(双向显式)
    sanGuiLosesToTianGong: true,   // 三鬼输天公9/8（双向显式, R2 明确）
    tianGongNaturalOnly: true,     // 天公必须无鬼（源码证据）
    shuangGuiPlusNormalAsShuangGui: true, // 双鬼+1普通 → 冻结为按双鬼(10倍)
    jokerTongHuaShunAsTongHuaShun: true,  // 含鬼同花顺 → 同花顺8倍
    jokerBaoZiAsJiaBaoZi: true,           // 含鬼豹子 → 假豹子6倍
  },
  tiePolicy: "push",
};

/* ---------- 牌 ---------- */
const SUITS = ["♠","♥","♣","♦"];
const SUIT_L = {"♠":"S","♥":"H","♣":"C","♦":"D"};
const RANK_STR = {1:"A",11:"J",12:"Q",13:"K"};
function rankStr(r){ return RANK_STR[r] || String(r); }
function buildDeck(){
  const d=[];
  for(const s of SUITS) for(let r=1;r<=13;r++) d.push({suit:s,rank:r,joker:false});
  d.push({suit:"🃏",rank:0,joker:true,red:true});
  d.push({suit:"🃏",rank:0,joker:true,red:false});
  d.push({suit:"☆",rank:0,joker:true,red:true});   // 第3张万能鬼(v1.1, 使三鬼可达)
  return d;
}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function pip(c){ return c.joker?0:(c.rank>10?10:c.rank); }
function points(cs){ return cs.filter(c=>!c.joker).reduce((s,c)=>s+pip(c),0)%10; }

/* ---------- 引擎 1: classifyHand —— 牌型识别（顺序即优先级来源，比较走 compareHands） ---------- */
function classifyHand(cards){
  const jokers = cards.filter(c=>c.joker).length;
  const natural = jokers===0;
  const n = cards.length;
  const isSameSuit = natural && cards.every(c=>c.suit===cards[0].suit);
  const isTriplet  = natural && n===3 && cards.every(c=>c.rank===cards[0].rank);
  const isPair2    = n===2 && natural && cards[0].rank===cards[1].rank;
  const isFlush    = natural && isSameSuit;
  const straightOf = cs => {
    if(cs.length!==3 || cs.some(c=>c.joker)) return false;
    const rs=[...new Set(cs.map(c=>c.rank))].sort((a,b)=>a-b);
    if(rs.length<3) return false;
    const s=rs.join(",");
    if(s==="1,12,13") return PRESET.straightAce.includes("QKA");  // QKA 成顺
    if(s==="1,2,13") return false;                                 // KA2 不成(duobi-v1 冻结)
    if(s==="1,2,3") return PRESET.straightAce.includes("A23");
    return rs[2]-rs[0]===2 && rs[1]-rs[0]===1;
  };
  const isStraight = straightOf(cards);

  // 含鬼牌组合
  if(jokers===3 && n===3) return {type:"sanGui",pts:0};   // 三鬼(需55张牌组的第3张万能鬼)
  if(jokers===2 && n===2) return {type:"shuangGui",pts:0};
  if(jokers===2 && n===3) return PRESET.special.shuangGuiPlusNormalAsShuangGui
      ? {type:"shuangGui",pts:0} : {type:"normal",pts:points(cards)};
  if(jokers===1 && n===3){
    // 含鬼同花顺：鬼补成同色顺子（简化：剩两张同花且点差≤2 视为可成顺）
    const rest=cards.filter(c=>!c.joker);
    const canSF = rest[0].suit===rest[1].suit && Math.abs(pip(rest[0])-pip(rest[1]))<=2;
    if(PRESET.special.jokerTongHuaShunAsTongHuaShun && canSF) return {type:"tongHuaShun",pts:points(cards),joker:true};
  }
  if(jokers===1 && n===2) return {type:"normal",pts:points(cards)};

  // 天然牌型
  if(natural){
    if(n===2){
      if(points(cards)===9) return {type:"tianGong9",pts:9,multBonus:isFlush||isPair2?2:1};
      if(points(cards)===8) return {type:"tianGong8",pts:8,multBonus:isFlush||isPair2?2:1};
    }
    if(n===3){
      if(isSameSuit&&isStraight) return {type:"tongHuaShun",pts:points(cards)};
      if(isTriplet) return {type:"zhenBaoZi",pts:points(cards)};
      if(isStraight) return {type:"hunShun",pts:points(cards)};
    }
    if(points(cards)===0) return {type:"muShi",pts:0};
  }
  // 含鬼三张的豹子（鬼当任意点）
  if(jokers===1 && n===3){
    const rest=cards.filter(c=>!c.joker);
    if(rest[0].rank===rest[1].rank) return PRESET.special.jokerBaoZiAsJiaBaoZi
      ? {type:"jiaBaoZi",pts:points(cards),joker:true} : {type:"normal",pts:points(cards)};
  }
  return {type:"normal",pts:points(cards)};
}

/* ---------- 引擎 2: compareHands —— 两两比较（表驱动 + 双向反克，禁止总分排序） ---------- */
function compareHands(A,B){
  const a=classifyHand(A), b=classifyHand(B);
  const ORD=PRESET.order, idx=t=>ORD.indexOf(t);
  // 循环克制：双向显式
  if(PRESET.special.muShiBeatsShuangGui){
    if(a.type==="muShi"&&b.type==="shuangGui") return {r:1,a,b};
    if(a.type==="shuangGui"&&b.type==="muShi") return {r:-1,a,b};
  }
  // 三鬼输天公（双向）
  if(PRESET.special.sanGuiLosesToTianGong){
    if(a.type==="sanGui"&&(b.type==="tianGong9"||b.type==="tianGong8")) return {r:-1,a,b};
    if(b.type==="sanGui"&&(a.type==="tianGong9"||a.type==="tianGong8")) return {r:1,a,b};
  }
  const ia=idx(a.type), ib=idx(b.type);
  if(ia!==ib) return {r:ia<ib?1:-1,a,b};
  if(a.type!=="normal"&&a.type!=="muShi") return {r:0,a,b};   // 特殊牌型同级判平
  if(a.pts!==b.pts) return {r:a.pts>b.pts?1:-1,a,b};
  return {r:0,a,b};                                            // 平局 push
}

/* ---------- 引擎 3: payoutMultiplier —— 赢家的结算倍率（牌型大小与倍率分离） ---------- */
function payoutMultiplier(res){
  const m=PRESET.mult;
  switch(res.type){
    case "shuangGui": return m.shuangGui;
    case "sanGui": return m.sanGui;
    case "zhenBaoZi": return m.zhenBaoZi;
    case "tongHuaShun": return m.tongHuaShun;
    case "jiaBaoZi": return m.jiaBaoZi;
    case "hunShun": return m.hunShun;
    case "muShi": return m.muShiAntiShuangGui;   // 木虱只在反克双鬼时赢, 倍率10
    case "tianGong9": case "tianGong8": return res.multBonus||1;
    default: { // normal: 两张同花/对子 ×2, 三张同花 ×3
      const cs=res._cards||[];
      const nat=cs.filter(c=>!c.joker);
      const flush=nat.length===cs.length&&cs.every(c=>c.suit===cs[0].suit);
      const pair=cs.length===2&&cs[0].rank===cs[1].rank;
      if(cs.length===3&&flush) return 3;
      if((cs.length===2&&flush)||pair) return 2;
      return m.normal;
    }
  }
}

/* ---------- 引擎 4: settleRound —— 全员互比逐对结算（冻结: 净输赢=底注×倍率, 平局0） ---------- */
function settleRound(players){
  const ledger=Object.fromEntries(players.map(p=>[p.id,0]));
  // 可支付余额随结算递减: 一人连输多对时累计扣款不超过其余额(审查二轮修复)
  const avail=Object.fromEntries(players.map(p=>[p.id,p.chips]));
  const pairs=[];
  for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++){
    const P=players[i],Q=players[j];
    const {r,a,b}=compareHands(P.cards,Q.cards);
    if(r===0){pairs.push({w:null,p1:P,p2:Q,mult:0,paid:0});continue;}
    const W=r>0?P:Q, L=r>0?Q:P;
    const Wr=classifyHand(W.cards);
    const mult=payoutMultiplier({...Wr,_cards:W.cards});
    // 封顶赔付: 实际转账不超过输家当前可支付余额, 赢加=输减, 禁止负数
    const delta=Math.min(W.stake*mult, Math.max(0,avail[L.id]));
    avail[L.id]-=delta; avail[W.id]+=delta;
    ledger[W.id]+=delta; ledger[L.id]-=delta;
    pairs.push({w:W.id,p1:P,p2:Q,mult,winType:Wr.type,paid:delta});
  }
  return {ledger,pairs};
}


/* ---------- 自测：SPEC 15 条 case 中的关键判定 ---------- */
function selfTest(){
  const C=(s,r)=>({suit:s,rank:r,joker:false});
  const J=(red)=>({suit:"🃏",rank:0,joker:true,red});
  const t=[];const eq=(name,got,want)=>t.push({name,ok:JSON.stringify(got)===JSON.stringify(want),got,want});
  const ty=cs=>classifyHand(cs).type;
  eq("天公9", ty([C("♠",4),C("♥",5)]), "tianGong9");
  eq("木虱(2张0点)", ty([C("♠",3),C("♥",7)]), "muShi");
  eq("JQK先判顺(0点但不是木虱)", ty([C("♠",11),C("♥",12),C("♦",13)]), "hunShun");
  eq("双鬼", ty([J(true),J(false)]), "shuangGui");
  eq("三鬼(3张鬼,55牌组可达)", ty([J(true),J(false),J(true)]), "sanGui");
  eq("木虱克双鬼(正向)", compareHands([C("♠",3),C("♥",7)],[J(true),J(false)]).r, 1);
  eq("木虱克双鬼(反向,源码缺陷修复)", compareHands([J(true),J(false)],[C("♠",3),C("♥",7)]).r, -1);
  eq("双鬼胜天公9(R2: 双鬼＞天公)", compareHands([J(true),J(false)],[C("♠",4),C("♥",5)]).r, 1);
  eq("天公9胜双鬼(反向)", compareHands([C("♠",4),C("♥",5)],[J(true),J(false)]).r, -1);
  eq("三鬼输天公9(双向1)", compareHands([J(true),J(false),J(true)],[C("♠",4),C("♥",5)]).r, -1);
  eq("三鬼输天公9(双向2)", compareHands([C("♠",4),C("♥",5)],[J(true),J(false),J(true)]).r, 1);
  eq("真豹子胜同花顺(R2冻结)", compareHands([C("♠",9),C("♥",9),C("♦",9)],[C("♠",9),C("♠",10),C("♠",11)]).r, 1);
  eq("对子10K不是木虱(豹子优先3张)", ty([C("♠",10),C("♥",10),C("♦",10)]), "zhenBaoZi");
  eq("QKA成顺", ty([C("♠",12),C("♥",13),C("♦",1)]), "hunShun");
  eq("KA2不成顺(duobi冻结,独立分支)", ty([C("♠",13),C("♥",1),C("♦",2)]), "normal");
  eq("平局: 同为7点", compareHands([C("♠",3),C("♥",4)],[C("♣",3),C("♦",4)]).r, 0);
  eq("同花天公9 ×2", payoutMultiplier({...classifyHand([C("♠",4),C("♠",5)]),_cards:[C("♠",4),C("♠",5)]}), 2);
  eq("对子天公8 ×2", payoutMultiplier({...classifyHand([C("♠",4),C("♥",4)]),_cards:[C("♠",4),C("♥",4)]}), 2);
  eq("含鬼豹子→假豹子6", classifyHand([C("♠",9),C("♥",9),J(true)]).type, "jiaBaoZi");
  eq("假豹子倍率6", payoutMultiplier({...classifyHand([C("♠",9),C("♥",9),J(true)]),_cards:[C("♠",9),C("♥",9),J(true)]}), 6);
  eq("封顶赔付: 连输多对累计不超余额且守恒", (()=>{
    const ps=[{id:"a",cards:[C("♠",3),C("♥",7)],stake:1000,chips:300},
              {id:"b",cards:[C("♠",4),C("♥",5)],stake:1000,chips:5000},
              {id:"c",cards:[C("♣",6),C("♦",6)],stake:1000,chips:5000}];
    const {ledger}=settleRound(ps);
    const zeroSum=ledger.a+ledger.b+ledger.c===0;
    const noNeg=Object.entries(ledger).every(([id,v])=>v>=-({a:300,b:5000,c:5000})[id]);
    // a 连输两对: 第1对封顶付300, 第2对余额0付0; b 还赢 c 一对 1000
    const capped=ledger.a===-300&&ledger.b===1300&&ledger.c===-1000;
    return zeroSum&&noNeg&&capped;
  })(), true);
  return t;
}



module.exports = { PRESET, SUITS, SUIT_L, RANK_STR, rankStr, buildDeck, shuffle, pip, points,
  classifyHand, compareHands, payoutMultiplier, settleRound };
