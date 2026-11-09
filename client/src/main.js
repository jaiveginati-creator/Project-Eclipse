import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const $ = (id) => document.getElementById(id);

const PROFILE_ID=(()=>{try{let id=localStorage.getItem('eclipse-profile-id');if(!/^[a-f0-9-]{36}$/i.test(id||'')){id=crypto.randomUUID();localStorage.setItem('eclipse-profile-id',id);}return id;}catch{return crypto.randomUUID();}})();
let playerProfile={xp:0,level:1,stats:{matches:0,kills:0,deaths:0,wins:0},weaponXP:{},builds:{},matchHistory:[],lastMatchXP:0};
let weaponBuilds={};
const XP_LEVELS=[0,500,1200,2100,3300,4800,6600,8700,11100,13800,16800,20100,23700,27600,31800];
const WEAPON_UNLOCK_LEVEL={pulse:1,volt:1,magnum:2,arc:3,shotgun:4,burst:5,needler:6,rocket:8,sniper:1};
const OPERATOR_UNLOCK_LEVEL={vanguard:1,recon:3,assault:6,phantom:9};
const ATTACHMENT_UNLOCK_XP={ammoType:{standard:0,incendiary:0,shock:0,rapid:0,heavy:0,explosive:0},barrel:{standard:0,extended:250,heavy:650},magazine:{standard:0,extended:350,quick:550},stock:{standard:0,tactical:450,weighted:750},underbarrel:{none:0,grip:300,laser:700}};
const CAMO_UNLOCK_LEVEL={standard:1,arctic:4,ember:7,void:10};
const DEFAULT_WEAPON_BUILD={name:'FIELD STANDARD',ammoType:'standard',barrel:'standard',magazine:'standard',stock:'standard',underbarrel:'none',camo:'standard'};
function levelForXP(xp){let level=1;for(let i=1;i<XP_LEVELS.length;i++){if(xp>=XP_LEVELS[i])level=i+1;else break;}return level;}
function xpForCurrentLevel(level){return XP_LEVELS[Math.max(0,Math.min(level-1,XP_LEVELS.length-1))]||0;}
function xpForNextLevel(level){return XP_LEVELS[Math.min(level,XP_LEVELS.length-1)]||XP_LEVELS[XP_LEVELS.length-1];}
function getWeaponBuild(id){return {...DEFAULT_WEAPON_BUILD,...(weaponBuilds[id]||{})};}
function weaponDisplayName(weapon){const name=weapon.build?.name||getWeaponBuild(weapon.id).name;return name&&name!=='FIELD STANDARD'?name:weapon.name;}
function weaponBuildDetails(weapon){const b=weapon.build||getWeaponBuild(weapon.id);const labels={ammoType:{standard:'Standard ammo',incendiary:'Incendiary ammo',shock:'Shock ammo',rapid:'Rapid-fire ammo',heavy:'Heavy ammo',explosive:'Explosive ammo'},barrel:{standard:'Standard barrel',extended:'Extended barrel',heavy:'Heavy barrel'},magazine:{standard:'Standard mag',extended:'Extended mag',quick:'Quick reload'},stock:{standard:'Standard stock',tactical:'Tactical stock',weighted:'Weighted stock'},underbarrel:{none:'No underbarrel',grip:'Grip',laser:'Laser'},camo:{standard:'Standard camo',arctic:'Arctic',ember:'Ember',void:'Void'}};return ['ammoType','barrel','magazine','stock','underbarrel','camo'].map(slot=>labels[slot]?.[b[slot]]||b[slot]).join(' · ');}
function refreshLoadoutOptions(){for(const [selectId,weaponsList] of [['primary-select',PRIMARY_WEAPONS],['secondary-select',SECONDARY_WEAPONS]]){const select=$(selectId);if(!select)continue;for(const option of select.options){const base=weaponsList.find(w=>w.id===option.value);if(!base)continue;const build=getWeaponBuild(base.id),custom=build.name&&build.name!=='FIELD STANDARD';option.textContent=custom?base.name+' — '+build.name:base.name;}}}
function getBuiltWeapon(base){const build=getWeaponBuild(base.id),w={...base,build,ammoType:build.ammoType||'standard'};if(build.magazine==='extended'){w.mag=Math.round(base.mag*1.4);w.stock=Math.round(base.stock*1.35);}if(build.magazine==='quick')w.rate=Math.round(base.rate*.93);if(build.stock==='tactical')w.rate=Math.round(w.rate*.94);if(build.barrel==='heavy')w.rate=Math.round(w.rate*1.12);if(w.ammoType==='rapid')w.rate=Math.max(55,Math.round(w.rate*.72));if(w.ammoType==='heavy')w.rate=Math.round(w.rate*1.2);if(['rocket','needler'].includes(base.id)){w.explosive=true;} if(w.ammoType==='incendiary')w.color=0xff744a;if(w.ammoType==='shock')w.color=0x7b8dff;if(w.ammoType==='explosive'){w.color=0xffa64d;w.explosive=true;}return w;}
function refreshProgressionUI(){
 const level=playerProfile.level||levelForXP(playerProfile.xp||0),xp=playerProfile.xp||0,current=xpForCurrentLevel(level),next=xpForNextLevel(level);
 if($('profile-level'))$('profile-level').textContent='LEVEL '+level+' · '+xp.toLocaleString()+' XP';
 if($('xp-fill'))$('xp-fill').style.width=(next>current?Math.max(0,Math.min(100,(xp-current)/(next-current)*100)):100)+'%';
 const stats=playerProfile.stats||{};for(const [id,value] of [['armory-level',level],['armory-xp',xp.toLocaleString()],['armory-kills',stats.kills||0],['armory-deaths',stats.deaths||0],['armory-wins',stats.wins||0],['armory-matches',stats.matches||0]])if($(id))$(id).textContent=String(value);
 const history=$('match-history');if(history){history.innerHTML='';(playerProfile.matchHistory||[]).slice(0,8).forEach(m=>{const row=document.createElement('div');row.className='history-row';const left=document.createElement('span');left.textContent=(m.mode||'MATCH').toUpperCase()+' · '+(m.map||'').toUpperCase()+' · '+(m.kills||0)+' K';const right=document.createElement('b');right.textContent='+'+(m.xp||0)+' XP';row.append(left,right);history.append(row);});if(!history.children.length)history.textContent='NO MATCHES RECORDED YET';}
 document.querySelectorAll('[data-operator]').forEach(b=>{const required=OPERATOR_UNLOCK_LEVEL[b.dataset.operator]||99;b.disabled=required>level;b.title=required>level?'Unlocks at level '+required:'';});
 for(const id of ['primary-select','secondary-select','armory-weapon']){const select=$(id);if(select)Array.from(select.options).forEach(o=>{const required=WEAPON_UNLOCK_LEVEL[o.value]||99;o.disabled=required>level;});}
 updateArmoryAttachments();
}
function acceptProfile(profile){if(!profile)return;const previousLevel=playerProfile.level||1;playerProfile=profile;playerProfile.level=levelForXP(playerProfile.xp||0);if(profile.builds&&Object.keys(profile.builds).length){weaponBuilds=profile.builds;try{localStorage.setItem('eclipse-weapon-builds',JSON.stringify(weaponBuilds));}catch{}}
 if((WEAPON_UNLOCK_LEVEL[selectedPrimary]||99)>playerProfile.level)selectedPrimary='pulse';if((WEAPON_UNLOCK_LEVEL[selectedSecondary]||99)>playerProfile.level)selectedSecondary='volt';if((OPERATOR_UNLOCK_LEVEL[selectedOperator]||99)>playerProfile.level)selectedOperator='vanguard';
 if($('primary-select'))$('primary-select').value=selectedPrimary;if($('secondary-select'))$('secondary-select').value=selectedSecondary;setOperator(selectedOperator,false);refreshProgressionUI();applyLoadout(true);updateArmoryPreview();updateDevMenuStatus();if(playerProfile.level>previousLevel)toast('LEVEL UP · LEVEL '+playerProfile.level);}
function updateArmoryAttachments(){
 const id=$('armory-weapon')?.value||selectedPrimary,xp=Number(playerProfile.weaponXP?.[id])||0;
 const innateBlast=['rocket','needler'].includes(id);const options={ammoType:innateBlast?[['standard','INNATE EXPLOSIVE']]:[['standard','Standard'],['incendiary','Incendiary'],['shock','Shock'],['rapid','Rapid-fire'],['heavy','Heavy']],barrel:[['standard','Standard barrel'],['extended','Extended barrel'],['heavy','Heavy barrel']],magazine:[['standard','Standard magazine'],['extended','Extended magazine'],['quick','Quick reload magazine']],stock:[['standard','Standard stock'],['tactical','Tactical stock'],['weighted','Weighted stock']],underbarrel:[['none','No underbarrel'],['grip','Stability grip'],['laser','Laser module']]},build=getWeaponBuild(id);
 for(const slot of Object.keys(options)){const select=$('part-'+slot);if(!select)continue;select.innerHTML='';for(const [part,label] of options[slot]){const option=document.createElement('option'),required=ATTACHMENT_UNLOCK_XP[slot][part];option.value=part;option.textContent=required>xp?label+' · '+required+' WPN XP':label;option.disabled=required>xp;select.append(option);}select.value=build[slot];if(slot==='ammoType')select.disabled=innateBlast;}
 const camo=$('part-camo');if(camo){Array.from(camo.options).forEach(o=>{o.disabled=(CAMO_UNLOCK_LEVEL[o.value]||99)>(playerProfile.level||1);});camo.value=build.camo;}
 if($('part-ammoType'))$('part-ammoType').title=innateBlast?'This weapon has built-in explosive projectiles.':'Choose an ammo effect for this weapon.';if($('armory-weapon-xp'))$('armory-weapon-xp').textContent=xp+' WEAPON XP';
}
function updateArmoryPreview(){const id=$('armory-weapon')?.value||selectedPrimary,b=getWeaponBuild(id);if($('armory-build-preview'))$('armory-build-preview').textContent=[b.name||'CUSTOM BUILD',id.toUpperCase(),b.ammoType,b.barrel,b.magazine,b.stock,b.underbarrel,b.camo].join(' / ').toUpperCase();}
function saveArmoryBuild(){
 const id=$('armory-weapon')?.value||selectedPrimary,b={...getWeaponBuild(id),name:($('build-name')?.value||'CUSTOM BUILD').trim().slice(0,22)||'CUSTOM BUILD'};
 for(const slot of ['ammoType','barrel','magazine','stock','underbarrel','camo']){const select=$('part-'+slot);if(select&&!select.disabled&&select.value)b[slot]=select.value;}
 weaponBuilds[id]=b;try{localStorage.setItem('eclipse-weapon-builds',JSON.stringify(weaponBuilds));}catch{}playerProfile.builds=weaponBuilds;applyLoadout(true);buildViewWeapon();updateArmoryPreview();toast('CUSTOM BUILD SAVED');
}

const gameRoot = $('game-root');
const fullscreenButton = $('fullscreen-toggle');
function syncFullscreenButton(){
  const active = Boolean(document.fullscreenElement);
  fullscreenButton?.classList.toggle('is-fullscreen', active);
  if(fullscreenButton){
    fullscreenButton.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    fullscreenButton.title = active ? 'Exit fullscreen (Esc)' : 'Enter fullscreen';
    fullscreenButton.innerHTML = active
      ? '<span class="fullscreen-icon fullscreen-exit" aria-hidden="true"></span><span class="fullscreen-label">EXIT FULLSCREEN</span>'
      : '<span class="fullscreen-icon" aria-hidden="true"></span><span class="fullscreen-label">FULLSCREEN</span>';
  }
}
async function toggleFullscreen(){
  try{
    if(document.fullscreenElement) await document.exitFullscreen();
    else if(gameRoot?.requestFullscreen) await gameRoot.requestFullscreen();
    else toast('FULLSCREEN IS NOT SUPPORTED BY THIS BROWSER');
  }catch(error){
    toast('FULLSCREEN COULD NOT BE ENABLED');
  }
}

const canvas = $('world');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111a25);
scene.fog = new THREE.FogExp2(0x1a2633, 0.012);
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, .08, 180);
scene.add(camera); // Keep the first-person view model attached to a camera that is part of the rendered scene.
const clock = new THREE.Clock();
const hemi = new THREE.HemisphereLight(0x9aaec5, 0x20232a, 1.35); scene.add(hemi);
const moonLight = new THREE.DirectionalLight(0xffd4a1, 2.1); moonLight.position.set(-35, 55, -20); moonLight.castShadow = true; moonLight.shadow.mapSize.set(2048,2048);moonLight.shadow.bias=-.00012;moonLight.shadow.normalBias=.025;moonLight.shadow.radius=3; moonLight.shadow.camera.left=-65;moonLight.shadow.camera.right=65;moonLight.shadow.camera.top=65;moonLight.shadow.camera.bottom=-65; scene.add(moonLight);
const fill = new THREE.DirectionalLight(0x6382a7,.45); fill.position.set(25,15,35);scene.add(fill);

const materials = {
 ground: new THREE.MeshStandardMaterial({color:0x30363a,roughness:.96}),
 asphalt: new THREE.MeshStandardMaterial({color:0x20262c,roughness:.98}),
 concrete: new THREE.MeshStandardMaterial({color:0x646b70,roughness:.9}),
 dark: new THREE.MeshStandardMaterial({color:0x242b32,roughness:.86}),
 glass: new THREE.MeshStandardMaterial({color:0x273d4b,metalness:.55,roughness:.28}),
 amber: new THREE.MeshStandardMaterial({color:0xc58a4d,roughness:.7}),
 trim: new THREE.MeshStandardMaterial({color:0x8d765e,roughness:.8}),
 crate: new THREE.MeshStandardMaterial({color:0x555c57,roughness:.9}),
 pulse: new THREE.MeshBasicMaterial({color:0xffc16e})
};

function makeSurfaceTexture(base,seed=1){
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
 const ctx=canvas.getContext('2d');ctx.fillStyle=base;ctx.fillRect(0,0,256,256);
 let n=seed>>>0;for(let i=0;i<9000;i++){n=(n*1664525+1013904223)>>>0;const x=n%256;n=(n*1664525+1013904223)>>>0;const y=n%256;n=(n*1664525+1013904223)>>>0;const a=.025+(n%35)/1000;ctx.fillStyle=(n&1)?`rgba(220,230,235,${a})`:`rgba(0,0,0,${a})`;ctx.fillRect(x,y,1+(n%3),1+(n%2));}
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(7,7);texture.anisotropy=renderer.capabilities.getMaxAnisotropy();return texture;
}
materials.ground.map=makeSurfaceTexture('#30363a',11);materials.asphalt.map=makeSurfaceTexture('#20262c',27);materials.concrete.map=makeSurfaceTexture('#646b70',43);
materials.ground.needsUpdate=materials.asphalt.needsUpdate=materials.concrete.needsUpdate=true;

let colliders=[]; let mapObjects=[]; let remotePlayers=new Map(); let projectiles=[]; let selectedMode='ffa'; let selectedMap='district';
const platforms=[]; const trainingTargets=[]; const trainingTargetMeshes=[]; let trainingHits=0; let lastMoveSend=0;
let running=false, training=false, paused=false, matchEnd=0, remaining=480, kills=0, health=100, ammo=24, reserve=96, reloading=false;
const ALL_WEAPONS=[
 {id:'pulse',name:'PULSE CARBINE',className:'ASSAULT · BALANCED',mag:24,stock:96,rate:220,speed:36,color:0xffc16e,automatic:true},
 {id:'volt',name:'VOLT PISTOL',className:'SIDEARM · RAPID',mag:18,stock:108,rate:105,speed:42,color:0x7de4ff,automatic:true},
 {id:'magnum',name:'NOVA HANDCANNON',className:'SIDEARM · HEAVY',mag:12,stock:72,rate:260,speed:48,color:0xffbd72,automatic:false},
 {id:'arc',name:'HEAVY ARC RIFLE',className:'MARKSMAN · POWER',mag:10,stock:50,rate:420,speed:52,color:0xff8a65,automatic:false},
 {id:'needler',name:'SHARD NEEDLER',className:'ALIEN CRYSTAL · EXPLOSIVE',mag:30,stock:120,rate:125,speed:31,color:0xff4fd8,automatic:true,explosive:true,radius:3.1},
 {id:'rocket',name:'RPG-7X LAUNCHER',className:'HEAVY · BLAST',mag:4,stock:20,rate:900,speed:23,color:0xffa45b,automatic:false,explosive:true,radius:5.2},
 {id:'shotgun',name:'BREACH SHOTGUN',className:'CLOSE RANGE · IMPACT',mag:8,stock:48,rate:680,speed:32,color:0xffc27a,automatic:false},
 {id:'burst',name:'VECTOR BURST RIFLE',className:'TACTICAL · 3-ROUND',mag:27,stock:108,rate:390,speed:45,color:0x71e5d3,automatic:false,burst:true},
 {id:'sniper',name:'ECLIPSE LONGSHOT',className:'PRECISION · ONE-SHOT',mag:5,stock:25,rate:1250,speed:90,color:0x9ad7ff,automatic:false,sniper:true}
];
const PRIMARY_WEAPONS=ALL_WEAPONS.filter(w=>!['volt','magnum'].includes(w.id));
const SECONDARY_WEAPONS=ALL_WEAPONS.filter(w=>['volt','magnum'].includes(w.id));
let weapons=[ALL_WEAPONS[0],ALL_WEAPONS[1]];
let selectedPrimary='pulse',selectedSecondary='volt',selectedEquipment='shield';
const OPERATOR_PRESETS={vanguard:{armor:0x536b4c,light:0x82936b,visor:0xe7ad43,visorGlow:0x5a2b08,shoulder:1,style:'balanced'},recon:{armor:0x3d4a52,light:0x82949b,visor:0x65d9ee,visorGlow:0x145a68,shoulder:.82,style:'light'},assault:{armor:0x76664d,light:0xb29a70,visor:0xffbd65,visorGlow:0x704019,shoulder:1.22,style:'heavy'},phantom:{armor:0x343946,light:0x687080,visor:0xb99aff,visorGlow:0x49317a,shoulder:.94,style:'stealth'}};
let selectedOperator='vanguard';
let weaponIndex=0; let weaponAmmo=weapons.map(w=>({ammo:w.mag,reserve:w.stock})); let viewWeapon=null, weaponRecoil=0, moveBob=0, verticalVelocity=0, reloadTimer=null, autoReloadTimer=null, mouseHeld=false, isAiming=false;
let weaponAnimation={kind:'idle',start:0,duration:0}; let slideUntil=0,slideDirection=new THREE.Vector3(),mantleState=null,sprintBlend=0,lastGroundedAt=0,slideTriggered=false; let equipmentReadyAt=0,dustField=null; const impactParticles=[]; let audioContext=null,ambientNodes=null;
let socket=null, myId=null, players=[], teamId=null, matchStarted=false, lastShot=0, toastTimer=null, serverSpawn=null;
let activeRoomCode='',spectating=false,spectateTarget=null,supportReady=false;
let operatorAbilityReadyAt=0,operatorAbilityPending=false,operatorBoostUntil=0,reconContacts=[];
let devModeEnabled=false,devReturnToGame=false;
const player={pos:new THREE.Vector3(0,1.7,7),vel:new THREE.Vector3(),yaw:0,pitch:0,onGround:true,speed:5.2,moving:false,crouching:false};
const ramps=[];
const keys={}; let pointerLocked=false; const isTouchDevice=('ontouchstart' in window)||navigator.maxTouchPoints>0||matchMedia('(pointer: coarse)').matches; let mobileLookPointer=null,mobileLookX=0,mobileLookY=0,mobileAim=false; const raycaster=new THREE.Raycaster();
const isLocalHost=['localhost','127.0.0.1'].includes(location.hostname);
const autoServerUrl=()=>((isLocalHost||location.port==='5173')?`ws://${location.hostname}:3001`:`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);
$('server-url').value=autoServerUrl();

function box(x,y,z,sx,sy,sz,mat,solid=true){const radius=Math.max(.004,Math.min(.28,Math.min(sx,sy,sz)*.24));const m=new THREE.Mesh(new RoundedBoxGeometry(sx,sy,sz,3,radius),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);mapObjects.push(m);if(solid)colliders.push(new THREE.Box3().setFromObject(m));return m;}
function clearMap(){for(const o of mapObjects)scene.remove(o);mapObjects=[];colliders=[];ramps.length=0;platforms.length=0;}
function detailBox(x,y,z,sx,sy,sz,mat){return box(x,y,z,sx,sy,sz,mat,false);}
function makeRamp(x,z,width=5,length=8,rise=2.2,rotation=0){
 const verts=[-width/2,0,length/2, width/2,0,length/2, -width/2,rise,-length/2, width/2,rise,-length/2];
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex([0,1,2,1,3,2]);geo.computeVertexNormals();
 const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x59636b,roughness:.88,metalness:.12,side:THREE.DoubleSide}));mesh.position.set(x,.04,z);mesh.rotation.y=rotation;mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);mapObjects.push(mesh);
 // Raised side lips make the ramp read clearly without blocking its walkable surface.
 for(const side of [-1,1]){const rail=detailBox(x+Math.cos(rotation)*side*(width/2),rise/2,z-Math.sin(rotation)*side*(width/2),.16,rise,length,new THREE.MeshStandardMaterial({color:0x343d44,roughness:.85}));rail.rotation.y=rotation;}
 ramps.push({x,z,width,length,rise,rotation});
}
function rampFloorHeight(x,z){let height=0;for(const r of ramps){const dx=x-r.x,dz=z-r.z;const lx=dx*Math.cos(r.rotation)-dz*Math.sin(r.rotation);const lz=dx*Math.sin(r.rotation)+dz*Math.cos(r.rotation);if(Math.abs(lx)<=r.width/2&&Math.abs(lz)<=r.length/2){const h=r.rise*((r.length/2-lz)/r.length);height=Math.max(height,h);}}for(const p of platforms){const dx=x-p.x,dz=z-p.z;const lx=dx*Math.cos(p.rotation)-dz*Math.sin(p.rotation);const lz=dx*Math.sin(p.rotation)+dz*Math.cos(p.rotation);if(Math.abs(lx)<=p.width/2&&Math.abs(lz)<=p.depth/2)height=Math.max(height,p.height);}return height;}
function addCoverCluster(x,z){
 box(x,.55,z,2.1,1.1,1.15,materials.crate);box(x+2.1,.42,z-.6,1.3,.84,1.0,materials.dark);detailBox(x,.98,z,1.9,.08,1.05,materials.trim);
}

function makeBuilding(x,z,w,d,h,seed=0){
 // Walk-in building shell: floor, roof and four walls with a real ground-level entrance.
 const t=.38, doorW=Math.min(2.6,w*.28), doorH=2.55, front=z+d/2;
 box(x,.02,z,w,.2,d,materials.concrete);
 box(x,h+.08,z,w+.2,.2,d+.2,materials.dark);
 box(x,h/2,z-d/2,w,h,t,materials.concrete);
 box(x-w/2,h/2,z,t,h,d,materials.concrete);
 box(x+w/2,h/2,z,t,h,d,materials.concrete);
 const sideW=(w-doorW)/2;
 box(x-(doorW/2+sideW/2),h/2,front,sideW,h,t,materials.concrete);
 box(x+(doorW/2+sideW/2),h/2,front,sideW,h,t,materials.concrete);
 box(x,doorH+(h-doorH)/2,front,doorW,h-doorH,t,materials.concrete);
 // Door frame and a small amount of interior structure make the rooms legible.
 box(x-doorW/2,.0,front,.12,doorH,.16,materials.trim,false);
 box(x+doorW/2,.0,front,.12,doorH,.16,materials.trim,false);
 box(x,doorH,front,.14,doorW,.16,materials.trim,false);
 const floors=Math.max(2,Math.floor(h/3.1));
 for(let f=0;f<floors;f++){
  const y=1.35+f*3.05;
  for(let col=0;col<Math.max(2,Math.floor(w/3));col++){
   const wx=x-w/2+1.5+col*2.8;
   if(wx<x-doorW/2-.5||wx>x+doorW/2+.5){
    box(wx,y,front+.22,1.0,1.05,.06,materials.glass,false);
   }
  }
  for(const side of [-1,1]){
   for(let col=0;col<Math.max(2,Math.floor(d/3));col++){
    const wz=z-d/2+1.5+col*2.8;
    box(x+side*(w/2+.025),y,wz,.06,1.05,1.0,materials.glass,false);
    if((col+f+seed)%3===0){
     detailBox(x+side*(w/2+.065),y-.48,wz,.12,.08,1.12,materials.trim);
    }
   }
  }
  // Recessed window glow and facade bands break up the plain blockout walls.
  for(let col=0;col<Math.max(1,Math.floor((w-doorW)/4));col++){
   const wx=x-w/2+2.1+col*4.0;
   if(wx<x-doorW/2-1||wx>x+doorW/2+1){
    const glowMat=new THREE.MeshStandardMaterial({color:0x9a7049,emissive:0x6c3d19,emissiveIntensity:.55,roughness:.5});
    detailBox(wx,y,front+.205,1.25,.72,.035,glowMat);
   }
  }
  detailBox(x,h/2,z-d/2-.22,w,.12,.08,materials.trim);
 }
 // Exterior service details: AC units, drainpipes and small ledges.
 for(const side of [-1,1]){
  detailBox(x+side*(w/2+.25),Math.min(h-1.2,3.2),z-d*.22,.48,.55,.62,materials.dark);
  detailBox(x+side*(w/2+.24),Math.min(h-1.2,3.2),z-d*.22,.52,.08,.66,materials.trim);
 }
 detailBox(x+w*.28,.22,z+d/2+.22,.12,.44,.12,materials.dark);
 // Ground-floor interior cover; all pieces have collision.
 if(w>10&&d>10){
  box(x-w*.22,.55,z-d*.12,1.0,1.1,1.0,materials.dark);
  box(x+w*.22,.55,z-d*.12,1.0,1.1,1.0,materials.crate);
 }
}
function makeStreetLamp(x,z){box(x,2.2,z,.12,4.4,.12,materials.dark);box(x+.7,4.3,z,.95,.08,.08,materials.dark);const glow=new THREE.PointLight(0xd59b62,.6,8);glow.position.set(x+.9,4.1,z);scene.add(glow);mapObjects.push(glow);}
function makeCrate(x,z,s=1){box(x,.55*s,z,1.2*s,1.1*s,1.2*s,materials.crate);}
function makeTree(x,z,scale=1){
 const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.16*scale,.23*scale,2.2*scale,7),materials.trim);
 trunk.position.set(x,1.1*scale,z);trunk.castShadow=true;scene.add(trunk);mapObjects.push(trunk);
 const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.05*scale,1),new THREE.MeshStandardMaterial({color:0x263b35,roughness:1}));
 crown.position.set(x,2.55*scale,z);crown.castShadow=true;crown.receiveShadow=true;scene.add(crown);mapObjects.push(crown);
 colliders.push(new THREE.Box3(new THREE.Vector3(x-.22*scale,0,z-.22*scale),new THREE.Vector3(x+.22*scale,2.3*scale,z+.22*scale)));
}
function makeStreetFurniture(x,z){
 box(x,.38,z,.95,.76,.48,materials.dark);
 detailBox(x,.79,z,.9,.06,.45,materials.trim);
 detailBox(x,.9,z-.04,.68,.08,.03,materials.amber);
}
function makeStorefront(x,z,w=7,accent=0xc58a4d,rotation=0){
 const wall=new THREE.MeshStandardMaterial({color:0x3b454c,roughness:.88});
 const sign=new THREE.MeshStandardMaterial({color:accent,emissive:accent,emissiveIntensity:.22,roughness:.55});
 const add=(geo,mat,px,py,pz)=>{const m=new THREE.Mesh(geo,mat);m.position.set(px,py,pz);m.rotation.y=rotation;m.castShadow=true;m.receiveShadow=true;scene.add(m);mapObjects.push(m);return m;};
 add(new THREE.BoxGeometry(w,.22,2.8),materials.dark,x,1.35,z);
 add(new THREE.BoxGeometry(w,.12,3.1),materials.trim,x,2.85,z);
 add(new THREE.BoxGeometry(w,.18,.22),wall,x,3.02,z+1.35);
 add(new THREE.BoxGeometry(w*.68,.62,.08),sign,x,2.42,z+1.49);
 add(new THREE.BoxGeometry(w*.72,.12,1.2),sign,x,1.82,z+1.85);
 for(let i=-1;i<=1;i++)add(new THREE.BoxGeometry(.08,.95,.08),materials.dark,x+i*w*.22,1.18,z+1.42);
 for(const side of [-1,1]){const post=box(x+side*(w/2-.2),1.3,z,.16,2.6,.18,wall);post.rotation.y=rotation;}
 box(x,.12,z+2.25,w*.8,.24,.5,materials.dark);
}
function makeMarketCanopy(x,z,rotation=0,tint=0x8b654a){
 const cloth=new THREE.MeshStandardMaterial({color:tint,roughness:.9,side:THREE.DoubleSide});
 for(const sx of [-1,1])for(const sz of [-1,1]){const p=detailBox(x+sx*1.65,1.25,z+sz*1.25,.09,2.5,.09,materials.dark);p.rotation.y=rotation;}
 const canopy=detailBox(x,2.55,z,3.7,.16,3.0,cloth);canopy.rotation.y=rotation;
 const counter=box(x,.58,z,3.1,1.16,.72,materials.crate);counter.rotation.y=rotation;
 for(let i=0;i<5;i++){const bin=detailBox(x-1.25+i*.62,.95,z-.12,.42,.38,.48,i%2?materials.amber:materials.trim);bin.rotation.y=rotation;}
 const valance=detailBox(x,2.25,z+1.48,3.45,.42,.1,cloth);valance.rotation.y=rotation;
}
function makeRooftopMachinery(x,z,scale=1){
 box(x,.7*scale,z,1.8*scale,1.4*scale,1.25*scale,materials.dark);
 detailBox(x,.77*scale,z,1.55*scale,.12*scale,1.05*scale,materials.trim);
 for(let i=-1;i<=1;i++)detailBox(x+i*.42*scale,1.25*scale,z+.64*scale,.08*scale,.75*scale,.08*scale,materials.amber);
}
function makeRoadsideBarrier(x,z,length=5,rotation=0){
 const b=box(x,.48,z,length,.96,.42,materials.concrete);b.rotation.y=rotation;
 const stripe=detailBox(x,.98,z,length-.15,.07,.43,materials.amber);stripe.rotation.y=rotation;
 for(const side of [-1,1]){const end=detailBox(x+Math.cos(rotation)*side*length*.48,.55,z-Math.sin(rotation)*side*length*.48,.2,1.1,.58,materials.dark);end.rotation.y=rotation;}
}
function makeCableSpool(x,z,scale=1){
 const drum=new THREE.Mesh(new THREE.CylinderGeometry(.72*scale,.72*scale,.85*scale,14),new THREE.MeshStandardMaterial({color:0x65523e,roughness:.92}));
 drum.rotation.z=Math.PI/2;drum.position.set(x,.72*scale,z);drum.castShadow=true;scene.add(drum);mapObjects.push(drum);
 for(const side of [-1,1]){const disc=new THREE.Mesh(new THREE.CylinderGeometry(.92*scale,.92*scale,.12*scale,14),materials.trim);disc.rotation.z=Math.PI/2;disc.position.set(x+side*.48*scale,.72*scale,z);disc.castShadow=true;scene.add(disc);mapObjects.push(disc);}
 colliders.push(new THREE.Box3(new THREE.Vector3(x-1.05*scale,0,z-.95*scale),new THREE.Vector3(x+1.05*scale,1.5*scale,z+.95*scale)));
}
function makeIndustrialStair(x,z,width=3,steps=8,rise=2.4,rotation=0){
 for(let i=0;i<steps;i++){const h=rise*(i+1)/steps,depth=width/steps,offset=(i-(steps-1)/2)*depth;const px=x+Math.sin(rotation)*offset,pz=z+Math.cos(rotation)*offset;const step=detailBox(px,h/2,pz,width,h/steps,depth+.04,materials.concrete);step.rotation.y=rotation;}
 makeRamp(x,z,width,width,rise,rotation);
}
function makeIndustrialLight(x,y,z){
 detailBox(x,y,z,.28,.12,.28,materials.dark);
 const glow=new THREE.PointLight(0xe5b77e,1.3,15,2);glow.position.set(x,y-.18,z);scene.add(glow);mapObjects.push(glow);
}
function addRoadMarkings(){
 // Broken centre lines, pedestrian crossing bars and drainage covers.
 for(let z=-42;z<=42;z+=8)detailBox(0,.018,z,.18,.018,3.6,materials.trim);
 for(let x=-42;x<=42;x+=8)detailBox(x,.018,0,3.6,.018,.18,materials.trim);
 for(let i=0;i<7;i++){detailBox(-8+i*2.6,.025,7,1.25,.025,.24,materials.concrete);detailBox(-8+i*2.6,.025,-7,1.25,.025,.24,materials.concrete);}
 for(const [x,z] of [[-12,-12],[12,-12],[-12,12],[12,12]]){
  detailBox(x,.012,z,1.2,.025,.8,materials.dark);
  for(let k=0;k<5;k++)detailBox(x-.45+k*.22,.03,z,.035,.012,.72,materials.trim);
 }
}
function addVisualMesh(geometry,material,x,y,z,solid=false){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);mapObjects.push(m);if(solid){m.updateMatrixWorld(true);colliders.push(new THREE.Box3().setFromObject(m));}return m;}
function mapLight(x,y,z,color=0x62d9eb,intensity=1,range=16){const l=new THREE.PointLight(color,intensity,range,2);l.position.set(x,y,z);scene.add(l);mapObjects.push(l);addVisualMesh(new THREE.SphereGeometry(.14,12,8),new THREE.MeshBasicMaterial({color}),x,y,z);}
function makeArcTower(x,z,r,h,color=0x354e5a,glow=0x58d5e6){const metal=new THREE.MeshStandardMaterial({color,metalness:.62,roughness:.34});addVisualMesh(new THREE.CylinderGeometry(r*.82,r,h,24),metal,x,h/2,z,true);addVisualMesh(new THREE.CylinderGeometry(r*1.22,r*1.3,.65,24),materials.dark,x,.32,z,true);const lit=new THREE.MeshStandardMaterial({color:glow,emissive:glow,emissiveIntensity:.75,metalness:.4,roughness:.25});for(const y of [h*.25,h*.55,h*.83]){const ring=addVisualMesh(new THREE.TorusGeometry(r*1.04,.13,8,48),lit,x,y,z);ring.rotation.x=Math.PI/2;}for(let i=0;i<8;i++){const a=i*Math.PI/4,m=addVisualMesh(new THREE.BoxGeometry(.22,h*.78,.28),materials.trim,x+Math.cos(a)*(r+.08),h*.52,z+Math.sin(a)*(r+.08),true);m.rotation.y=-a;}mapLight(x,h*.7,z,glow,.85,Math.max(12,h));}
function makeHabitat(x,z,w,d,h,color=0x4b626d,glow=0x55d4e4){const shell=new THREE.MeshStandardMaterial({color,metalness:.5,roughness:.52});box(x,h/2,z,w,h,d,shell,true);for(const side of [-1,1])detailBox(x+side*(w/2+.03),h*.55,z,.08,.2,d*.78,new THREE.MeshBasicMaterial({color:glow}));for(let k=-1;k<=1;k++)detailBox(x+k*w*.25,h*.58,z-d/2-.05,w*.15,.8,.08,new THREE.MeshStandardMaterial({color:0x8ed7e2,emissive:glow,emissiveIntensity:.25,metalness:.4,roughness:.2}));detailBox(x,.95,z+d/2+.06,w*.22,1.9,.1,materials.dark);}
function makeShield(x,z,rotation=0,color=0x526d78){const m=addVisualMesh(new THREE.CapsuleGeometry(.82,1.35,6,14),new THREE.MeshStandardMaterial({color,metalness:.52,roughness:.42}),x,1.05,z,false);m.scale.set(1.3,1.1,.55);m.rotation.z=Math.PI/2;m.rotation.y=rotation;m.updateMatrixWorld(true);colliders.push(new THREE.Box3().setFromObject(m));const stripe=detailBox(x,1.2,z-.32,1.5,.12,.07,new THREE.MeshBasicMaterial({color:0x61ddeb}));stripe.rotation.y=rotation;}
function buildDistrict(){
 clearMap();scene.background.set(0x172b3b);scene.fog.color.set(0x203849);scene.fog.density=.008;
 hemi.color.set(0xa8d5e2);hemi.groundColor.set(0x17232d);hemi.intensity=1.48;moonLight.color.set(0xffd7a4);moonLight.intensity=2.35;moonLight.position.set(-32,58,-26);fill.color.set(0x55b8d1);fill.intensity=.7;
 const pavement=new THREE.MeshStandardMaterial({color:0x3b4b54,roughness:.84,metalness:.16}),road=new THREE.MeshStandardMaterial({color:0x17242d,roughness:.72,metalness:.24});
 box(0,-.28,0,104,.48,104,pavement,false);box(0,-.015,0,17,.08,100,road,false);box(0,-.012,0,100,.08,17,road,false);
 for(const s of [-1,1]){detailBox(s*9.3,.05,0,.75,.12,100,materials.trim);detailBox(0,.05,s*9.3,100,.12,.75,materials.trim);for(let p=-44;p<=44;p+=8){detailBox(s*5.6,.035,p,.12,.025,2.8,new THREE.MeshBasicMaterial({color:0x54c9d9}));detailBox(p,.035,s*5.6,2.8,.025,.12,new THREE.MeshBasicMaterial({color:0x54c9d9}));}}
 addVisualMesh(new THREE.CylinderGeometry(14.5,15.5,.34,64),new THREE.MeshStandardMaterial({color:0x243742,metalness:.5,roughness:.45}),0,.12,0);
 const ring=addVisualMesh(new THREE.TorusGeometry(12.7,.22,10,96),new THREE.MeshStandardMaterial({color:0x55d5e7,emissive:0x16899e,emissiveIntensity:.9}),0,.35,0);ring.rotation.x=Math.PI/2;
 addVisualMesh(new THREE.CylinderGeometry(7.2,7.8,.18,48),new THREE.MeshStandardMaterial({color:0x657982,metalness:.58,roughness:.3}),0,.34,0);
 for(const [x,z,r] of [[-18,-18,0],[18,-18,Math.PI/2],[-18,18,-Math.PI/2],[18,18,Math.PI]])makeShield(x,z,r);
 const towers=[[-37,-34,4.8,19],[-22,-39,3.5,13],[37,-34,5.2,22],[23,-39,3.6,15],[-37,34,5.1,21],[-22,39,3.7,14],[37,34,4.8,19],[23,39,3.5,13]];
 towers.forEach((t,i)=>makeArcTower(...t,i%2?0x405b67:0x344b58,i%2?0x65c9df:0x53e0d0));
 const habitats=[[-29,-17,11,8,5],[-7,-33,10,8,5],[29,-17,11,8,5],[7,-33,10,8,5],[-29,17,11,8,5],[7,33,10,8,5],[29,17,11,8,5],[-7,33,10,8,5]];
 habitats.forEach((h,i)=>makeHabitat(...h,i%2?0x526773:0x465c67,i%2?0x58d6e4:0x8be0d5));
 for(const z of [-27,27]){const tube=addVisualMesh(new THREE.CylinderGeometry(.42,.42,52,16),new THREE.MeshStandardMaterial({color:0x6c8a94,metalness:.65,roughness:.28}),0,7,z);tube.rotation.z=Math.PI/2;for(let x=-24;x<=24;x+=12){box(x,3.5,z,.3,7,.3,materials.dark);detailBox(x,7.1,z,.9,.14,.9,new THREE.MeshBasicMaterial({color:0x56cfe0}));}}
 for(const [x,z] of [[-42,0],[42,0],[0,-42],[0,42]]){addVisualMesh(new THREE.CylinderGeometry(5.5,5.5,.24,40),new THREE.MeshStandardMaterial({color:0x293b45,metalness:.55,roughness:.4}),x,.08,z);const pr=addVisualMesh(new THREE.TorusGeometry(4.7,.12,8,48),new THREE.MeshBasicMaterial({color:0x6ad9e5}),x,.23,z);pr.rotation.x=Math.PI/2;mapLight(x,3,z,0x69dce8,1.2,20);}
 for(const [x,z] of [[-25,-8],[25,8],[-8,25],[8,-25],[-40,12],[40,-12]])makeShield(x,z,(x+z)*.02,0x4e6570);
 for(let i=0;i<20;i++){const x=-43+(i*19)%86,z=-41+((i*31)%82);addVisualMesh(new THREE.CylinderGeometry(.75,.95,.8,12),new THREE.MeshStandardMaterial({color:0x354a50,roughness:.9}),x,.4,z,true);const shrub=addVisualMesh(new THREE.IcosahedronGeometry(.85,2),new THREE.MeshStandardMaterial({color:0x355e59,roughness:1}),x,1.25,z);shrub.scale.y=.8;}
 for(const [x,z] of [[-14,-35],[14,-35],[-14,35],[14,35],[-42,-15],[42,15],[-42,15],[42,-15]]){addVisualMesh(new THREE.CylinderGeometry(.11,.18,7,10),materials.dark,x,3.5,z,true);detailBox(x+.9,6.65,z,1.8,.12,.16,materials.trim);mapLight(x+.9,6.35,z,0x7be3f1,.7,13);}
 for(const [x,z] of [[-32,-8],[32,8],[-8,32],[8,-32]]){addVisualMesh(new THREE.CylinderGeometry(.8,.8,4,20,1,true),new THREE.MeshBasicMaterial({color:0x4dd7e8,transparent:true,opacity:.18,side:THREE.DoubleSide}),x,2,z);mapLight(x,2,z,0x4dd7e8,.8,9);}
 makeRamp(-24,0,4.5,8,1.8,Math.PI/2);makeRamp(24,0,4.5,8,1.8,-Math.PI/2);
 player.pos.set(0,1.7,7);player.yaw=Math.PI;updateCamera();
}
function makeWarehouse(x,z,w=28,d=22,h=10,face=1,label='FREIGHT'){
 // A proper loading-bay warehouse: open vehicle doors, structural ribs, clerestory glass and an interior service lane.
 const t=.48,front=z+face*d/2,doorW=9,doorH=5.4;
 box(x,.02,z,w,.18,d,materials.concrete);
 box(x,h+.08,z,w+.35,.22,d+.35,materials.dark);
 box(x,h/2,z-face*d/2,w,h,t,materials.concrete);
 box(x-w/2,h/2,z,t,h,d,materials.concrete);box(x+w/2,h/2,z,t,h,d,materials.concrete);
 const side=(w-doorW)/2;
 box(x-(doorW/2+side/2),h/2,front,side,h,t,materials.concrete);
 box(x+(doorW/2+side/2),h/2,front,side,h,t,materials.concrete);
 box(x,doorH+(h-doorH)/2,front,doorW,h-doorH,t,materials.concrete);
 // Loading-bay shutter ribs and amber warning posts.
 for(let k=0;k<17;k++)detailBox(x-doorW/2+.28+k*.53,doorH/2,front+face*.27,.035,doorH-.2,.055,materials.trim);
 for(const sideSign of [-1,1]){
  box(x+sideSign*(doorW/2+.45),1.05,front+face*.38,.42,2.1,.5,materials.amber);
  for(let k=0;k<5;k++)detailBox(x+sideSign*(doorW/2+.45),.22+k*.38,front+face*.65,.44,.11,.06,materials.dark);
 }
 // Interior steel portal frames, work lights and storage racks.
 for(let zz=-d/2+2.5;zz<d/2-1;zz+=5){
  for(const sx of [-1,1])box(x+sx*(w/2-1.0),h/2,z+zz,.24,h-.4,.24,materials.dark);
  detailBox(x,h-.65,z+zz,w-.8,.22,.24,materials.trim);
 }
 for(let sx=-1;sx<=1;sx++){
  const rackX=x+sx*8;
  box(rackX,1.5,z,.28,3,.28,materials.dark);box(rackX+2.3,1.5,z,.28,3,.28,materials.dark);
  for(let level=0;level<3;level++){
   box(rackX+1.15,.55+level*1.05,z,2.6,.13,2.4,materials.trim,false);
   for(let crate=0;crate<2;crate++)detailBox(rackX+.5+crate*1.2,.95+level*1.02,z,.88,.72,1.55,materials.crate);
  }
 }
 for(let lx=-1;lx<=1;lx++)makeIndustrialLight(x+lx*7, h-.45,z);
 // Exterior corrugated cladding, vents, downpipes and a large facility sign.
 for(let xx=-w/2+1;xx<w/2;xx+=1.15){detailBox(x+xx,h*.55,front+face*.27,.035,h*.72,.06,materials.dark);}
 for(let sideSign of [-1,1]){
  for(let zz=-d/2+2;zz<d/2;zz+=2.2){detailBox(x+sideSign*(w/2+.28),h*.52,z+zz,.12,h*.78,.1,materials.dark);}
  detailBox(x+sideSign*(w/2+.4),h-1.4,z-d*.25,.55,.8,.65,materials.dark);
  detailBox(x+sideSign*(w/2+.42),h-1.0,z-d*.25,.62,.08,.72,materials.trim);
 }
 detailBox(x,h+1.1,front+face*.34,7,1.05,.16,materials.dark);
 detailBox(x,h+1.1,front+face*.45,6.2,.68,.08,materials.amber);
 // Loading dock apron and striped edge.
 box(x,.28,front+face*2.3,w*.72,.42,3.8,materials.dark,false);
 for(let k=0;k<13;k++)detailBox(x-w*.34+k*w*.68/12,.51,front+face*4.05,.22,.035,.42,k%2?materials.dark:materials.amber);
}
function makeContainer(x,z,length=8,height=2.7,rotation=0,color=0x46545a){
 const mat=new THREE.MeshStandardMaterial({color,metalness:.38,roughness:.72});
 const body=box(x,height/2,z,length,height,2.55,mat,true);body.rotation.y=rotation;
 for(let k=0;k<Math.floor(length/.42);k++){
  const lx=-length/2+.22+k*.42,rx=x+Math.cos(rotation)*lx,rz=z-Math.sin(rotation)*lx;
  const rib=detailBox(rx,height/2,rz,.075,height+.04,2.62,materials.dark);rib.rotation.y=rotation;
 }
 for(const side of [-1,1]){
  const lx=side*(length/2-.12),rx=x+Math.cos(rotation)*lx,rz=z-Math.sin(rotation)*lx;
  const corner=detailBox(rx,height/2,rz,.18,height+.12,2.7,materials.trim);corner.rotation.y=rotation;
 }
 detailBox(x,height+.04,z,length-.2,.08,2.6,materials.dark);
}
function makeWalkway(x,z,width,depth,height,rotation=0){
 const deck=detailBox(x,height,z,width,.2,depth,new THREE.MeshStandardMaterial({color:0x4b555b,metalness:.58,roughness:.65}));deck.rotation.y=rotation;
 platforms.push({x,z,width,depth,height,rotation});
 for(const side of [-1,1]){
  const lx=side*(width/2-.12),px=x+Math.cos(rotation)*lx,pz=z-Math.sin(rotation)*lx;
  const rail=detailBox(px,height+.52,pz,.12,1.0,depth,materials.trim);rail.rotation.y=rotation;
  for(let k=0;k<=Math.floor(depth/2);k++){
   const lz=-depth/2+k*2,rx=x+Math.sin(rotation)*lz+Math.cos(rotation)*lx,rz=z+Math.cos(rotation)*lz-Math.sin(rotation)*lx;
   detailBox(rx,height+.48,rz,.13,.95,.13,materials.dark);
  }
  for(let k=-1;k<=1;k++){
   const lx2=k*width*.32,px2=x+Math.cos(rotation)*lx2,pz2=z-Math.sin(rotation)*lx2;
   detailBox(px2,height/2,pz2,.14,height,.14,materials.dark);
  }
 }
 const stripe=detailBox(x,height+.115,z,width-.25,.025,.08,materials.amber);stripe.rotation.y=rotation;
}
function buildIndustrial(){
 clearMap();scene.background.set(0x101d2b);scene.fog.color.set(0x172b3b);scene.fog.density=.0075;
 hemi.color.set(0x8eb7cc);hemi.groundColor.set(0x101820);hemi.intensity=1.22;moonLight.color.set(0xffc88d);moonLight.intensity=2.6;moonLight.position.set(-38,62,-18);fill.color.set(0x3c91b7);fill.intensity=.62;
 const deck=new THREE.MeshStandardMaterial({color:0x293943,roughness:.84,metalness:.24}),steel=new THREE.MeshStandardMaterial({color:0x182832,metalness:.72,roughness:.36}),hazard=new THREE.MeshStandardMaterial({color:0xd59a43,metalness:.25,roughness:.65});
 box(0,-.25,0,104,.5,104,deck,false);box(0,-.015,0,24,.09,100,steel,false);box(0,-.012,0,100,.09,20,steel,false);
 for(const s of [-1,1]){box(s*49,2.4,0,.8,4.8,100,materials.dark);box(0,2.4,s*49,100,4.8,.8,materials.dark);}
 const hangars=[[-34,-31,22,25,13],[34,-31,22,25,14],[-34,31,22,25,12],[34,31,22,25,13]];
 for(let i=0;i<hangars.length;i++){
  const [x,z,w,d,h]=hangars[i],face=z<0?1:-1;
  makeWarehouse(x,z,w,d,h,face,`HANGAR ${i+1}`);
  const roof=addVisualMesh(new THREE.CylinderGeometry(w*.56,w*.56,d,32,1,true,0,Math.PI),new THREE.MeshStandardMaterial({color:0x1c303b,metalness:.7,roughness:.32,side:THREE.DoubleSide}),x,h*.82,z);
  roof.rotation.z=Math.PI/2;roof.scale.set(1,1,.78);
  for(const side of [-1,1]){box(x+side*(w/2+.35),h/2,z,.6,h+.6,d+.5,steel);detailBox(x+side*(w/2+.35),h*.72,z,.68,.2,d+.45,hazard);}
  mapLight(x,h*.7,z+face*(d/2+1),0x53cce0,1.4,24);
 }
 addVisualMesh(new THREE.CylinderGeometry(5.4,6.2,17,32),new THREE.MeshStandardMaterial({color:0x344d59,metalness:.72,roughness:.28}),0,8.5,-2,true);
 addVisualMesh(new THREE.CylinderGeometry(2.2,2.2,16,24),new THREE.MeshBasicMaterial({color:0x49d5eb,transparent:true,opacity:.52}),0,8.5,-2);
 for(const y of [2.2,6,10.5,14.5]){const r=addVisualMesh(new THREE.TorusGeometry(6.1,.25,10,64),new THREE.MeshStandardMaterial({color:0x74dce8,emissive:0x168da4,emissiveIntensity:.8,metalness:.55,roughness:.25}),0,y,-2);r.rotation.x=Math.PI/2;}
 for(let i=0;i<8;i++){const a=i*Math.PI/4,x=Math.cos(a)*7,z=-2+Math.sin(a)*7;box(x,7.5,z,.45,15,.45,steel);detailBox(x,8,z,.5,11,.5,new THREE.MeshBasicMaterial({color:0x5ad9e9}));}mapLight(0,9,-2,0x3cc9e6,2.4,30);
 for(const [z,y] of [[-22,18],[22,14]]){for(const x of [-42,42]){box(x,y/2,z,1.1,y,1.1,steel);detailBox(x,y,z,.4,.35,.4,hazard);}box(0,y,z,86,1.1,1.2,steel);detailBox(0,y+.58,z,84,.16,1.3,hazard);for(let x=-34;x<=34;x+=8){detailBox(x,y-1.3,z,.18,2.6,.18,materials.trim);const hook=addVisualMesh(new THREE.TorusGeometry(.45,.09,8,20),hazard,x,y-2.7,z);hook.rotation.x=Math.PI/2;}}
 const cargo=[[-18,-20,12,3,0,0x4d6470],[-18,-9,9,3,0,0x6a5a45],[-18,12,12,3,0,0x3c5d67],[18,-20,12,3,0,0x5b6658],[18,-8,9,3,0,0x4d626d],[18,13,12,3,0,0x655b4b],[-7,-32,9,3,Math.PI/2,0x3d5967],[7,32,9,3,Math.PI/2,0x5c625a]];
 for(const [x,z,w,h,rot,c] of cargo){const mat=new THREE.MeshStandardMaterial({color:c,metalness:.48,roughness:.58}),m=box(x,h/2,z,w,h,2.8,mat,true);m.rotation.y=rot;for(let k=-Math.floor(w/2)+1;k<Math.floor(w/2);k++){const rib=detailBox(x+k,h/2,z,.08,h+.05,2.9,materials.dark);rib.rotation.y=rot;}}
 makeWalkway(-12,-25,3.8,14,2.5,0);makeRamp(-12,-14,4,8,2.5,0);makeRamp(-12,-36,4,8,2.5,Math.PI);makeWalkway(12,25,3.8,14,2.5,0);makeRamp(12,14,4,8,2.5,Math.PI);makeRamp(12,36,4,8,2.5,0);
 for(const x of [-27,27])for(const z of [-12,0,12]){addVisualMesh(new THREE.CylinderGeometry(2,2.2,7,20),new THREE.MeshStandardMaterial({color:0x52646b,metalness:.58,roughness:.42}),x,3.5,z,true);for(const y of [1,3.5,6]){const b=addVisualMesh(new THREE.TorusGeometry(2.08,.12,8,32),hazard,x,y,z);b.rotation.x=Math.PI/2;}mapLight(x,5,z,0x5bd7e7,.65,12);}
 for(const x of [-5,5])for(const z of [-40,40]){box(x,4,z,.3,8,.3,steel);detailBox(x,8,z,.6,.18,.6,hazard);}
 for(const x of [-5,5]){const pipe=addVisualMesh(new THREE.CylinderGeometry(.22,.22,82,16),new THREE.MeshStandardMaterial({color:0x91a4a8,metalness:.8,roughness:.25}),x,6,0);pipe.rotation.x=Math.PI/2;}
 for(const [x,z] of [[-12,-13],[12,-13],[-12,14],[12,14],[-40,0],[40,0]]){box(x,.55,z,3.4,1.1,2.2,materials.dark);detailBox(x,.15,z,3.8,.18,2.6,hazard);for(let k=-1;k<=1;k++)box(x+k*.85,1.5,z,.65,.9,.7,materials.crate);}
 for(const [x,z] of [[-8,-12],[8,12],[-31,18],[31,-18],[-10,7],[10,-7]]){addVisualMesh(new THREE.CylinderGeometry(.72,.72,1.4,20),new THREE.MeshStandardMaterial({color:0x60757a,metalness:.62,roughness:.4}),x,.72,z,true);detailBox(x,1.46,z,1.2,.1,1.2,hazard);}
 for(const [x,z,r] of [[-23,0,0],[23,0,Math.PI],[0,-39,Math.PI/2],[0,39,-Math.PI/2]])makeShield(x,z,r,0x536b76);
 for(const [x,z] of [[-43,-43],[43,-43],[-43,43],[43,43],[0,-46],[0,46]]){addVisualMesh(new THREE.CylinderGeometry(.18,.28,12,12),steel,x,6,z,true);mapLight(x,11,z,0xf2b45e,1.2,20);}
 for(let i=0;i<28;i++){const x=-44+(i*23)%88,z=-42+((i*37)%84);detailBox(x,.025,z,.45,.035,.45,i%2?hazard:materials.trim);}
 player.pos.set(0,1.7,9);player.yaw=Math.PI;updateCamera();
}

function buildSublevel(){
 clearMap();scene.background.set(0x071522);scene.fog.color.set(0x0b1d2a);scene.fog.density=.021;
 hemi.color.set(0x8ac7d6);hemi.groundColor.set(0x07111a);hemi.intensity=1.75;
 moonLight.color.set(0x70c9df);moonLight.intensity=1.05;moonLight.position.set(-12,18,-16);fill.color.set(0x2e8da9);fill.intensity=.82;
 const floor=new THREE.MeshStandardMaterial({color:0x465761,roughness:.82,metalness:.18});
 const wall=new THREE.MeshStandardMaterial({color:0x354954,roughness:.78,metalness:.28});
 const wallLight=new THREE.MeshStandardMaterial({color:0x647d88,roughness:.68,metalness:.28});
 const cyan=new THREE.MeshStandardMaterial({color:0x54d9e8,emissive:0x168da0,emissiveIntensity:.9,metalness:.45,roughness:.28});
 const amber=new THREE.MeshStandardMaterial({color:0xe0a64f,emissive:0x81501c,emissiveIntensity:.48,metalness:.35,roughness:.48});
 box(0,-.28,0,50,.56,50,floor,false);
 // A hard perimeter keeps every fight inside this compact 48 x 48 metre arena.
 box(0,2.7,-24.7,50,5.4,.7,wall);box(0,2.7,24.7,50,5.4,.7,wall);
 box(-24.7,2.7,0,.7,5.4,50,wall);box(24.7,2.7,0,.7,5.4,50,wall);
 const wallX=(z,x1,x2,mat=wall)=>{if(x2>x1)box((x1+x2)/2,2.38,z,x2-x1,4.76,.46,mat);};
 const wallZ=(x,z1,z2,mat=wall)=>{if(z2>z1)box(x,2.38,(z1+z2)/2,.46,4.76,z2-z1,mat);};
 const gapCenters=[-16,0,16],gapHalf=2.35,edge=24.35;
 for(const x of [-9.5,9.5]){let cursor=-edge;for(const center of gapCenters){wallZ(x,cursor,center-gapHalf);cursor=center+gapHalf;}wallZ(x,cursor,edge);}
 for(const z of [-9.5,9.5]){let cursor=-edge;for(const center of gapCenters){wallX(z,cursor,center-gapHalf);cursor=center+gapHalf;}wallX(z,cursor,edge);}
 // Intermittent tunnel roofs create tight covered links between open pockets.
 for(const x of [-9.5,9.5])for(const z of gapCenters){
  box(x,4.75,z,4.95,.3,4.9,wallLight,false);
  for(const side of [-1,1])detailBox(x+side*2.28,4.25,z,.12,.22,4.5,cyan);
  detailBox(x,4.48,z,4.5,.12,.12,amber);
 }
 for(const z of [-9.5,9.5])for(const x of gapCenters){
  box(x,4.75,z,4.9,.3,4.95,wallLight,false);
  for(const side of [-1,1])detailBox(x,4.25,z+side*2.28,4.5,.22,.12,cyan);
  detailBox(x,4.48,z,.12,.12,4.5,amber);
 }
 // Continuous overhead ceiling encloses the entire arena while leaving all routes below clear.
 box(0,5.72,0,50.8,.48,50.8,wallLight,false);
 // Recessed ceiling panels and luminous service strips give the roof a finished station interior.
 for(const z of [-19,-12,-5,5,12,19]){
  detailBox(0,5.465,z,43,.055,1.05,wall,false);
  detailBox(0,5.425,z,36,.035,.12,cyan);
 }
 for(const x of [-20,-10,0,10,20]){
  detailBox(x,5.465,0,.72,.055,39,wall,false);
  detailBox(x,5.425,0,.09,.035,32,amber);
 }
 for(const [x,z] of [[-16,-16],[16,-16],[-16,16],[16,16],[0,0]]){
  detailBox(x,5.425,z,2.2,.045,2.2,wallLight,false);
  detailBox(x,5.395,z,1.35,.025,1.35,cyan);
 }
 // Ceiling fixtures provide actual illumination across the covered arena, not just glowing decoration.
 const ceilingWhite=new THREE.MeshStandardMaterial({color:0xd9f5ff,emissive:0x8bdcf2,emissiveIntensity:1.35,roughness:.3});
 const ceilingWarm=new THREE.MeshStandardMaterial({color:0xffd39a,emissive:0xffa94d,emissiveIntensity:1.1,roughness:.35});
 for(const [i,x] of [-16,0,16].entries())for(const z of [-16,0,16]){
  const warm=(i===1&&z===0)||((i===0||i===2)&&Math.abs(z)===16);
  detailBox(x,5.335,z,1.75,.16,1.75,wall,false);
  detailBox(x,5.235,z,1.22,.045,1.22,warm?ceilingWarm:ceilingWhite);
  const lamp=new THREE.PointLight(warm?0xffbd78:0x9beaff,warm?2.4:2.8,25,2);
  lamp.position.set(x,5.02,z);scene.add(lamp);mapObjects.push(lamp);
 }
 // Small route lights brighten the connecting tunnel mouths and corners.
 for(const [x,z] of [[-9.5,-16],[-9.5,0],[-9.5,16],[9.5,-16],[9.5,0],[9.5,16],[-16,-9.5],[0,-9.5],[16,-9.5],[-16,9.5],[0,9.5],[16,9.5]]){
  const lamp=new THREE.PointLight(0x54cde4,1.1,13,2);lamp.position.set(x,4.35,z);scene.add(lamp);mapObjects.push(lamp);
  detailBox(x,4.53,z,.72,.07,.72,ceilingWhite);
 }
 // Central hub: open fighting space, waist-high cover and a small reactor console.
 addVisualMesh(new THREE.CylinderGeometry(1.35,1.6,1.55,12),new THREE.MeshStandardMaterial({color:0x405965,metalness:.72,roughness:.3}),0,.78,0,true);
 const hubRing=addVisualMesh(new THREE.TorusGeometry(1.72,.12,8,32),cyan,0,1.5,0);hubRing.rotation.x=Math.PI/2;
 for(const [x,z,rot] of [[-4.8,-3.2,.12],[4.8,3.2,-.12],[-3.5,5,Math.PI/2],[3.5,-5,Math.PI/2]]){
  const cover=box(x,.72,z,2.8,1.44,.72,wallLight);cover.rotation.y=rot;
  const stripe=detailBox(x,1.47,z,2.5,.08,.76,amber);stripe.rotation.y=rot;
 }
 // Cargo pockets in the corners retain open lanes around the cover.
 for(const [x,z] of [[-17,-17],[17,-17],[-17,17],[17,17]]){
  box(x+(x<0?3.2:-3.2),.72,z,2.1,1.44,1.45,wallLight);
  box(x+(x<0?-3.2:3.2),.55,z+(z<0?3:-3),1.25,1.1,1.15,materials.crate);
 }
 // Pillars and short internal fins interrupt long sightlines without closing routes.
 for(const [x,z] of [[-20,-11],[20,-11],[-20,11],[20,11],[-11,-20],[11,-20],[-11,20],[11,20]]){
  box(x,1.25,z,1.05,2.5,1.05,wallLight);detailBox(x,2.55,z,1.18,.1,1.18,cyan);
 }
 for(const [x,z,sx,sz] of [[-5.8,-9.5,2.6,.42],[5.8,9.5,2.6,.42],[9.5,-5.8,.42,2.6],[-9.5,5.8,.42,2.6]]){
  const fin=box(x,1.8,z,sx,3.6,sz,wallLight);detailBox(x,3.68,z,sx*.82,.1,sz*.8,amber);
 }
 // Service ribs, exposed pipes and route lights reinforce the enclosed starfall-station setting.
 for(const z of [-22,-7,7,22]){
  detailBox(0,5.15,z,47,.18,.22,wallLight);
  for(const x of [-21,-14,-7,0,7,14,21])detailBox(x,5.0,z,.12,.42,.12,amber);
 }
 for(const x of [-22,22]){
  const pipe=addVisualMesh(new THREE.CylinderGeometry(.13,.13,44,12),wallLight,x,4.15,0);pipe.rotation.x=Math.PI/2;
  for(const z of [-16,0,16])mapLight(x,3.9,z,0x45cde0,.75,10);
 }
 for(const [x,z] of [[-5,-20],[5,-20],[-5,20],[5,20],[-20,-5],[20,5]]){
  box(x,.48,z,1.65,.96,1.05,materials.dark);detailBox(x,1.0,z,1.45,.08,1.1,amber);
 }
 for(const [x,z] of [[0,-23],[0,23],[-23,0],[23,0]])mapLight(x,3.7,z,0x52d7e8,1.25,14);
 // Training begins in the south pocket, looking toward the central hub.
 player.pos.set(0,1.7,17);player.yaw=0;updateCamera();
}


function buildStarfall(){
 clearMap();scene.background.set(0x071321);scene.fog.color.set(0x102638);scene.fog.density=.0052;
 hemi.color.set(0xa6d9ed);hemi.groundColor.set(0x101b29);hemi.intensity=1.65;
 moonLight.color.set(0xb8e5ff);moonLight.intensity=2.25;moonLight.position.set(-28,48,-34);
 fill.color.set(0x64a9c8);fill.intensity=.95;
 const floor=new THREE.MeshStandardMaterial({color:0x263b4a,roughness:.76,metalness:.35});
 const wall=new THREE.MeshStandardMaterial({color:0x182c3b,roughness:.48,metalness:.72});
 const trim=new THREE.MeshStandardMaterial({color:0x526d7d,roughness:.4,metalness:.62});
 const glass=new THREE.MeshPhysicalMaterial({color:0x73c6e8,metalness:.22,roughness:.16,transparent:true,opacity:.38,side:THREE.DoubleSide});
 const blue=new THREE.MeshStandardMaterial({color:0x50d9ed,emissive:0x117d9a,emissiveIntensity:1.15,metalness:.35,roughness:.28});
 const gold=new THREE.MeshStandardMaterial({color:0xd7a45d,emissive:0x74451d,emissiveIntensity:.6,metalness:.3,roughness:.4});
 const white=new THREE.MeshStandardMaterial({color:0x9bb8c6,emissive:0x263e4a,emissiveIntensity:.3,metalness:.25,roughness:.5});
 box(0,-.28,0,100,.56,100,floor,false);
 // Outer station shell and illuminated perimeter ribs.
 for(const side of [-1,1]){
  box(side*48.5,3,0,.9,6,99,wall);box(0,3,side*48.5,99,6,.9,wall);
  detailBox(side*47.95,5.65,0,.12,.14,96,blue);detailBox(0,5.65,side*47.95,96,.14,.12,blue);
 }
 for(let p=-40;p<=40;p+=10){box(p,3,-47.9,.28,6,.28,trim);box(p,3,47.9,.28,6,.28,trim);}
 // Central transfer hub — a circular power core with four open approaches.
 const hub=addVisualMesh(new THREE.CylinderGeometry(9.5,10.5,.22,48),trim,0,.12,0);
 const ring=addVisualMesh(new THREE.TorusGeometry(8.7,.18,8,64),blue,0,.28,0);ring.rotation.x=Math.PI/2;
 box(0,2.8,0,4.8,5.6,4.8,wall);
 for(const y of [1.25,2.8,4.35]){const r=addVisualMesh(new THREE.TorusGeometry(3.7,.13,8,40),blue,0,y,0);r.rotation.x=Math.PI/2;}
 mapLight(0,5.2,0,0x5bdff2,2.2,25);
 // Three distinct traversable lanes: a straight transit avenue and two curved side galleries.
 // Transit avenue cover islands.
 for(const [x,z,w,d] of [[-7,-27,4,2],[7,-16,4,2],[-7,16,4,2],[7,27,4,2]]){
  box(x,.9,z,w,1.8,d,trim);detailBox(x,1.85,z,w-.3,.1,d-.2,gold);
 }
 // West gallery: staggered research pods and a curved line of light.
 for(const [x,z,w,d,h] of [[-31,-29,12,9,5],[-35,-12,8,10,4],[-31,10,12,8,5],[-36,31,9,10,5]]){
  box(x,h/2,z,w,h,d,wall);detailBox(x,h+.05,z,w-.8,.14,d-.8,blue);
  box(x,1.2,z+(z<0?d/2:-d/2),w*.55,2.4,.35,trim);
 }
 for(const z of [-39,-24,-8,9,25,40]){box(-23,2.2,z,.45,4.4,5.5,wall);mapLight(-21.8,4.2,z,0x58d8ec,.8,11);}
 // East gallery: solar observatory, power conduits and equipment alcoves.
 for(const [x,z,w,d,h] of [[31,-31,13,10,6],[36,-9,8,12,4.5],[31,16,12,9,5],[36,36,8,8,5]]){
  box(x,h/2,z,w,h,d,wall);detailBox(x,h+.05,z,w-.8,.14,d-.8,gold);
  box(x,1.15,z+(z<0?d/2:-d/2),w*.52,2.3,.35,trim);
 }
 for(const z of [-38,-22,-5,13,30,42]){box(23,2.2,z,.45,4.4,5.5,wall);mapLight(21.8,4.2,z,0x58d8ec,.8,11);}
 // North observation deck with panoramic eclipse glass.
 box(0,.12,-40,24,.24,12,trim);
 box(-12,4,-40,.5,8,12,wall);box(12,4,-40,.5,8,12,wall);box(0,4,-46,24,8,.45,wall);
 detailBox(0,4,-45.72,22.8,7.4,.12,glass);
 for(const x of [-8,-4,0,4,8])detailBox(x,4,-45.55,.1,7.1,.16,blue);
 for(const x of [-8,0,8])mapLight(x,6.4,-39,0x91e5ff,1.2,18);
 // South docking gallery: open loading floor, pods and bright docking markers.
 for(const [x,z,color] of [[-13,34,0x536e7d],[-13,42,0x7a6249],[13,34,0x496a78],[13,42,0x6d5c4b]]){
  box(x,1.5,z,7,3,3,new THREE.MeshStandardMaterial({color,metalness:.45,roughness:.58}));
  detailBox(x,3.05,z,6.5,.1,2.6,gold);
 }
 for(const x of [-20,20]){box(x,3,39,.5,6,18,wall);detailBox(x,5.8,39,.12,.12,17,blue);}
 // Cross-links between the side galleries and central hub; low barriers create short cover decisions.
 for(const [x,z,rot] of [[-15,-5,.15],[15,5,-.15],[-15,24,-.2],[15,-24,.2],[-5,37,Math.PI/2],[5,-37,Math.PI/2]]){
  const cover=box(x,.78,z,4.8,1.56,1.35,trim);cover.rotation.y=rot;
  detailBox(x,.84,z,4.25,.1,1.38,gold).rotation.y=rot;
 }
 for(const [x,z] of [[-43,-43],[43,-43],[-43,43],[43,43],[0,-47],[0,47]])mapLight(x,4,z,0x63dff0,1.25,18);
 player.pos.set(0,1.7,43);player.yaw=Math.PI;updateCamera();
}

function buildSelectedMap(){
 if(selectedMap==='district')buildDistrict();
 else if(selectedMap==='industrial')buildIndustrial();
 else if(selectedMap==='starfall')buildStarfall();
 else buildSublevel();
}

function createEclipse(){
 const dustCount=420,dustPositions=new Float32Array(dustCount*3);for(let i=0;i<dustCount;i++){dustPositions[i*3]=(Math.random()-.5)*100;dustPositions[i*3+1]=.2+Math.random()*5;dustPositions[i*3+2]=(Math.random()-.5)*100;}const dustGeo=new THREE.BufferGeometry();dustGeo.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));dustField=new THREE.Points(dustGeo,new THREE.PointsMaterial({color:0xb5c2c8,size:.045,transparent:true,opacity:.32,depthWrite:false}));scene.add(dustField);mapObjects.push(dustField);
 const sun=new THREE.Mesh(new THREE.SphereGeometry(5,32,32),new THREE.MeshBasicMaterial({color:0x080b11}));sun.position.set(-35,42,-78);scene.add(sun);mapObjects.push(sun);
 const halo=new THREE.Mesh(new THREE.TorusGeometry(5.8,.16,10,96),new THREE.MeshBasicMaterial({color:0xe0a66b,transparent:true,opacity:.9}));halo.position.copy(sun.position);halo.lookAt(0,0,0);scene.add(halo);mapObjects.push(halo);
 const corona=new THREE.Mesh(new THREE.SphereGeometry(6.7,32,32),new THREE.MeshBasicMaterial({color:0x9a5932,transparent:true,opacity:.10,side:THREE.BackSide}));corona.position.copy(sun.position);scene.add(corona);mapObjects.push(corona);
 const stars=new THREE.Group();for(let i=0;i<180;i++){const dot=new THREE.Mesh(new THREE.SphereGeometry(.07,5,5),new THREE.MeshBasicMaterial({color:0x9eabb8,transparent:true,opacity:Math.random()*.65}));dot.position.set((Math.random()-.5)*180,15+Math.random()*65,(Math.random()-.5)*180);stars.add(dot);}scene.add(stars);mapObjects.push(stars);
}
function updateCamera(){camera.position.copy(player.pos);camera.rotation.order='YXZ';camera.rotation.y=player.yaw;camera.rotation.x=player.pitch;}
function buildViewWeapon(){
 if(viewWeapon){camera.remove(viewWeapon);viewWeapon.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});}
 const w=weapons[weaponIndex],g=new THREE.Group();
 const dark=new THREE.MeshStandardMaterial({color:0x101a22,metalness:.82,roughness:.25}),body=new THREE.MeshStandardMaterial({color:({standard:w.id==='rocket'?0x4b4035:w.id==='needler'?0x49304a:w.id==='shotgun'?0x3e454b:0x344d43,arctic:0x9daeb7,ember:0x8b4937,void:0x34324b}[w.build?.camo||'standard']),metalness:.62,roughness:.31}),glow=new THREE.MeshStandardMaterial({color:w.color,emissive:w.color,emissiveIntensity:1.5,metalness:.3,roughness:.18}),armor=new THREE.MeshPhysicalMaterial({color:0x667d56,metalness:.48,roughness:.35,clearcoat:.4}),glove=new THREE.MeshStandardMaterial({color:0x101719,roughness:.92}),trim=new THREE.MeshStandardMaterial({color:0x9aabae,metalness:.82,roughness:.25});
 const add=(p,geo,mat,x,y,z)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;p.add(m);return m;};
 const ell=(p,mat,x,y,z,sx,sy,sz)=>{const m=add(p,new THREE.SphereGeometry(1,20,14),mat,x,y,z);m.scale.set(sx,sy,sz);return m;};
 const box=(p,mat,x,y,z,sx,sy,sz)=>add(p,new THREE.BoxGeometry(sx,sy,sz),mat,x,y,z);
 const cyl=(p,mat,x,y,z,r,len)=>{const m=add(p,new THREE.CylinderGeometry(r,r,len,14),mat,x,y,z);m.rotation.x=Math.PI/2;return m;};
 const cap=(p,mat,x,y,z,r,len)=>add(p,new THREE.CapsuleGeometry(r,len,5,12),mat,x,y,z);
 const left=cap(g,armor,-.27,-.25,.13,.105,.34);left.rotation.z=.38;const right=cap(g,armor,.28,-.25,.15,.11,.36);right.rotation.z=-.42;
 ell(g,trim,-.27,-.43,.02,.12,.055,.12);ell(g,trim,.28,-.43,.03,.125,.055,.125);ell(g,glove,-.16,-.16,-.05,.105,.085,.14);ell(g,glove,.18,-.16,-.06,.11,.09,.15);
 let muzzle;
 if(w.id==='pulse'){
  box(g,body,0,0,0,.31,.22,.56);box(g,dark,0,.02,-.3,.22,.14,.25);box(g,body,0,-.12,.16,.2,.28,.2);box(g,trim,0,.14,-.04,.25,.045,.4);box(g,glow,0,.095,-.16,.11,.035,.16);cyl(g,dark,0,.015,-.53,.052,.38);cyl(g,trim,0,.015,-.73,.068,.055);box(g,dark,0,-.015,.36,.24,.16,.32);muzzle=ell(g,glow,0,.015,-.78,.07,.07,.035);
 }else if(w.id==='volt'||w.id==='magnum'){
  box(g,body,0,.015,-.03,.25,.16,.34);box(g,dark,0,.07,-.22,.2,.1,.22);cyl(g,dark,0,.04,-.37,.045,.2);cyl(g,glow,0,.04,-.48,.052,.035);box(g,trim,0,.12,-.07,.16,.035,.28);const grip=box(g,dark,0,-.16,.12,.14,.27,.16);grip.rotation.x=-.2;muzzle=ell(g,glow,0,.04,-.51,.055,.055,.03);
 }else if(w.id==='arc'){
  box(g,body,0,0,.02,.39,.27,.78);box(g,dark,0,.02,-.43,.29,.2,.38);box(g,body,0,-.18,.2,.25,.34,.3);for(const side of [-1,1]){cyl(g,dark,side*.105,.025,-.72,.052,.52);cyl(g,glow,side*.105,.025,-.99,.064,.05);const coil=add(g,new THREE.TorusGeometry(.065,.018,8,18),glow,side*.105,.025,-.64);coil.rotation.x=Math.PI/2;}box(g,glow,.225,.015,.08,.09,.2,.29);box(g,dark,0,.005,.52,.34,.2,.34);muzzle=ell(g,glow,0,.025,-1.04,.11,.08,.04);
 }else if(w.id==='sniper'){
  box(g,body,0,0,.02,.34,.22,.92);box(g,dark,0,.04,-.48,.19,.15,.52);cyl(g,dark,0,.035,-.92,.047,.82);cyl(g,trim,0,.035,-1.34,.065,.07);box(g,body,0,-.17,.28,.22,.32,.38);box(g,dark,0,.19,-.08,.16,.13,.36);const scope=add(g,new THREE.CylinderGeometry(.075,.075,.28,16),dark,0,.25,-.12);scope.rotation.x=Math.PI/2;const lens=add(g,new THREE.TorusGeometry(.08,.012,8,20),glow,0,.25,-.27);lens.rotation.x=Math.PI/2;muzzle=ell(g,glow,0,.035,-1.4,.065,.065,.035);
 }else if(w.id==='needler'){
  box(g,body,0,0,.02,.34,.23,.58);box(g,dark,0,-.11,.28,.23,.27,.26);box(g,glow,0,.11,-.08,.16,.07,.38);cyl(g,dark,0,.015,-.42,.055,.25);
  for(let i=0;i<5;i++){const spike=add(g,new THREE.ConeGeometry(.065,.42,5),glow,(i-2)*.105,.22-Math.abs(i-2)*.035,-.12);spike.rotation.x=-Math.PI/2;spike.rotation.z=(i-2)*.16;}
  for(const side of [-1,1])ell(g,glow,side*.19,.02,.12,.07,.13,.18);muzzle=ell(g,glow,0,.02,-.57,.09,.09,.045);
 }else if(w.id==='rocket'){
  cyl(g,body,0,.02,-.12,.16,.92);cyl(g,dark,0,.02,-.62,.19,.12);cyl(g,glow,0,.02,-.71,.12,.06);box(g,dark,0,-.18,.28,.25,.2,.42);box(g,trim,0,.18,.02,.34,.07,.44);
  for(let i=0;i<4;i++){const a=i*Math.PI/2,fin=box(g,body,Math.cos(a)*.17,-.02,.42,.18,.035,.32);fin.rotation.z=a;}
  muzzle=ell(g,glow,0,.02,-.76,.15,.15,.05);
 }else if(w.id==='shotgun'){
  box(g,body,0,0,.02,.38,.25,.7);for(const side of [-1,1]){cyl(g,dark,side*.105,.035,-.48,.065,.78);cyl(g,trim,side*.105,.035,-.88,.075,.06);}box(g,dark,0,-.18,.23,.26,.28,.3);box(g,trim,0,.17,-.05,.25,.04,.38);muzzle=ell(g,glow,0,.035,-.94,.12,.08,.04);
 }else{
  box(g,body,0,0,.02,.34,.24,.62);box(g,dark,0,-.13,.25,.23,.3,.28);box(g,trim,0,.16,-.04,.3,.05,.38);for(let i=-1;i<=1;i++)box(g,glow,i*.1,.08,-.22,.045,.045,.22);cyl(g,dark,0,.02,-.52,.06,.28);muzzle=ell(g,glow,0,.02,-.67,.075,.075,.04);
 }
 muzzle.visible=false;g.userData.muzzleFlash=muzzle;
 const build=w.build||DEFAULT_WEAPON_BUILD;
 if(build.barrel==='extended'||build.barrel==='heavy'){const length=build.barrel==='heavy'?.28:.18;const ext=cyl(g,trim,0,.02,-.78,.052,length);ext.position.z-=length*.45;}
 if(build.magazine==='extended')box(g,dark,0,-.24,.13,.15,.32,.18);
 if(build.stock==='tactical')box(g,trim,0,-.02,.39,.29,.12,.28);
 if(build.underbarrel==='grip'||build.underbarrel==='laser')box(g,build.underbarrel==='laser'?glow:dark,build.underbarrel==='laser'?.17:0,-.18,-.18,.1,.16,.24);
 const reloadPart=box(g,dark,.19,-.13,.08,.12,.22,.2);g.userData.reloadPart=reloadPart;
 g.position.set(.43,-.34,-.72);g.rotation.set(-.04,-.08,0);g.userData.basePosition=g.position.clone();g.userData.baseRotation=g.rotation.clone();camera.add(g);viewWeapon=g;playWeaponAnimation('switch',260);
 $('weapon-name').textContent=weaponDisplayName(w);$('weapon-class').textContent=w.className;syncAmmo();
}
function applyLoadout(save=true){
 const primaryBase=PRIMARY_WEAPONS.find(w=>w.id===selectedPrimary)||ALL_WEAPONS[0],secondaryBase=SECONDARY_WEAPONS.find(w=>w.id===selectedSecondary)||ALL_WEAPONS[1];
 selectedPrimary=primaryBase.id;selectedSecondary=secondaryBase.id;const primary=getBuiltWeapon(primaryBase),secondary=getBuiltWeapon(secondaryBase);weapons=[primary,secondary];weaponIndex=0;weaponAmmo=weapons.map(w=>({ammo:w.mag,reserve:w.stock}));
 refreshLoadoutOptions();
 if(save){try{localStorage.setItem('eclipse-loadout',JSON.stringify({primary:selectedPrimary,secondary:selectedSecondary,equipment:selectedEquipment}));localStorage.setItem('eclipse-weapon-builds',JSON.stringify(weaponBuilds));}catch{}}
 const summary=$('loadout-summary');if(summary)summary.textContent=weaponDisplayName(primary)+' ['+weaponBuildDetails(primary)+']  /  '+weaponDisplayName(secondary)+' ['+weaponBuildDetails(secondary)+']  /  '+selectedEquipment.toUpperCase().replace('-',' ');
}
function initLoadout(){
 try{weaponBuilds=JSON.parse(localStorage.getItem('eclipse-weapon-builds')||'{}')||{};}catch{weaponBuilds={};}
 try{const saved=JSON.parse(localStorage.getItem('eclipse-loadout')||'{}');if(PRIMARY_WEAPONS.some(w=>w.id===saved.primary))selectedPrimary=saved.primary;if(SECONDARY_WEAPONS.some(w=>w.id===saved.secondary))selectedSecondary=saved.secondary;if(['shield','recon','ammo'].includes(saved.equipment))selectedEquipment=saved.equipment;}catch{}
 $('primary-select').value=selectedPrimary;$('secondary-select').value=selectedSecondary;$('equipment-select').value=selectedEquipment;
 for(const id of ['primary-select','secondary-select','equipment-select'])$(id).addEventListener('change',()=>{selectedPrimary=$('primary-select').value;selectedSecondary=$('secondary-select').value;selectedEquipment=$('equipment-select').value;applyLoadout(true);});
 applyLoadout(false);
}
function startAmbientAudio(){
 const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;
 if(!audioContext){audioContext=new AudioCtx();const master=audioContext.createGain();master.gain.value=.18;master.connect(audioContext.destination);
  const low=audioContext.createOscillator(),high=audioContext.createOscillator(),filter=audioContext.createBiquadFilter(),gain=audioContext.createGain();low.type='sine';low.frequency.value=48;high.type='triangle';high.frequency.value=73;filter.type='lowpass';filter.frequency.value=180;gain.gain.value=.12;low.connect(filter);high.connect(filter);filter.connect(gain);gain.connect(master);low.start();high.start();ambientNodes={low,high,filter,gain,master};
 }audioContext.resume();if(ambientNodes){ambientNodes.low.frequency.setTargetAtTime(selectedMap==='industrial'?42:selectedMap==='sublevel'?58:selectedMap==='starfall'?48:52,audioContext.currentTime,1);ambientNodes.high.frequency.setTargetAtTime(selectedMap==='industrial'?61:selectedMap==='starfall'?72:79,audioContext.currentTime,1);}
}
function playSfx(kind='pulse',color=0xffc16e){
 if(!audioContext)return;const osc=audioContext.createOscillator(),gain=audioContext.createGain();const now=audioContext.currentTime;
 osc.type=kind==='impact'?'triangle':kind==='rocket'?'sawtooth':'square';osc.frequency.setValueAtTime(kind==='rocket'?95:kind==='impact'?180:kind==='needler'?720:340,now);osc.frequency.exponentialRampToValueAtTime(kind==='rocket'?38:kind==='impact'?65:130,now+.16);gain.gain.setValueAtTime(.075,now);gain.gain.exponentialRampToValueAtTime(.001,now+.19);osc.connect(gain);gain.connect(audioContext.destination);osc.start(now);osc.stop(now+.2);
}
function spawnImpact(position,color=0xffc16e){
 const count=12,positions=[],velocities=[];for(let i=0;i<count;i++){positions.push(position.x,position.y,position.z);const v=new THREE.Vector3(Math.random()-.5,Math.random()*.9,Math.random()-.5).normalize().multiplyScalar(1.5+Math.random()*3.2);velocities.push(v);}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));const pts=new THREE.Points(geo,new THREE.PointsMaterial({color,size:.13,transparent:true,opacity:1,depthWrite:false}));scene.add(pts);impactParticles.push({pts,velocities,life:.42,maxLife:.42});playSfx('impact');
}
function updateEnvironment(dt){
 if(dustField){const a=dustField.geometry.attributes.position;for(let i=0;i<a.count;i++){let y=a.getY(i)+dt*(.12+(i%5)*.025);let x=a.getX(i)+Math.sin(performance.now()*.0003+i)*dt*.08;if(y>6)y=.15+(i%20)*.27;if(x>52)x=-52;if(x< -52)x=52;a.setXYZ(i,x,y,a.getZ(i));}a.needsUpdate=true;}
 for(let i=impactParticles.length-1;i>=0;i--){const p=impactParticles[i];const a=p.pts.geometry.attributes.position;for(let j=0;j<p.velocities.length;j++){const v=p.velocities[j];v.y-=8*dt;a.setXYZ(j,a.getX(j)+v.x*dt,a.getY(j)+v.y*dt,a.getZ(j)+v.z*dt);}p.life-=dt;p.pts.material.opacity=Math.max(0,p.life/p.maxLife);a.needsUpdate=true;if(p.life<=0){scene.remove(p.pts);p.pts.geometry.dispose();p.pts.material.dispose();impactParticles.splice(i,1);}}
}
function useEquipment(){
 if(!running||paused||health<=0||performance.now()<equipmentReadyAt)return;equipmentReadyAt=performance.now()+25000;
 if(training){if(selectedEquipment==='shield'){health=Math.min(100,health+35);updateHealthHud();}else if(selectedEquipment==='ammo'){weaponAmmo[weaponIndex].reserve+=40;syncAmmo();}else{spawnImpact(player.pos,0x68d9ff);}toast('EQUIPMENT DEPLOYED');}
 else send('equipment',{equipment:selectedEquipment});
}

function syncAmmo(){const a=weaponAmmo[weaponIndex];ammo=a.ammo;reserve=a.reserve;$('ammo').textContent=ammo;$('reserve').textContent=reserve;}
function playWeaponAnimation(kind,duration=220){weaponAnimation={kind,start:performance.now(),duration};}
function updateWeaponAnimation(dt){if(!viewWeapon)return;const now=performance.now(),a=viewWeapon.userData.basePosition||new THREE.Vector3(.43,-.34,-.72),r=viewWeapon.userData.baseRotation||new THREE.Euler(-.04,-.08,0);let t=weaponAnimation.duration?THREE.MathUtils.clamp((now-weaponAnimation.start)/weaponAnimation.duration,0,1):1;const smooth=t*t*(3-2*t);let x=0,y=0,z=0,rx=0,ry=0,rz=0,mag=0;
 if(weaponAnimation.kind==='switch'){const k=1-smooth;y=-.42*k;rz=.48*k;rx=-.18*k;}
 else if(weaponAnimation.kind==='reload'){const k=Math.sin(Math.PI*smooth);y=-.17*k;rx=.42*k;rz=.12*k;mag=-.2*k;}
 else if(weaponAnimation.kind==='inspect'){const k=Math.sin(Math.PI*smooth);y=.08*k;z=.08*k;rx=.48*k;ry=.58*k;rz=.62*k;}
 else if(weaponAnimation.kind==='fire'){const k=1-smooth;y=-.025*k;rx=-.07*k;rz=(weapons[weaponIndex].id==='shotgun'?.09:.025)*k;}
 if(t>=1&&weaponAnimation.kind!=='idle')weaponAnimation={kind:'idle',start:0,duration:0};
 const aiming=isAiming?weapons[weaponIndex].id==='sniper'?{x:-.39,y:.05,z:-.22}:{x:-.16,y:.015,z:-.08}:{x:0,y:0,z:0};viewWeapon.position.set(a.x+x+aiming.x,a.y+y+Math.sin(now*.009)*.012*moveBob+aiming.y,a.z+z+weaponRecoil*.09+aiming.z);viewWeapon.rotation.set(r.x+rx-weaponRecoil*.13,r.y+ry,r.z+rz+Math.cos(now*.006)*.009*moveBob);
 const part=viewWeapon.userData.reloadPart;if(part){part.position.y=-.13+mag;part.rotation.z=weaponAnimation.kind==='reload'?.55*Math.sin(Math.PI*smooth):0;}
}
function switchWeapon(index){if(index<0||index>=weapons.length||index===weaponIndex)return;if(reloadTimer){clearTimeout(reloadTimer);reloadTimer=null;}if(autoReloadTimer){clearTimeout(autoReloadTimer);autoReloadTimer=null;}weaponAmmo[weaponIndex].ammo=ammo;weaponAmmo[weaponIndex].reserve=reserve;weaponIndex=index;reloading=false;buildViewWeapon();playWeaponAnimation('switch',300);toast(weapons[index].name);}

function collides(pos){if(Math.abs(pos.x)>47.8||Math.abs(pos.z)>47.8)return true;const pbox=new THREE.Box3(new THREE.Vector3(pos.x-.32,pos.y-1.55,pos.z-.32),new THREE.Vector3(pos.x+.32,pos.y+.05,pos.z+.32));return colliders.some(b=>b.intersectsBox(pbox));}
function tryMantle(forward){
 const probe=player.pos.clone().addScaledVector(forward,.72),candidate=new THREE.Box3(new THREE.Vector3(probe.x-.32,player.pos.y-1.55,probe.z-.32),new THREE.Vector3(probe.x+.32,player.pos.y+.05,probe.z+.32));
 const obstacle=colliders.find(b=>b.intersectsBox(candidate));if(!obstacle)return false;
 const floor=rampFloorHeight(player.pos.x,player.pos.z),rise=obstacle.max.y-floor;if(rise<.22||rise>1.28)return false;
 const destination=player.pos.clone().addScaledVector(forward,1.28);destination.y=obstacle.max.y+1.7;
 mantleState={from:player.pos.clone(),to:destination,start:performance.now(),duration:440};verticalVelocity=0;player.onGround=false;return true;
}
function movePlayer(dt){
 if(health<=0){updateCamera();return;}
 const now=performance.now(),forward=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw)),right=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));
 if(mantleState){const t=THREE.MathUtils.clamp((now-mantleState.start)/mantleState.duration,0,1),ease=t*t*(3-2*t);player.pos.lerpVectors(mantleState.from,mantleState.to,ease);if(t>=1){mantleState=null;player.onGround=true;lastGroundedAt=now;}updateCamera();return;}
 let dir=new THREE.Vector3();if(keys.KeyW)dir.add(forward);if(keys.KeyS)dir.sub(forward);if(keys.KeyD)dir.add(right);if(keys.KeyA)dir.sub(right);if(dir.lengthSq())dir.normalize();
 player.moving=dir.lengthSq()>.01;const sprinting=Boolean(keys.ShiftLeft&&player.moving);if(!keys.KeyC)slideTriggered=false;if(keys.KeyC&&player.moving&&player.onGround&&now>slideUntil&&!slideTriggered){slideUntil=now+5000;slideDirection.copy(dir);slideTriggered=true;}
 const sliding=now<slideUntil;if(sliding&&dir.lengthSq()>.01){slideDirection.lerp(dir,Math.min(1,dt*4.5)).normalize();}const boosted=now<operatorBoostUntil;const targetSpeed=sliding?9.6:keys.ControlLeft?2.7:boosted?9.4:5.2+2.1*sprintBlend;sprintBlend=THREE.MathUtils.damp(sprintBlend,sprinting&&!sliding?1:0,sliding?14:5,dt);
 player.crouching=Boolean(keys.ControlLeft||sliding);const accel=sliding?5:12;const moveDir=sliding?slideDirection:dir;player.vel.x=THREE.MathUtils.damp(player.vel.x,moveDir.x*targetSpeed,accel,dt);player.vel.z=THREE.MathUtils.damp(player.vel.z,moveDir.z*targetSpeed,accel,dt);
 const next=player.pos.clone();next.x+=player.vel.x*dt;if(!collides(next))player.pos.x=next.x;else if(player.onGround&&sprinting)tryMantle(moveDir);
 next.copy(player.pos);next.z+=player.vel.z*dt;if(!collides(next))player.pos.z=next.z;else if(player.onGround&&sprinting&&!mantleState)tryMantle(moveDir);
 const eyeHeight=sliding ? .92 : keys.ControlLeft ? 1.15 : 1.7;const floor=rampFloorHeight(player.pos.x,player.pos.z)+eyeHeight;verticalVelocity-= (player.onGround&&verticalVelocity<0?24:19)*dt;player.pos.y+=verticalVelocity*dt;
 if(player.pos.y<=floor){player.pos.y=floor;verticalVelocity=0;player.onGround=true;lastGroundedAt=now;}else player.onGround=false;
 if(sliding&&now>=slideUntil){slideUntil=0;}
 moveBob=THREE.MathUtils.damp(moveBob,player.moving?1:0,sliding?5:8,dt);weaponRecoil=Math.max(0,weaponRecoil-dt*4.5);updateCamera();
}
function makeRemote(id,data={}){
  const group=new THREE.Group(),teamColors=[0x4c9eac,0xd2a45c,0x78a77c,0x9b83c5],teamColor=data.team==null?0x6b9b67:teamColors[data.team%teamColors.length];
  const operator=OPERATOR_PRESETS[data.operator]?data.operator:'vanguard',preset=OPERATOR_PRESETS[operator];
  const armor=new THREE.MeshPhysicalMaterial({color:preset.armor,metalness:.48,roughness:.34,clearcoat:.42}),armorLight=new THREE.MeshPhysicalMaterial({color:preset.light,metalness:.42,roughness:.36,clearcoat:.35}),undersuit=new THREE.MeshStandardMaterial({color:0x111a1c,roughness:.92}),graphite=new THREE.MeshStandardMaterial({color:0x26343a,metalness:.76,roughness:.3}),steel=new THREE.MeshStandardMaterial({color:0x87999a,metalness:.8,roughness:.28}),accent=new THREE.MeshStandardMaterial({color:teamColor,emissive:teamColor,emissiveIntensity:.22,metalness:.38,roughness:.3}),visor=new THREE.MeshPhysicalMaterial({color:preset.visor,emissive:preset.visorGlow,emissiveIntensity:.42,metalness:.65,roughness:.2,clearcoat:1}),rubber=new THREE.MeshStandardMaterial({color:0x080d10,roughness:.98});
  const add=(p,g,m,x,y,z)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;p.add(o);return o;},ell=(p,m,x,y,z,sx,sy,sz)=>{const o=add(p,new THREE.SphereGeometry(1,24,16),m,x,y,z);o.scale.set(sx,sy,sz);return o;},cap=(p,m,x,y,z,r,l)=>add(p,new THREE.CapsuleGeometry(r,l,6,14),m,x,y,z);
  // Each preset shares the same rig but changes armour finish, visor, and silhouette.
  cap(group,undersuit,0,1.06,0,.255,.54);ell(group,armor,0,1.26,-.035,.34,.39,.235);ell(group,armorLight,0,1.29,-.205,.285,.255,.105);ell(group,graphite,0,.91,.005,.25,.18,.205);
  for(let i=0;i<3;i++)ell(group,i===1?armorLight:armor,0,.83+i*.13,-.205,.235,.075,.075);
  const collar=add(group,new THREE.TorusGeometry(.245,.075,12,32),graphite,0,1.53,0);collar.rotation.x=Math.PI/2;
  ell(group,undersuit,0,1.67,0,.225,.245,.205);ell(group,armorLight,0,1.72,.005,.255,.265,.22);ell(group,armor,0,1.81,.015,.255,.19,.225);ell(group,visor,0,1.69,-.183,.205,.105,.055);ell(group,graphite,0,1.91,.005,.19,.055,.18);
  for(const s of [-1,1]){
    ell(group,graphite,s*.245,1.68,0,.075,.12,.14);ell(group,accent,s*.255,1.68,-.01,.035,.065,.09);
    const shoulder=ell(group,armorLight,s*.405,1.38,-.005,.245*preset.shoulder,.205*preset.shoulder,.255*preset.shoulder);shoulder.rotation.z=s*.12;
    ell(group,armor,s*.405,1.43,-.11,.205*preset.shoulder,.135*preset.shoulder,.19*preset.shoulder);ell(group,accent,s*.405,1.47,-.255,.09,.035,.025);cap(group,undersuit,s*.31,.94,0,.115,.27);
  }
  ell(group,graphite,0,1.25,.255,.27,.39,.17);ell(group,armor,0,1.29,.365,.215,.29,.11);
  for(const s of [-1,1]){ell(group,steel,s*.205,1.38,.34,.075,.19,.09);ell(group,accent,s*.205,1.46,.405,.045,.07,.025);}
  // Distinct helmet hardware and back-mounted equipment for each operator class.
  const pack=add(group,new RoundedBoxGeometry(operator==='assault'?.52:.42,operator==='assault'?.68:.58,.24,3,.07),graphite,0,1.18,.285);
  for(const s of [-1,1]){const module=ell(group,operator==='recon'?visor:steel,s*.25,1.24,.31,.075,.18,.1);module.rotation.z=s*.12;}
  if(operator==='recon'){const aerial=cap(group,steel,-.17,2.03,.02,.018,.28);aerial.rotation.z=-.12;ell(group,visor,-.17,2.18,.02,.035,.035,.035);}
  if(operator==='assault'){for(const s of [-1,1]){const plate=ell(group,armorLight,s*.43,1.47,.02,.19,.095,.22);plate.rotation.z=s*.18;}ell(group,visor,0,1.98,-.02,.13,.045,.13);}
  if(operator==='phantom'){for(const s of [-1,1]){const fin=add(group,new THREE.ConeGeometry(.075,.28,5),armorLight,s*.18,2.02,.02);fin.rotation.z=s*.2;}pack.scale.set(1.12,1.1,1);}
  const leftArm=new THREE.Group();leftArm.position.set(-.34,1.34,0);group.add(leftArm);const rightArm=new THREE.Group();rightArm.position.set(.34,1.34,0);group.add(rightArm);
  for(const [p,s] of [[leftArm,-1],[rightArm,1]]){cap(p,undersuit,s*.025,-.21,0,.105,.3);const upper=ell(p,armor,s*.025,-.22,-.015,.145,.235,.145);upper.rotation.z=s*-.1;cap(p,undersuit,s*.035,-.49,-.035,.09,.27);const bracer=ell(p,armorLight,s*.035,-.49,-.115,.12,.205,.12);bracer.rotation.z=s*-.08;ell(p,graphite,s*.035,-.65,-.12,.105,.09,.1);ell(p,accent,s*.035,-.5,-.215,.055,.1,.025);ell(p,rubber,s*.035,-.72,-.09,.095,.12,.105);}
  const leftLeg=new THREE.Group();leftLeg.position.set(-.15,.72,0);group.add(leftLeg);const rightLeg=new THREE.Group();rightLeg.position.set(.15,.72,0);group.add(rightLeg);
  for(const [p,s] of [[leftLeg,-1],[rightLeg,1]]){cap(p,undersuit,0,-.245,0,.12,.39);const thigh=ell(p,armor,0,-.235,-.015,.155,.255,.16);thigh.rotation.z=s*.025;ell(p,armorLight,0,-.49,-.105,.145,.12,.115);ell(p,graphite,0,-.53,-.02,.13,.105,.13);cap(p,undersuit,0,-.72,-.015,.105,.28);const shin=ell(p,armor,0,-.72,-.105,.13,.205,.12);shin.rotation.x=-.08;ell(p,accent,s*.055,-.7,-.205,.055,.105,.025);ell(p,rubber,0,-.91,-.11,.15,.085,.245);ell(p,graphite,0,-.91,-.23,.12,.055,.12);}
  const panelMat=new THREE.MeshPhysicalMaterial({color:preset.light,metalness:.62,roughness:.28,clearcoat:.55});
  const panelDark=new THREE.MeshStandardMaterial({color:0x34483d,metalness:.72,roughness:.3});
  const panelEdge=new THREE.LineBasicMaterial({color:0x172329,transparent:true,opacity:.95});
  const makePlate=(parent,mat,x,y,z,points,depth=.065)=>{const sh=new THREE.Shape();sh.moveTo(points[0][0],points[0][1]);for(let n=1;n<points.length;n++)sh.lineTo(points[n][0],points[n][1]);sh.closePath();const geo=new THREE.ExtrudeGeometry(sh,{depth,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.018,bevelThickness:.018,curveSegments:1});geo.translate(0,0,-depth/2);const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo,20),panelEdge));return mesh;};
  makePlate(group,panelMat,0,1.34,-.305,[[-.27,.12],[-.21,.22],[-.035,.16],[-.025,-.09],[-.18,-.14],[-.27,-.02]],.075);
  makePlate(group,panelMat,0,1.34,-.305,[[.27,.12],[.21,.22],[.035,.16],[.025,-.09],[.18,-.14],[.27,-.02]],.075);
  makePlate(group,panelDark,0,1.33,-.35,[[-.035,.18],[.035,.18],[.045,-.17],[-.045,-.17]],.035);
  for(let n=0;n<3;n++){const y=1.04-n*.105,w=.19-n*.012;makePlate(group,n===1?panelMat:armor,0,y,-.27,[[-w,.045],[-w*.78,-.045],[0,-.07],[w*.78,-.045],[w,.045],[0,.075]],.055);}
  for(const side of [-1,1]){makePlate(group,panelMat,side*.405,1.4,-.235,[[0,.21],[side*.17,.13],[side*.18,-.035],[side*.07,-.19],[-side*.12,-.15],[-side*.19,.035]],.075);makePlate(group,accent,side*.405,1.4,-.282,[[0,.075],[side*.075,.035],[side*.04,-.045],[-side*.04,-.045],[-side*.075,.025]],.025);const arm=side<0?leftArm:rightArm,leg=side<0?leftLeg:rightLeg;makePlate(arm,panelMat,side*.025,-.49,-.235,[[-.085,.17],[.065,.19],[.11,.035],[.065,-.16],[-.06,-.19],[-.12,-.035]],.06);makePlate(leg,panelMat,0,-.235,-.235,[[-.13,.2],[.075,.23],[.15,.08],[.105,-.17],[-.04,-.22],[-.145,-.055]],.06);makePlate(leg,panelMat,0,-.72,-.225,[[-.105,.18],[.08,.18],[.12,.02],[.075,-.17],[-.055,-.2],[-.13,-.035]],.06);makePlate(leg,accent,0,-.49,-.19,[[-.09,.055],[.09,.055],[.08,-.055],[0,-.1],[-.08,-.055]],.025);}
  const gun=new THREE.Group();gun.position.set(.25,1.02,-.31);gun.rotation.x=-.08;group.add(gun);ell(gun,graphite,0,0,-.1,.115,.105,.26);ell(gun,armor,0,.035,-.09,.09,.075,.22);const barrel=cap(gun,steel,0,.005,-.39,.035,.24);barrel.rotation.x=Math.PI/2;ell(gun,accent,0,.075,-.17,.052,.025,.12);const grip=cap(gun,graphite,0,-.13,.04,.045,.13);grip.rotation.x=-.18;
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(.43,24),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.28,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.015;group.add(shadow);
  const labelCanvas=document.createElement('canvas');labelCanvas.width=256;labelCanvas.height=64;const ctx=labelCanvas.getContext('2d');ctx.fillStyle='rgba(5,12,18,.7)';ctx.fillRect(12,10,232,44);ctx.strokeStyle='#9fc4b1';ctx.strokeRect(12,10,232,44);ctx.fillStyle='#eef4ef';ctx.font='bold 22px Arial';ctx.textAlign='center';ctx.fillText(String(data.name||'SPARTAN').slice(0,18),128,39);const tex=new THREE.CanvasTexture(labelCanvas);const label=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));label.scale.set(1.35,.34,1);label.position.set(0,2.22,0);group.add(label);
  group.userData={targetPosition:new THREE.Vector3(),targetYaw:0,moving:false,crouching:false,animTime:Math.random()*5,leftLeg,rightLeg,leftArm,rightArm,gun,health:100,alive:true,operator};scene.add(group);remotePlayers.set(id,group);return group;
}
function updateRemote(data){
 let g=remotePlayers.get(data.id)||makeRemote(data.id,data);
 const baseY=(Number(data.y)||1.7)-(data.crouching?1.15:1.7);
 g.userData.targetPosition.set(Number(data.x)||0,Math.max(0,baseY),Number(data.z)||0);
 g.userData.targetYaw=Number(data.yaw)||0;g.userData.moving=Boolean(data.moving);g.userData.crouching=Boolean(data.crouching);
 g.userData.health=Number.isFinite(data.health)?data.health:100;g.userData.alive=data.alive!==false;g.visible=g.userData.alive&&!data.cloaked;g.userData.cloaked=Boolean(data.cloaked);
}
function updateRemoteModels(dt){
 const alpha=1-Math.exp(-13*dt);
 for(const g of remotePlayers.values()){
  const d=g.userData;g.position.lerp(d.targetPosition,alpha);
  let angle=((d.targetYaw-g.rotation.y+Math.PI)%(Math.PI*2)+(Math.PI*2))%(Math.PI*2)-Math.PI;g.rotation.y+=angle*alpha;
  d.animTime+=dt*(d.moving?9:2.2);const swing=d.moving?Math.sin(d.animTime)*.58:0;
  d.leftLeg.rotation.x=swing;d.rightLeg.rotation.x=-swing;
  d.leftArm.rotation.x=-swing*.42;d.rightArm.rotation.x=swing*.42;
  g.position.y=THREE.MathUtils.damp(g.position.y,d.targetPosition.y,12,dt);g.scale.y=THREE.MathUtils.damp(g.scale.y,d.crouching?.78:1,12,dt);
  d.gun.rotation.x=THREE.MathUtils.damp(d.gun.rotation.x,-.08,10,dt);
 }
}
function applyServerPosition(data){if(!data)return;player.pos.set(Number(data.x)||0,Number(data.y)||1.7,Number(data.z)||0);player.yaw=Number(data.yaw)||0;player.pitch=Number(data.pitch)||0;verticalVelocity=0;player.onGround=true;updateCamera();}
function removeRemote(id){const g=remotePlayers.get(id);if(g){scene.remove(g);g.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});remotePlayers.delete(id);}}

function send(type,payload={}){if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type,...payload}));}
function connectServer(){return new Promise((resolve)=>{let url=$('server-url').value.trim()||autoServerUrl();let done=false;try{socket=new WebSocket(url);}catch{resolve(false);return;}const finish=(ok)=>{if(done)return;done=true;clearTimeout(timeout);resolve(ok);};const timeout=setTimeout(()=>{finish(false);try{socket?.close();}catch{}},8000);socket.onopen=()=>{$('server-dot').parentElement.classList.add('connected');$('server-label').textContent='CONNECTED';activeRoomCode=($('room-code')?.value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);if(!activeRoomCode&&$('private-room')?.checked)activeRoomCode=Math.random().toString(36).slice(2,8).toUpperCase();send('join',{mode:selectedMode,map:selectedMap,roomCode:activeRoomCode,botCount:Number($('bot-count')?.value||0),operator:selectedOperator,primary:selectedPrimary,secondary:selectedSecondary,equipment:selectedEquipment,profileId:PROFILE_ID,builds:weaponBuilds,name:'ECLIPSE-'+Math.floor(10+Math.random()*89)});};socket.onmessage=(ev)=>{let m;try{m=JSON.parse(ev.data);}catch{return;}if(m.type==='welcome')finish(true);if(m.type==='error'&&!done)finish(false);handleNetwork(m);};socket.onclose=()=>{$('server-dot').parentElement.classList.remove('connected');$('server-label').textContent='OFFLINE / LOCAL';if(!done)finish(false);if(running&&!training){running=false;paused=false;spectating=false;matchStarted=false;isAiming=false;mouseHeld=false;if(reloadTimer){clearTimeout(reloadTimer);reloadTimer=null;}if(autoReloadTimer){clearTimeout(autoReloadTimer);autoReloadTimer=null;}reloading=false;$('hud').classList.add('hidden');$('pause').classList.remove('active');$('menu').classList.add('active');players=[];for(const id of remotePlayers.keys())removeRemote(id);toast('CONNECTION LOST · RETURNED TO BASE');}else if($('lobby').classList.contains('active')){$('lobby').classList.remove('active');$('menu').classList.add('active');toast('SERVER DISCONNECTED');}};socket.onerror=()=>{if(!done)finish(false);};});}
function handleNetwork(m){
 if(m.type==='welcome'){
  myId=m.id;teamId=m.team;activeRoomCode=m.roomCode||'';if($('lobby-room-code'))$('lobby-room-code').textContent=activeRoomCode||'PUBLIC LOBBY';devModeEnabled=Boolean(m.devMode);updateDevMenuStatus();if(m.profile)acceptProfile(m.profile);players=m.players||[];serverSpawn=m.self||players.find(p=>p.id===myId)||null;
  if(serverSpawn)applyServerPosition(serverSpawn);renderPlayers();
 }
 if(m.type==='players'||m.type==='state'||m.type==='scoreUpdate'||m.type==='elimination'){
  players=m.players||players;if(m.type==='players'||m.type==='elimination')renderPlayers();
  players.forEach(p=>{if(p.id!==myId)updateRemote(p);});
  const ids=new Set(players.map(p=>p.id));for(const id of remotePlayers.keys())if(!ids.has(id))removeRemote(id);
  const mine=players.find(p=>p.id===myId);if(mine){
   health=Number.isFinite(mine.health)?mine.health:health;updateHealthHud();
   if(!training){const drift=Math.hypot(mine.x-player.pos.x,mine.y-player.pos.y,mine.z-player.pos.z);if(drift>1.8){player.pos.set(mine.x,mine.y,mine.z);verticalVelocity=0;mantleState=null;updateCamera();}}
  }
  $('scoreboard-mini').innerHTML=`YOU <b>${kills}</b> <i>—</i> TOP <b>${Math.max(0,...players.map(p=>p.score||0))}</b>`;
 }
 if(m.type==='shot'&&m.id!==myId){
  const origin=new THREE.Vector3(m.ox??m.x,m.oy??1.45,m.oz??m.z);
  const base=ALL_WEAPONS.find(w=>w.id===m.weapon)||ALL_WEAPONS[0],remoteWeapon={...base,ammoType:m.ammoType||'standard',explosive:base.explosive||m.ammoType==='explosive',radius:Math.max(base.radius||0,m.ammoType==='explosive'?3.2:0),color:m.ammoType==='incendiary'?0xff744a:m.ammoType==='shock'?0x7b8dff:base.color};spawnPulse(origin,new THREE.Vector3(m.dx,m.dy||0,m.dz),false,remoteWeapon);
  const remote=remotePlayers.get(m.id);if(remote)remote.userData.gun.rotation.x=-.2;
 }
 if(m.type==='operatorAbilityResult'){
  operatorAbilityPending=false;
  if(!m.ok){if(m.cooldownMs>0)operatorAbilityReadyAt=performance.now()+m.cooldownMs;toast(m.message||'ABILITY UNAVAILABLE');updateOperatorAbilityHud();return;}
  operatorAbilityReadyAt=performance.now()+(m.cooldownMs||30000);
  if(m.ability==='overdrive')operatorBoostUntil=performance.now()+(m.durationMs||4500);
  if(m.ability==='sensor'){reconContacts=(m.contacts||[]).map(p=>({...p,expires:performance.now()+5000}));toast('SENSOR SWEEP · '+reconContacts.length+' CONTACTS');}
  else toast(({bulwark:'BULWARK · SHIELD CHARGED',overdrive:'OVERDRIVE · SPEED BOOST',phase:'PHASE VEIL · CLOAK ACTIVE'}[m.ability])||'OPERATOR ABILITY ACTIVATED');
  updateOperatorAbilityHud();
 }
 if(m.type==='equipmentResult'){if(m.equipment==='shield'){health=Number.isFinite(m.health)?m.health:health;updateHealthHud();}toast('EQUIPMENT READY');}
 if(m.type==='equipment'){if(m.id===myId){if(m.equipment==='ammo'){weaponAmmo[weaponIndex].reserve+=40;syncAmmo();}toast(m.equipment==='recon'?'RECON PULSE DEPLOYED':'AMMO PACK DEPLOYED');}else{const p=players.find(x=>x.id===m.id);if(p)spawnImpact(new THREE.Vector3(p.x,p.y||1,p.z),m.equipment==='recon'?0x68d9ff:0x8bd7ff);}}
 if(m.type==='supportReady'){supportReady=true;document.querySelectorAll('[data-support]').forEach(b=>b.disabled=false);toast('SUPPORT ABILITY READY · 300 POINTS');}
 if(m.type==='supportStatus'){supportReady=false;document.querySelectorAll('[data-support]').forEach(b=>b.disabled=true);}
 if(m.type==='supportUsed'){players=m.players||players;const p=players.find(x=>x.id===m.id);if(p)spawnImpact(new THREE.Vector3(p.x,p.y||1,p.z),m.ability==='shield'?0x79c9ff:0x8affc1);toast(m.ability==='shield'?'TEAM SHIELD PULSE':'TEAM RECOVERY PULSE');}
 if(m.type==='hitConfirm'){
  const hitTarget=players.find(p=>p.id===m.targetId);if(hitTarget)spawnImpact(new THREE.Vector3(hitTarget.x,hitTarget.y||1,hitTarget.z),(ALL_WEAPONS.find(w=>w.id===m.weapon)||ALL_WEAPONS[0]).color);
  showHit(Boolean(m.headshot));showDamageNumber(m.damage,Boolean(m.headshot));feed(`${m.headshot?'HEADSHOT · ':''}HIT CONFIRMED · ${m.damage} DAMAGE`);
  if(m.eliminated){feed(`ELIMINATION · ${m.targetName||'OPERATOR'}`);toast('TARGET ELIMINATED');}
 }
 if(m.type==='damaged'){
  health=Number.isFinite(m.health)?m.health:health;updateHealthHud();
  feed(`${m.headshot?'HEADSHOT · ':''}${m.eliminated?'OPERATOR DOWN · REDEPLOYING':`HIT RECEIVED · ${m.damage} DAMAGE`}`);
 }
 if(m.type==='elimination'){
  if(m.source===myId){kills++;feed(`ELIMINATED ${m.targetName||'OPERATOR'}`);}
  if(m.target===myId){health=0;updateHealthHud();spectating=true;spectateTarget=(m.players||players).find(p=>p.id!==myId&&p.alive)?.id||null;feed(`ELIMINATED BY ${m.sourceName||'OPERATOR'} · SPECTATING`);document.exitPointerLock?.();}
  (m.players||[]).forEach(p=>{if(p.id!==myId)updateRemote(p);});
 }
 if(m.type==='respawned'){
  spectating=false;spectateTarget=null;
  health=Number.isFinite(m.health)?m.health:100;updateHealthHud();
  applyServerPosition(m);feed('REDEPLOYED');canvas.requestPointerLock?.();
 }
 if(m.type==='matchStart'){
  matchStarted=true;remaining=m.duration||480;
  if(!running){buildSelectedMap();createEclipse();beginMatch(false);}
  const mine=(m.players||players).find(p=>p.id===myId);if(mine)applyServerPosition(mine);
  toast('OPERATION LIVE');
 }
 if(m.type==='profileUpdate')acceptProfile(m.profile);
 if(m.type==='devResult'){
  if(m.profile)acceptProfile(m.profile);
  if(Number.isFinite(m.health)){health=m.health;updateHealthHud();}
  toast(m.message||'DEV ACTION COMPLETE');updateDevMenuStatus();
 }
 if(m.type==='matchEnd')showResults(m.results||[]);
 if(m.type==='error')toast(m.message||'Server error');
}

// Top-down tactical radar. World coordinates stay north-up; the player marker shows facing.
function drawMinimap(){
 const canvas=$('minimap-canvas');if(!canvas)return;
 const ctx=canvas.getContext('2d');if(!ctx)return;
 const size=canvas.width, pad=10, span=selectedMap==='sublevel'?50:100, half=span/2, scale=(size-pad*2)/span;
 const px=x=>pad+(x+half)*scale, py=z=>pad+(z+half)*scale;
 ctx.clearRect(0,0,size,size);
 ctx.fillStyle='rgba(5,12,19,.91)';ctx.fillRect(0,0,size,size);
 ctx.strokeStyle='rgba(188,205,218,.12)';ctx.lineWidth=1;
 for(let v=selectedMap==='sublevel'?-20:-40;v<=(selectedMap==='sublevel'?20:40);v+=selectedMap==='sublevel'?10:20){ctx.beginPath();ctx.moveTo(px(v),pad);ctx.lineTo(px(v),size-pad);ctx.stroke();ctx.beginPath();ctx.moveTo(pad,py(v));ctx.lineTo(size-pad,py(v));ctx.stroke();}
 // Map perimeter: movement is blocked just inside this line.
 ctx.strokeStyle='rgba(230,168,91,.9)';ctx.lineWidth=2;const mapEdge=selectedMap==='sublevel'?23.8:47.8;ctx.strokeRect(px(-mapEdge),py(-mapEdge),mapEdge*2*scale,mapEdge*2*scale);
 // A few orientation/road references keep the radar readable without clutter.
 ctx.strokeStyle='rgba(160,177,190,.18)';ctx.lineWidth=4;
 ctx.beginPath();ctx.moveTo(px(-7.5),py(-mapEdge));ctx.lineTo(px(-7.5),py(mapEdge));ctx.stroke();
 ctx.beginPath();ctx.moveTo(px(-mapEdge),py(-7));ctx.lineTo(px(mapEdge),py(-7));ctx.stroke();
 if(selectedMap==='sublevel'){
  ctx.strokeStyle='rgba(160,190,204,.34)';ctx.lineWidth=3.2;
  const gaps=[-16,0,16],halfGap=2.35,edge=24.35;
  for(const x of [-9.5,9.5]){let cursor=-edge;for(const center of gaps){ctx.beginPath();ctx.moveTo(px(x),py(cursor));ctx.lineTo(px(x),py(center-halfGap));ctx.stroke();cursor=center+halfGap;}ctx.beginPath();ctx.moveTo(px(x),py(cursor));ctx.lineTo(px(x),py(edge));ctx.stroke();}
  for(const z of [-9.5,9.5]){let cursor=-edge;for(const center of gaps){ctx.beginPath();ctx.moveTo(px(cursor),py(z));ctx.lineTo(px(center-halfGap),py(z));ctx.stroke();cursor=center+halfGap;}ctx.beginPath();ctx.moveTo(px(cursor),py(z));ctx.lineTo(px(edge),py(z));ctx.stroke();}
 }
 // Teammates are cyan; opponents are red. Training has no network contacts.
 for(const p of players){
  if(p.id===myId||p.alive===false||p.cloaked)continue;
  const friendly=selectedMode!=='ffa'&&p.team===teamId;
  const x=px(THREE.MathUtils.clamp(Number(p.x)||0,-49,49));
  const y=py(THREE.MathUtils.clamp(Number(p.z)||0,-49,49));
  ctx.beginPath();ctx.arc(x,y,friendly?4.1:4.6,0,Math.PI*2);
  ctx.fillStyle=friendly?'#69d5e8':'#ff5656';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=8;ctx.fill();ctx.shadowBlur=0;
 }
 reconContacts=reconContacts.filter(contact=>contact.expires>performance.now());
 for(const contact of reconContacts){const cx=px(THREE.MathUtils.clamp(Number(contact.x)||0,-49,49)),cy=py(THREE.MathUtils.clamp(Number(contact.z)||0,-49,49));ctx.beginPath();ctx.arc(cx,cy,7,0,Math.PI*2);ctx.strokeStyle='rgba(255,190,100,.9)';ctx.lineWidth=1.5;ctx.shadowColor='#ffbd65';ctx.shadowBlur=10;ctx.stroke();ctx.shadowBlur=0;}
 const x=px(player.pos.x),y=py(player.pos.z),a=player.yaw;
 ctx.save();ctx.translate(x,y);ctx.rotate(-a);
 ctx.fillStyle='#f5c27d';ctx.strokeStyle='#fff0d8';ctx.lineWidth=1.2;ctx.shadowColor='#f5c27d';ctx.shadowBlur=8;
 ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(5.5,6);ctx.lineTo(0,3.5);ctx.lineTo(-5.5,6);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
 ctx.fillStyle='rgba(226,235,241,.7)';ctx.font='bold 8px Inter,Arial';ctx.fillText('N',size/2-3,9);
}

const CROSSHAIR_STYLES=['standard','red','dot','green','amber'];
function setOperator(operator,save=true){const requested=OPERATOR_PRESETS[operator]?operator:'vanguard';selectedOperator=(OPERATOR_UNLOCK_LEVEL[requested]||99)<=(playerProfile.level||1)?requested:'vanguard';document.querySelectorAll('[data-operator]').forEach(b=>b.classList.toggle('selected',b.dataset.operator===selectedOperator));if(save){try{localStorage.setItem('eclipse-operator',selectedOperator);}catch{}}}
function setCrosshair(style,save=true){
 const chosen=CROSSHAIR_STYLES.includes(style)?style:'standard';
 const sight=$('game-crosshair');if(sight)sight.dataset.style=chosen;
 document.querySelectorAll('[data-crosshair]').forEach(b=>b.classList.toggle('selected',b.dataset.crosshair===chosen));
 if(save){try{localStorage.setItem('eclipse-crosshair',chosen);}catch{}}
}

function updateHealthHud(){health=Math.max(0,Math.min(100,health));$('health-fill').style.width=`${health}%`;$('health-value').textContent=String(Math.round(health));}
const OPERATOR_ABILITY_INFO={vanguard:{name:'BULWARK',detail:'Gain 40 temporary shield',key:'F'},recon:{name:'SENSOR SWEEP',detail:'Reveal nearby enemies for 5 seconds',key:'F'},assault:{name:'OVERDRIVE',detail:'Move faster for 4.5 seconds',key:'F'},phantom:{name:'PHASE VEIL',detail:'Cloak from enemy view for 4 seconds',key:'F'}};
function updateOperatorAbilityHud(){const button=$('operator-ability');if(!button)return;const info=OPERATOR_ABILITY_INFO[selectedOperator]||OPERATOR_ABILITY_INFO.vanguard;const remaining=Math.max(0,operatorAbilityReadyAt-performance.now());button.disabled=operatorAbilityPending||remaining>0;button.textContent=operatorAbilityPending?'ACTIVATING…':remaining>0?`${info.name} · ${Math.ceil(remaining/1000)}s`:`${info.key} · ${info.name}`;button.title=info.detail;}
function useOperatorAbility(){if(!running||paused||health<=0||operatorAbilityPending||performance.now()<operatorAbilityReadyAt)return;if(training){if(selectedOperator==='assault')operatorBoostUntil=performance.now()+4500;toast((OPERATOR_ABILITY_INFO[selectedOperator]||OPERATOR_ABILITY_INFO.vanguard).name+' · TRAINING TEST');operatorAbilityReadyAt=performance.now()+30000;updateOperatorAbilityHud();return;}operatorAbilityPending=true;updateOperatorAbilityHud();send('operatorAbility');}

function renderPlayers(){const list=$('player-list');if(!list)return;list.innerHTML='';players.forEach(p=>{const row=document.createElement('div');row.className='player-row';const name=document.createElement('span');name.textContent=p.name+(p.id===myId?'  (YOU)':'');if(p.id===myId)name.className='self';if(p.isBot)name.className='bot-name';const role=document.createElement('small');role.textContent=p.isBot?'BOT'+(p.team!==null&&p.team!==undefined?' · SQUAD '+(p.team+1):''):p.team!==null&&p.team!==undefined?'SQUAD '+(p.team+1):'SOLO';row.append(name,role);list.append(row);});$('lobby-count').textContent=`${players.length} / ${selectedMode==='ffa'?8:selectedMode==='duos'?8:12}`;updateTeamPanel();}
function updateTeamPanel(){const panel=$('team-panel');panel.innerHTML='';if(selectedMode==='ffa'){panel.classList.add('hidden');return;}panel.classList.remove('hidden');players.filter(p=>p.team===teamId).forEach(p=>{const el=document.createElement('div');el.className='team-member';el.textContent=(p.id===myId?'YOU':p.name);panel.append(el);});}
function spawnPulse(origin,dir,local=true,weapon=weapons[weaponIndex]){
 const mat=new THREE.MeshBasicMaterial({color:weapon.color});const geometry=weapon.id==='needler'?new THREE.IcosahedronGeometry(.13,0):['rocket','sniper'].includes(weapon.id)?new THREE.CylinderGeometry(weapon.id==='sniper'?.025:.075,weapon.id==='sniper'?.025:.11,weapon.id==='sniper'?.58:.42,8):new THREE.SphereGeometry(weapon.id==='arc'?.13:.085,10,8);
 const mesh=new THREE.Mesh(geometry,mat);if(['rocket','sniper'].includes(weapon.id))mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.clone().normalize());mesh.position.copy(origin);scene.add(mesh);projectiles.push({mesh,dir:dir.clone().normalize(),life:weapon.id==='rocket'?2.5:weapon.id==='sniper'?1.8:1.2,local,speed:weapon.speed,weapon});
}
function fire(){
 if(!running||paused||health<=0||(!pointerLocked&&!isTouchDevice)||reloading||ammo<=0)return;const w=weapons[weaponIndex],now=performance.now();if(now-lastShot<w.rate)return;lastShot=now;ammo--;weaponAmmo[weaponIndex].ammo=ammo;syncAmmo();
 const kick={pulse:.62,volt:.32,magnum:.78,arc:.95,needler:.38,rocket:1,shotgun:1,burst:.48,sniper:1}[w.id]||.6;weaponRecoil=Math.min(1,weaponRecoil+kick);playWeaponAnimation('fire',w.id==='rocket'?240:w.id==='shotgun'?210:w.id==='arc'?190:w.id==='sniper'?260:125);if(viewWeapon?.userData.muzzleFlash){const flash=viewWeapon.userData.muzzleFlash;flash.visible=true;setTimeout(()=>{flash.visible=false;},w.id==='rocket'?150:65);}
 const dir=new THREE.Vector3();camera.getWorldDirection(dir);const origin=camera.position.clone();spawnPulse(origin,dir,true,w);
 if(w.burst){for(let i=-1;i<=1;i++){const spread=dir.clone().add(new THREE.Vector3(i*.018,0,0)).normalize();spawnPulse(origin,spread,true,w);}}
 if(w.id==='shotgun'){for(let i=0;i<4;i++){const spread=dir.clone().add(new THREE.Vector3((Math.random()-.5)*.08,(Math.random()-.5)*.08,0)).normalize();spawnPulse(origin,spread,true,w);}}
 playSfx(w.id==='rocket'?'rocket':w.id==='needler'?'needler':'pulse',w.color);
 send('shot',{weapon:w.id,x:player.pos.x,y:player.pos.y,z:player.pos.z,dx:dir.x,dy:dir.y,dz:dir.z,ox:origin.x,oy:origin.y,oz:origin.z});
 if(ammo===0&&reserve>0){const firedWeaponIndex=weaponIndex;if(autoReloadTimer)clearTimeout(autoReloadTimer);autoReloadTimer=setTimeout(()=>{autoReloadTimer=null;if(running&&!paused&&weaponIndex===firedWeaponIndex&&ammo===0&&!reloading)reload();},140);}
}
function updateProjectiles(dt){
 for(let i=projectiles.length-1;i>=0;i--){const p=projectiles[i],step=(p.speed||34)*dt;raycaster.set(p.mesh.position,p.dir);raycaster.far=step+.15;const hits=raycaster.intersectObjects(mapObjects,true);let impacted=hits.length>0&&hits[0].distance<=step+.12;let impactPoint=null;
 if(training&&!impacted){const targetHits=raycaster.intersectObjects(trainingTargetMeshes,false);if(targetHits.length&&targetHits[0].distance<=step+.12&&(!hits.length||targetHits[0].distance<hits[0].distance)){const hit=targetHits[0],target=hit.object.userData.target;impactPoint=hit.point.clone();impacted=true;if(target&&target.group.visible){const headshot=hit.object===target.meshes[1];target.group.visible=false;target.respawn=1.15;trainingHits++;$('objective-hint').textContent='TARGETS HIT '+trainingHits+'  ·  TEST WEAPONS & LOADOUTS';showHit(headshot);showDamageNumber('TARGET',headshot);}}}
 p.mesh.position.addScaledVector(p.dir,step);if(impactPoint)p.mesh.position.copy(impactPoint);p.life-=dt;
 if(p.local&&!impacted){for(const [id,g] of remotePlayers){const target=new THREE.Vector3(g.position.x,1.05,g.position.z);if(target.distanceTo(p.mesh.position)<(p.weapon?.explosive?1.2:.75)){impacted=true;break;}}}
 if(impacted||p.life<=0){spawnImpact(p.mesh.position,p.weapon?.color||0xffc16e);if(p.weapon?.explosive){const flash=new THREE.PointLight(p.weapon.color,2.4,7);flash.position.copy(p.mesh.position);scene.add(flash);setTimeout(()=>scene.remove(flash),110);}scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();projectiles.splice(i,1);}
 }
}

function createTrainingTargets(){
 for(const target of trainingTargets){scene.remove(target.group);target.group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});}
 trainingTargets.length=0;trainingTargetMeshes.length=0;trainingHits=0;
 const plateMat=new THREE.MeshStandardMaterial({color:0x263943,metalness:.72,roughness:.3});
 const bodyMat=new THREE.MeshStandardMaterial({color:0xb7c5c8,metalness:.48,roughness:.35,emissive:0x1a3338});
 const headMat=new THREE.MeshStandardMaterial({color:0xd8e1df,metalness:.38,roughness:.32});
 const accentMat=new THREE.MeshStandardMaterial({color:0xdca65d,emissive:0x4a2b0d,emissiveIntensity:.55,metalness:.45,roughness:.32});
 const standMat=new THREE.MeshStandardMaterial({color:0x344650,metalness:.72,roughness:.42});
 // Three lanes of reusable, stationary range dummies in the clear central approach.
 const targetRows=selectedMap==='sublevel'?[-13,-17,-21]:[-22,-31,-40];const targetColumns=selectedMap==='sublevel'?[-5,0,5]:[-8,0,8];
 for(const z of targetRows)for(const x of targetColumns){
  const group=new THREE.Group();group.position.set(x,0,z);scene.add(group);
  const stand=new THREE.Mesh(new THREE.CylinderGeometry(.16,.22,1.15,12),standMat);stand.position.y=.58;group.add(stand);
  const plate=new THREE.Mesh(new THREE.BoxGeometry(1.05,2.45,.16),plateMat);plate.position.set(0,1.5,-.13);group.add(plate);
  const torso=new THREE.Mesh(new THREE.BoxGeometry(.68,1.05,.22),bodyMat);torso.position.set(0,1.48,.005);torso.userData.trainingTarget=true;group.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.28,18,14),headMat);head.position.set(0,2.22,.01);head.userData.trainingTarget=true;group.add(head);
  const chest=new THREE.Mesh(new THREE.TorusGeometry(.22,.035,8,24),accentMat);chest.position.set(0,1.58,.13);group.add(chest);
  const target={group,respawn:0,meshes:[torso,head]};torso.userData.target=target;head.userData.target=target;
  trainingTargets.push(target);trainingTargetMeshes.push(torso,head);
 }
 $('objective-hint').textContent='TARGETS HIT 0  ·  TEST WEAPONS & LOADOUTS';
}
function updateTrainingTargets(dt){
 if(!training)return;
 for(const target of trainingTargets){if(target.respawn>0){target.respawn-=dt;if(target.respawn<=0){target.group.visible=true;target.respawn=0;}}}
}

function showHit(headshot=false){const h=$('hit-marker');h.classList.toggle('headshot',headshot);h.classList.add('show');setTimeout(()=>h.classList.remove('show'),headshot?230:150);}
function showDamageNumber(amount,headshot=false){const root=$('hud');if(!root)return;const el=document.createElement('div');el.className='damage-number'+(headshot?' headshot':'');el.textContent=(headshot?'HEADSHOT  ':'')+String(amount);el.style.left=(50+(Math.random()-.5)*5)+'%';el.style.top=(43+(Math.random()-.5)*4)+'%';root.append(el);setTimeout(()=>el.remove(),850);}
function reload(){const w=weapons[weaponIndex];if(reloading||ammo===w.mag||reserve<=0)return;reloading=true;const duration=weaponIndex===1?720:w.id==='rocket'?2100:w.id==='shotgun'?1450:1120;playWeaponAnimation('reload',duration);toast('RECHARGING '+w.name);reloadTimer=setTimeout(()=>{const n=Math.min(w.mag-ammo,reserve);ammo+=n;reserve-=n;weaponAmmo[weaponIndex]={ammo,reserve};syncAmmo();reloading=false;reloadTimer=null;playWeaponAnimation('switch',180);},duration);}
function respawn(){health=100;$('health-fill').style.width='100%';$('health-value').textContent='100';player.pos.set((Math.random()-.5)*12,1.7,(Math.random()-.5)*12);verticalVelocity=0;player.onGround=true;toast('REDEPLOYED');send('respawn');}
function feed(text){const f=$('feed'),el=document.createElement('div');el.textContent=text;f.prepend(el);setTimeout(()=>el.remove(),4000);}
function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2200);}
function updateDevMenuStatus(){const status=$('dev-status');if(status)status.textContent=devModeEnabled?'SERVER DEV MODE ENABLED':'LOCAL TRAINING ONLY · CONNECT TO A DEV-ENABLED SERVER FOR XP TOOLS';document.querySelectorAll('[data-dev-server]').forEach(b=>{b.disabled=!devModeEnabled;});const profile=$('dev-profile-summary');if(profile)profile.textContent='LEVEL '+(playerProfile.level||1)+' · '+(playerProfile.xp||0).toLocaleString()+' XP';}
function runDevServerAction(action,amount){if(!devModeEnabled){toast('ENABLE ECLIPSE_DEV_MODE ON YOUR SERVER');return;}send('devAction',{action,amount});}
function refillDevAmmo(){if(reloadTimer){clearTimeout(reloadTimer);reloadTimer=null;}reloading=false;weaponAmmo=weapons.map(w=>({ammo:w.mag,reserve:w.stock}));ammo=weaponAmmo[weaponIndex].ammo;reserve=weaponAmmo[weaponIndex].reserve;syncAmmo();toast('AMMO REFILLED');}
function toggleDevMenu(){const panel=$('dev-menu');if(!panel)return;const opening=!panel.classList.contains('active');if(opening){devReturnToGame=running&&!paused;if(devReturnToGame){paused=true;document.exitPointerLock?.();}panel.classList.add('active');updateDevMenuStatus();}else{panel.classList.remove('active');if(devReturnToGame&&running){paused=false;if(!isTouchDevice)canvas.requestPointerLock?.();}devReturnToGame=false;}}
function beginMatch(isTraining=false){if(reloadTimer){clearTimeout(reloadTimer);reloadTimer=null;}if(autoReloadTimer){clearTimeout(autoReloadTimer);autoReloadTimer=null;}reloading=false;training=isTraining;supportReady=false;operatorAbilityPending=false;operatorAbilityReadyAt=0;operatorBoostUntil=0;reconContacts=[];updateOperatorAbilityHud();document.querySelectorAll('[data-support]').forEach(b=>b.disabled=true);trainingHits=0;applyLoadout(false);startAmbientAudio();running=true;paused=false;kills=0;health=100;weaponIndex=0;verticalVelocity=0;player.onGround=true;weaponAmmo.forEach((a,i)=>{a.ammo=weapons[i].mag;a.reserve=weapons[i].stock;});syncAmmo();buildViewWeapon();remaining=480;matchStarted=false;$('menu').classList.remove('active');$('lobby').classList.remove('active');$('pause').classList.remove('active');$('results').classList.remove('active');$('hud').classList.remove('hidden');$('hud-mode').textContent=training?'TRAINING RANGE':(selectedMode==='ffa'?'FREE FOR ALL':selectedMode.toUpperCase());$('hud-map').textContent=selectedMap.toUpperCase();$('ammo').textContent=ammo;$('reserve').textContent=reserve;$('health-fill').style.width='100%';$('health-value').textContent='100';$('objective-hint').textContent=training?'TARGETS HIT 0  ·  TEST WEAPONS & LOADOUTS':(selectedMode==='ffa'?'EVERY OPERATOR FOR THEMSELVES':'STAY WITH YOUR SQUAD');if(!isTouchDevice)canvas.requestPointerLock?.();}
function pauseGame(){if(!running)return;paused=true;document.exitPointerLock?.();$('pause').classList.add('active');}
function resumeGame(){paused=false;$('pause').classList.remove('active');if(!isTouchDevice)canvas.requestPointerLock?.();}
function showResults(results=[]){running=false;spectating=false;if(reloadTimer){clearTimeout(reloadTimer);reloadTimer=null;}if(autoReloadTimer){clearTimeout(autoReloadTimer);autoReloadTimer=null;}reloading=false;document.exitPointerLock?.();$('hud').classList.add('hidden');$('results').classList.add('active');const mine=results.find(p=>p.id===myId)||{};const mvp=results[0]||null;$('result-kills').textContent=mine.kills??kills;$('result-place').textContent=results.findIndex(p=>p.id===myId)+1||'—';$('result-xp').textContent=playerProfile.lastMatchXP||0;$('result-assists').textContent=mine.assists||0;$('result-score').textContent=mine.score||0;$('result-accuracy').textContent=(mine.accuracy||0)+'%';$('result-mvp').textContent=mvp?mvp.name:'—';const list=$('results-list');list.innerHTML='';results.forEach((p,i)=>{const row=document.createElement('div');row.className='results-row';row.innerHTML=`<span>${i===0?'★ MVP · ':''}${i+1}. ${escapeHtml(p.name)} <small>${p.kills||0} K · ${p.assists||0} A · ${p.accuracy||0}% ACC</small></span><b>${p.score||0}</b>`;list.append(row);});}
function updateSpectatorCamera(){if(!spectating||!running)return;let target=players.find(p=>p.id===spectateTarget&&p.alive);if(!target){target=players.find(p=>p.id!==myId&&p.alive);spectateTarget=target?.id||null;}const avatar=target&&remotePlayers.get(target.id);if(!avatar)return;const pos=avatar.position;camera.position.set(pos.x+3,pos.y+2.2,pos.z+4);camera.lookAt(pos.x,pos.y+1.1,pos.z);}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function backToMenu(){running=false;paused=false;if(reloadTimer){clearTimeout(reloadTimer);reloadTimer=null;}if(autoReloadTimer){clearTimeout(autoReloadTimer);autoReloadTimer=null;}reloading=false;mouseHeld=false;isAiming=false;document.exitPointerLock?.();$('hud').classList.add('hidden');$('pause').classList.remove('active');$('results').classList.remove('active');$('lobby').classList.remove('active');$('menu').classList.add('active');if(socket){socket.close();socket=null;}for(const id of remotePlayers.keys())removeRemote(id);}
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.04);updateOperatorAbilityHud();const targetFov=isAiming?(weapons[weaponIndex]?.id==='sniper'?22:58):78;const previousFov=camera.fov;camera.fov=THREE.MathUtils.damp(camera.fov,targetFov,14,dt);if(Math.abs(camera.fov-previousFov)>.01)camera.updateProjectionMatrix();const sniperAiming=isAiming&&weapons[weaponIndex]?.id==='sniper';$('scope-overlay')?.classList.toggle('active',sniperAiming);$('hud')?.classList.toggle('sniper-aiming',sniperAiming);if(running&&!paused){movePlayer(dt);updateWeaponAnimation(dt);if(mouseHeld&&weapons[weaponIndex].automatic)fire();updateProjectiles(dt);updateRemoteModels(dt);updateSpectatorCamera();updateTrainingTargets(dt);if(!training){remaining-=dt;if(remaining<=0)remaining=0;}const mins=Math.floor(remaining/60),secs=Math.floor(remaining%60);$('timer').textContent=training?'RANGE':`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;if(!training&&performance.now()-lastMoveSend>=50){lastMoveSend=performance.now();send('move',{x:player.pos.x,y:player.pos.y,z:player.pos.z,yaw:player.yaw,pitch:player.pitch,moving:player.moving,crouching:player.crouching,weapon:weapons[weaponIndex].id});}}else {updateProjectiles(dt);updateRemoteModels(dt);}drawMinimap();updateEnvironment(dt);renderer.render(scene,camera);}

fullscreenButton?.addEventListener('click',toggleFullscreen);
document.addEventListener('fullscreenchange',syncFullscreenButton);
syncFullscreenButton();
$('mode-grid');setOperator((()=>{try{return localStorage.getItem('eclipse-operator')||'vanguard';}catch{return 'vanguard';}})(),false);document.querySelectorAll('[data-operator]').forEach(b=>b.addEventListener('click',()=>setOperator(b.dataset.operator)));setCrosshair((()=>{try{return localStorage.getItem('eclipse-crosshair')||'standard';}catch{return 'standard';}})(),false);document.querySelectorAll('[data-crosshair]').forEach(b=>b.addEventListener('click',()=>setCrosshair(b.dataset.crosshair)));document.querySelectorAll('.mode-card').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.mode-card').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');selectedMode=b.dataset.mode;}));
document.querySelectorAll('.map-choice').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.map-choice').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedMap=b.dataset.map;$('map-name').textContent=selectedMap.toUpperCase();}));
$('deploy').addEventListener('click',async()=>{const ok=await connectServer();if(!ok){toast('SERVER UNAVAILABLE — START SERVER OR USE SOLO TRAINING');return;}$('lobby-title').textContent=selectedMode==='ffa'?'FREE FOR ALL':selectedMode.toUpperCase();$('lobby-subtitle').textContent=isLocalHost?'Connected to local operation server':'Connected to online operation server';$('lobby-map').textContent=selectedMap.toUpperCase();$('lobby-mode').textContent=selectedMode.toUpperCase();$('menu').classList.remove('active');$('lobby').classList.add('active');renderPlayers();});
$('training').addEventListener('click',()=>{buildSelectedMap();createEclipse();createTrainingTargets();beginMatch(true);toast('TRAINING RANGE — TARGETS RESET AUTOMATICALLY');});
document.querySelectorAll('[data-support]').forEach(button=>button.addEventListener('click',()=>{if(!supportReady){toast('EARN 300 SUPPORT POINTS FIRST');return;}send('supportAbility',{ability:button.dataset.support});}));
 $('operator-ability')?.addEventListener('click',useOperatorAbility);
$('start-match').addEventListener('click',()=>{if(!socket||socket.readyState!==WebSocket.OPEN){toast('NOT CONNECTED TO SERVER');return;}if(players.length<2){toast('AT LEAST 2 PLAYERS REQUIRED');return;}send('startMatch');toast('REQUESTING MATCH START');});
$('back-menu').addEventListener('click',backToMenu);$('resume').addEventListener('click',resumeGame);$('leave-match').addEventListener('click',backToMenu);$('return-menu').addEventListener('click',backToMenu);
canvas.addEventListener('click',()=>{if(!isTouchDevice&&running&&!paused&&!pointerLocked)canvas.requestPointerLock?.();});document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===canvas;if(!pointerLocked){isAiming=false;mouseHeld=false;}});document.addEventListener('mousemove',e=>{if(!pointerLocked||!running||paused)return;const sensitivity=isAiming&&weapons[weaponIndex]?.id==='sniper'?.00085:isAiming?.00135:.0021;player.yaw-=e.movementX*sensitivity;player.pitch-=e.movementY*sensitivity;player.pitch=THREE.MathUtils.clamp(player.pitch,-1.35,1.35);updateCamera();});canvas.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('mousedown',e=>{if(e.button===2){if(running&&!paused&&pointerLocked)isAiming=true;}else if(e.button===0){mouseHeld=true;fire();}});
document.addEventListener('mouseup',e=>{if(e.button===0)mouseHeld=false;if(e.button===2)isAiming=false;});
if(isTouchDevice){
 const stick=$('mobile-stick'),knob=$('mobile-stick-knob');let stickPointer=null;
 const resetStick=()=>{keys.KeyW=keys.KeyA=keys.KeyS=keys.KeyD=false;if(knob)knob.style.transform='translate(0,0)';};
 const updateStick=e=>{const r=stick.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=e.clientX-cx,dy=e.clientY-cy,max=r.width*.34,len=Math.hypot(dx,dy),scale=len>max?max/len:1,x=dx*scale,y=dy*scale;if(knob)knob.style.transform='translate('+x+'px,'+y+'px)';const nx=x/max,ny=y/max,dead=.22;keys.KeyW=ny< -dead;keys.KeyS=ny>dead;keys.KeyA=nx< -dead;keys.KeyD=nx>dead;};
 stick?.addEventListener('pointerdown',e=>{e.preventDefault();stickPointer=e.pointerId;stick.setPointerCapture(e.pointerId);updateStick(e);});
 stick?.addEventListener('pointermove',e=>{if(e.pointerId===stickPointer){e.preventDefault();updateStick(e);}});
 const endStick=e=>{if(e.pointerId===stickPointer){stickPointer=null;resetStick();}};
 stick?.addEventListener('pointerup',endStick);stick?.addEventListener('pointercancel',endStick);
 canvas.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'||!running||paused)return;mobileLookPointer=e.pointerId;mobileLookX=e.clientX;mobileLookY=e.clientY;canvas.setPointerCapture(e.pointerId);e.preventDefault();});
 canvas.addEventListener('pointermove',e=>{if(e.pointerId!==mobileLookPointer||!running||paused)return;const dx=e.clientX-mobileLookX,dy=e.clientY-mobileLookY;mobileLookX=e.clientX;mobileLookY=e.clientY;const sensitivity=isAiming?.0021:.0042;player.yaw-=dx*sensitivity;player.pitch=THREE.MathUtils.clamp(player.pitch-dy*sensitivity,-1.35,1.35);updateCamera();e.preventDefault();});
 const endLook=e=>{if(e.pointerId===mobileLookPointer)mobileLookPointer=null;};canvas.addEventListener('pointerup',endLook);canvas.addEventListener('pointercancel',endLook);
 document.querySelectorAll('[data-mobile-action]').forEach(btn=>{
  const action=btn.dataset.mobileAction;
  btn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();if(!running||paused&&action!=='pause')return;btn.setPointerCapture(e.pointerId);
   if(action==='fire'){mouseHeld=true;fire();}
   if(action==='aim'){mobileAim=true;isAiming=true;btn.classList.add('active');}
   if(action==='jump'&&(player.onGround||performance.now()-lastGroundedAt<120)){slideUntil=0;verticalVelocity=7.2;player.onGround=false;}
   if(action==='crouch'){keys.ControlLeft=true;keys.KeyC=true;}
   if(action==='sprint')keys.ShiftLeft=true;
   if(action==='reload')reload();
   if(action==='switch')switchWeapon(weaponIndex===0?1:0);
   if(action==='equipment')useEquipment();
   if(action==='ability')useOperatorAbility();
   if(action==='pause')pauseGame();
  });
  const release=e=>{e.preventDefault();if(action==='fire')mouseHeld=false;if(action==='aim'){mobileAim=false;isAiming=false;btn.classList.remove('active');}if(action==='crouch'){keys.ControlLeft=false;keys.KeyC=false;}if(action==='sprint')keys.ShiftLeft=false;};
  btn.addEventListener('pointerup',release);btn.addEventListener('pointercancel',release);btn.addEventListener('lostpointercapture',release);
 });
}
document.addEventListener('keydown',e=>{keys[e.code]=true;if((e.code==='F2'||e.code==='Backquote')&&!e.repeat){e.preventDefault();toggleDevMenu();return;}if(e.code==='Escape'&&$('dev-menu')?.classList.contains('active')){toggleDevMenu();return;}if(e.code==='Escape'&&running){if(paused)resumeGame();else pauseGame();}if(e.code==='KeyR')reload();if(e.code==='Digit1')switchWeapon(0);if(e.code==='Digit2')switchWeapon(1);if(e.code==='Digit3')switchWeapon(0);if(e.code==='KeyQ')useEquipment();if(e.code==='KeyF'&&!e.repeat)useOperatorAbility();if(e.code==='KeyV'&&!e.repeat&&running&&!paused&&!reloading)playWeaponAnimation('inspect',780);if(e.code==='Space'&&running&&!paused&&(player.onGround||performance.now()-lastGroundedAt<120)){e.preventDefault();slideUntil=0;verticalVelocity=7.2;player.onGround=false;}});document.addEventListener('keyup',e=>keys[e.code]=false);window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
initLoadout();refreshProgressionUI();buildDistrict();createEclipse();animate();
$('open-armory')?.addEventListener('click',()=>{$('armory').classList.add('active');refreshProgressionUI();updateArmoryPreview();});
$('close-armory')?.addEventListener('click',()=>{$('armory').classList.remove('active');});
$('armory-weapon')?.addEventListener('change',()=>{const b=getWeaponBuild($('armory-weapon').value);$('build-name').value=b.name||'FIELD STANDARD';updateArmoryAttachments();updateArmoryPreview();});
for(const id of ['part-ammoType','part-barrel','part-magazine','part-stock','part-underbarrel','part-camo'])$(id)?.addEventListener('change',updateArmoryPreview);
$('save-build')?.addEventListener('click',saveArmoryBuild);
$('dev-close')?.addEventListener('click',toggleDevMenu);
$('dev-xp-500')?.addEventListener('click',()=>runDevServerAction('grantXp',500));
$('dev-xp-5000')?.addEventListener('click',()=>runDevServerAction('grantXp',5000));
$('dev-max-level')?.addEventListener('click',()=>runDevServerAction('maxLevel'));
$('dev-max-weapons')?.addEventListener('click',()=>runDevServerAction('maxWeaponXP'));
$('dev-unlock-all')?.addEventListener('click',()=>runDevServerAction('unlockAll'));
$('dev-reset-profile')?.addEventListener('click',()=>{if(confirm('Reset this operator profile, including XP, unlocks, stats and match history?'))runDevServerAction('resetProfile');});
$('dev-heal')?.addEventListener('click',()=>{if(training){health=100;updateHealthHud();toast('HEALTH RESTORED');}else runDevServerAction('heal');});
$('dev-refill')?.addEventListener('click',refillDevAmmo);
$('dev-reset-targets')?.addEventListener('click',()=>{if(!training){toast('TARGET RESET IS AVAILABLE IN TRAINING RANGE');return;}createTrainingTargets();toast('TRAINING TARGETS RESET');});
$('dev-respawn')?.addEventListener('click',()=>{if(training){respawn();}else runDevServerAction('respawn');});
updateDevMenuStatus();
