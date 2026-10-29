
await Promise.all([
  figma.loadFontAsync({family:"Noto Sans SC", style:"Regular"}),
  figma.loadFontAsync({family:"Noto Sans SC", style:"Medium"}),
  figma.loadFontAsync({family:"Noto Sans SC", style:"Bold"}),
]);
// 清理上次半成品
const old = figma.currentPage.children.find(n => n.name === "木虱鱼·竖屏 9 人局");
if (old) old.remove();
const H = {
  "card-8H":"080c042a0711923bb8a017ec4c123670459fbc2d","card-AS":"011a276d25a438d9de189876fc1b028867c1b6b7",
  "avatar-m1":"6231acc3b7e28129e227acec3b3f795d752f6a7a","avatar-m2":"9561744db7254b8da6358e6afe9070526c6601bc",
  "avatar-m3":"a2da9b465cb06ffdc2dd1d76d82b7f6178c00c27","avatar-f1":"1c465f4357b4acef0e08ae23049262f84e063565",
  "avatar-f2":"4321c720172aad33424ef305144d0f1d19f69f97","avatar-f3":"e2902a6404704246cd3fcdbc1d1301b9d50d9160",
  "chip":"70d87a896208690ff85de02038b584124a5d385b","table":"6fd5fd55ac6b696585588108f117e37b7e6b7f20",
  "topbar":"06a1fedd81d198cbfae9dbbb4de3601b72794bfb","btn-stop":"74abaa457bfa63dce372ed959fccf377f6508b19",
  "btn-draw":"74a4b9c913712798569b59981e2188ca71397cbc","banner":"ca4d6fa7ce996bb26af9b62c2d1dbc261255e14d",
  "badge":"6d0d6ea42ca0f5065f4a763de6b80c3ede1fc8e7","card-back":"d9b01907007653daaeb22072406a6e28af385aa1"};
function styleOf(w){ return typeof w === "number" ? (w >= 600 ? "Bold" : w >= 500 ? "Medium" : "Regular") : (w || "Regular"); }
const ids = [];
function img(parent,n,x,y,w,h,name){const r=figma.createRectangle();r.resize(w,h);r.x=x;r.y=y;r.fills=[{type:"IMAGE",imageHash:H[n],scaleMode:"FILL"}];if(name)r.name=name;parent.appendChild(r);ids.push(r.id);return r;}
function txt(parent,x,y,s,size,fill,weight,align){
  const t=figma.createText(); t.fontName={family:"Noto Sans SC",style:styleOf(weight)};
  t.characters=s; t.fontSize=size; t.fills=[{type:"SOLID",color:fill}];
  if(align) t.textAlignHorizontal=align.toUpperCase();
  parent.appendChild(t); t.x=x; t.y=y-size; ids.push(t.id); return t;
}
const WHITE={r:1,g:1,b:1}, GOLD={r:1,g:0.851,b:0.478}, INFO={r:0.624,g:0.902,b:0.749};

const main=figma.createFrame(); main.name="木虱鱼·竖屏 9 人局"; main.resize(390,760); main.x=1500; main.y=0;
main.fills=[{type:"SOLID",color:{r:0.039,g:0.039,b:0.047}}];
figma.currentPage.appendChild(main); ids.push(main.id);

txt(main,16,32,"9:41",13,WHITE,600);
const batt=figma.createRectangle(); batt.resize(20,11); batt.x=352; batt.y=16; batt.cornerRadius=2.5;
batt.fills=[]; batt.strokes=[{type:"SOLID",color:WHITE}]; batt.strokeWeight=1; main.appendChild(batt); ids.push(batt.id);
const battIn=figma.createRectangle(); battIn.resize(13,7); battIn.x=354; battIn.y=18; battIn.cornerRadius=1;
battIn.fills=[{type:"SOLID",color:WHITE}]; main.appendChild(battIn); ids.push(battIn.id);

img(main,"table",0,44,390,696,"桌面背景");
const dim=figma.createRectangle(); dim.resize(390,696); dim.x=0; dim.y=44;
dim.fills=[{type:"SOLID",color:{r:4/255,g:16/255,b:10/255},opacity:0.36}]; main.appendChild(dim); ids.push(dim.id);

img(main,"topbar",14,50,362,40,"顶栏底条");
txt(main,28,76,"木虱鱼 · 闸坡厅",13,WHITE,700);
const info=txt(main,138,76,"房号 882010 · 第 8 局 · 底注 200 · 池底 800",10.5,WHITE,400); info.opacity=0.75;

const ring=figma.createEllipse(); ring.resize(300,300); ring.x=23; ring.y=139;
ring.fills=[]; ring.strokes=[{type:"SOLID",color:{r:0.851,g:0.706,b:0.363},opacity:0.34}]; ring.strokeWeight=1.5; ring.dashPattern=[6,5];
main.appendChild(ring); ids.push(ring.id);

const SEATS=[139,90,41,175,5,195,345,222];
const NAMES=["阿强","老陈","阿玲","阿海","阿芳","阿坤","阿杰","阿宝"];
const CHIPS=["6,200","18,400","3,150","1,980","9,560","4,720","880","15,300"];
const AV=["avatar-m1","avatar-m3","avatar-f1","avatar-m2","avatar-f3","avatar-f2","avatar-m1","avatar-f1"];
const CX=173, CY=289, R=150;
const chipImg=(p,x,y,s)=>{const c=figma.createRectangle();c.resize(s,s);c.x=x;c.y=y;c.fills=[{type:"IMAGE",imageHash:H["chip"],scaleMode:"FILL"}];p.appendChild(c);ids.push(c.id);return c;};
for (let i=0;i<8;i++){
  const a=SEATS[i]*Math.PI/180;
  const x=CX+R*Math.cos(a), y=CY-R*Math.sin(a);
  const vertical=Math.abs(SEATS[i]-90)<=45, left=SEATS[i]>90;
  const seat=figma.createFrame(); seat.name="座位·"+NAMES[i]; seat.resize(170,120); seat.fills=[]; seat.clipsContent=false;
  main.appendChild(seat); ids.push(seat.id);
  const av=figma.createEllipse(); av.resize(32,32); av.x=x-16; av.y=-16;
  av.fills=[{type:"IMAGE",imageHash:H[AV[i]],scaleMode:"FILL"}]; seat.appendChild(av); ids.push(av.id);
  if (vertical){
    txt(seat,x-32,y+30,NAMES[i],9.5,WHITE,500,"center");
    chipImg(seat,x-11,y+35,10); txt(seat,x+3,y+44,CHIPS[i],9,GOLD,400);
    img(seat,"card-back",x-28,y+50,20,28); img(seat,"card-back",x+1,y+50,20,28);
  } else if (left){
    txt(seat,x+20,y+6,NAMES[i],10,WHITE,500);
    chipImg(seat,x+20,y+12,11); txt(seat,x+34,y+21,CHIPS[i],9.5,GOLD,400);
    img(seat,"card-back",x+62,y-14,20,28); img(seat,"card-back",x+84,y-14,20,28);
  } else {
    txt(seat,x-20,y+6,NAMES[i],10,WHITE,500,"right");
    chipImg(seat,x-64,y+12,11); txt(seat,x-50,y+21,CHIPS[i],9.5,GOLD,400);
    img(seat,"card-back",x-110,y-14,20,28); img(seat,"card-back",x-88,y-14,20,28);
  }
  if (i===0){ img(seat,"badge",x-22,y+5,22,22,"庄章"); }
  seat.x = vertical ? x-85 : (left ? x-19 : x-151);
  seat.y = vertical ? y-16 : y-19;
}

img(main,"banner",CX-110,413,220,64,"横幅·等待玩家补牌");

const me=figma.createFrame(); me.name="我方区域"; me.resize(390,270); me.x=0; me.y=490; me.fills=[];
me.clipsContent=false; main.appendChild(me); ids.push(me.id);
const mav=figma.createEllipse(); mav.resize(40,40); mav.x=23; mav.y=5;
mav.fills=[{type:"IMAGE",imageHash:H["avatar-m3"],scaleMode:"FILL"}]; me.appendChild(mav); ids.push(mav.id);
txt(me,70,18,"阿洲（我 · 固定庄底位）",13,WHITE,600);
chipImg(me,70,26,14); txt(me,88,38,"12,400",12,GOLD,400);
txt(me,376,30,"当前 9 点 · 天公",12,INFO,400,"right");
txt(me,376,47,"同花 ×2",11,GOLD,600,"right");
img(me,"cardAS",68,58,78,106); img(me,"card8H",156,58,78,106);
const slot=figma.createRectangle(); slot.resize(78,106); slot.x=244; slot.y=58; slot.cornerRadius=8;
slot.fills=[{type:"SOLID",color:{r:1,g:1,b:1},opacity:0.03}];
slot.strokes=[{type:"SOLID",color:WHITE,opacity:0.45}]; slot.strokeWeight=1.5; slot.dashPattern=[5,4];
me.appendChild(slot); ids.push(slot.id);
txt(me,283,116,"+",22,WHITE,400,"center").opacity=0.6;
txt(me,283,140,"补牌位",11,WHITE,400,"center").opacity=0.6;
img(me,"btn-stop",14,178,178,46,"按钮·停牌");
img(me,"btn-draw",198,178,178,46,"按钮·补一张");

return {createdNodeIds: ids, mainFrameId: main.id, seatCount: 8};
