import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
const moonLight = new THREE.DirectionalLight(0xffd4a1, 2.1); moonLight.position.set(-35, 55, -20); moonLight.castShadow = true; moonLight.shadow.mapSize.set(1024,1024); moonLight.shadow.camera.left=-65;moonLight.shadow.camera.right=65;moonLight.shadow.camera.top=65;moonLight.shadow.camera.bottom=-65; scene.add(moonLight);
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
let colliders=[]; let mapObjects=[]; let remotePlayers=new Map(); let projectiles=[]; let selectedMode='ffa'; let selectedMap='district';
let running=false, training=false, paused=false, matchEnd=0, remaining=480, kills=0, health=100, ammo=24, reserve=96, reloading=false;
const weapons=[{id:'pulse',name:'PULSE CARBINE',className:'MK.01 · BALANCED',mag:24,stock:96,rate:220,speed:36,color:0xffc16e},{id:'volt',name:'VOLT PISTOL',className:'SIDEARM · RAPID',mag:18,stock:108,rate:85,speed:42,color:0x7de4ff},{id:'arc',name:'HEAVY ARC RIFLE',className:'MARKSMAN · POWER',mag:10,stock:50,rate:390,speed:52,color:0xff8a65}];
let weaponIndex=0; const weaponAmmo=weapons.map(w=>({ammo:w.mag,reserve:w.stock})); let viewWeapon=null, weaponRecoil=0, moveBob=0, verticalVelocity=0, reloadTimer=null, mouseHeld=false;
let socket=null, myId=null, players=[], teamId=null, matchStarted=false, lastShot=0, toastTimer=null;
const player={pos:new THREE.Vector3(0,1.7,7),vel:new THREE.Vector3(),yaw:0,pitch:0,onGround:true,speed:5.2};
const ramps=[];
const keys={}; let pointerLocked=false; const raycaster=new THREE.Raycaster();
const isLocalHost=['localhost','127.0.0.1'].includes(location.hostname);
const autoServerUrl=()=>isLocalHost?`ws://${location.hostname}:3001`:`${location.protocol==='https:'?'wss':'ws'}://${location.host}`;
$('server-url').value=autoServerUrl();

function box(x,y,z,sx,sy,sz,mat,solid=true){const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);mapObjects.push(m);if(solid)colliders.push(new THREE.Box3().setFromObject(m));return m;}
function clearMap(){for(const o of mapObjects)scene.remove(o);mapObjects=[];colliders=[];ramps.length=0;}
function detailBox(x,y,z,sx,sy,sz,mat){return box(x,y,z,sx,sy,sz,mat,false);}
function makeRamp(x,z,width=5,length=8,rise=2.2,rotation=0){
 const verts=[-width/2,0,length/2, width/2,0,length/2, -width/2,rise,-length/2, width/2,rise,-length/2];
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex([0,1,2,1,3,2]);geo.computeVertexNormals();
 const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x59636b,roughness:.88,metalness:.12,side:THREE.DoubleSide}));mesh.position.set(x,.04,z);mesh.rotation.y=rotation;mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);mapObjects.push(mesh);
 // Raised side lips make the ramp read clearly without blocking its walkable surface.
 for(const side of [-1,1]){const rail=detailBox(x+Math.cos(rotation)*side*(width/2),rise/2,z-Math.sin(rotation)*side*(width/2),.16,rise,length,new THREE.MeshStandardMaterial({color:0x343d44,roughness:.85}));rail.rotation.y=rotation;}
 ramps.push({x,z,width,length,rise,rotation});
}
function rampFloorHeight(x,z){let height=0;for(const r of ramps){const dx=x-r.x,dz=z-r.z;const lx=dx*Math.cos(r.rotation)-dz*Math.sin(r.rotation);const lz=dx*Math.sin(r.rotation)+dz*Math.cos(r.rotation);if(Math.abs(lx)<=r.width/2&&Math.abs(lz)<=r.length/2){const h=r.rise*((r.length/2-lz)/r.length);height=Math.max(height,h);}}return height;}
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
function makeIndustrialLight(x,y,z){
 detailBox(x,y,z,.28,.12,.28,materials.dark);
 const glow=new THREE.PointLight(0xe5b77e,1.15,13,2);glow.position.set(x,y-.18,z);scene.add(glow);mapObjects.push(glow);
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
function buildDistrict(){
 clearMap();scene.background.set(0x121b27);scene.fog.color.set(0x1a2633);scene.fog.density=.012;
 box(0,-.18,0,100,.3,100,materials.ground,false);
 box(0,-.06,0,15,.12,90,materials.asphalt,false);box(0,-.055,0,90,.11,14,materials.asphalt,false);
 for(let i=-40;i<=40;i+=5){box(i,.012,0,.08,.015,88,materials.trim,false);box(0,.012,i,88,.015,.08,materials.trim,false);}
 const blocks=[[-18,-18,17,16,13],[0,-20,15,17,18],[18,-18,17,16,15],[-19,18,17,17,17],[0,20,15,16,12],[19,18,17,17,20],[-33,-2,11,15,11],[33,1,11,15,12]];
 blocks.forEach((b,i)=>makeBuilding(...b,i));
 for(let i=0;i<18;i++){const x=(i%6-2.5)*5.4,z=(Math.floor(i/6)-1)*7.2;makeCrate(x,z,.75+(i%3)*.15);}
 // More broken sightlines: kiosks, dumpsters, low walls and tucked-away cover pockets.
 for(const [x,z] of [[-7,-11],[7,11],[-11,7],[11,-7],[-25,0],[25,0],[-7,25],[7,-25]])addCoverCluster(x,z);
 for(const [x,z] of [[-12,-5],[12,5],[-5,12],[5,-12]]){box(x,.48,z,2.8,.96,.42,materials.concrete);detailBox(x,.99,z,2.7,.08,.38,materials.trim);}
 // Short access ramps connect the street to raised loading platforms and roof-adjacent walkways.
 makeRamp(-10,2,4.8,7,1.9,0);makeRamp(10,-2,4.8,7,1.9,Math.PI);makeRamp(0,-6,5,7,1.7,Math.PI/2);
 for(const p of [[-9,-9],[-9,9],[9,-9],[9,9],[-35,-18],[35,18]])makeStreetLamp(...p);
 addRoadMarkings();
 // Pavement edges, planted courtyards, trees and street furniture add scale to the district.
 for(const side of [-1,1]){detailBox(side*9,.12,0,1.1,.24,88,materials.concrete);detailBox(0,.12,side*9,88,.24,1.1,materials.concrete);}
 for(const [x,z] of [[-34,-34],[34,-34],[-34,34],[34,34],[-17,-34],[17,34]]){
  box(x,.28,z,3.8,.56,2.6,materials.dark);detailBox(x,.58,z,3.65,.08,2.45,materials.trim);makeTree(x,z,1.05);
 }
 for(const [x,z] of [[-13,-4],[13,4],[-4,13],[4,-13],[-34,8],[34,-8]])makeStreetFurniture(x,z);
 for(let i=0;i<12;i++){const x=-42+(i*17)%84,z=-39+((i*29)%78);detailBox(x,.08,z,.18,.12,.55,materials.trim);}
 // Sheltered courtyard and small cover pieces.
 for(const [x,z] of [[-16,0],[16,0],[0,-16],[0,16]]){box(x,.7,z,3,1.4,1.2,materials.dark);box(x,.18,z,3.3,.25,1.5,materials.trim,false);}
 player.pos.set(0,1.7,7);player.yaw=Math.PI;updateCamera();
}
function buildIndustrial(){
 clearMap();scene.background.set(0x141a20);scene.fog.color.set(0x202a31);scene.fog.density=.009;
 box(0,-.18,0,110,.3,110,materials.ground,false);
 box(0,-.06,0,18,.12,100,materials.asphalt,false);box(0,-.05,0,100,.1,15,materials.asphalt,false);
 // warehouse shells and roof volumes; open bays are represented by broad corridors between structures
 makeBuilding(-21,-22,25,26,12);makeBuilding(21,-22,25,24,14);makeBuilding(-21,22,25,24,13);makeBuilding(21,22,25,25,11);
 for(let i=-3;i<=3;i++){box(i*4,2.5,0,2.7,5,2.7,materials.dark);box(i*4,5.1,0,3,.18,3,materials.trim,false);}
 for(let i=0;i<14;i++){const x=(i%7-3)*4.8,z=(Math.floor(i/7)-.5)*11;makeCrate(x,z,1.1);}
 for(const [x,z] of [[-8,-8],[8,8],[-13,9],[13,-9],[-30,0],[30,0]])addCoverCluster(x,z);
 makeRamp(-8,0,5,8,2.4,0);makeRamp(8,0,5,8,2.4,Math.PI);makeRamp(0,-13,5,8,2.1,Math.PI/2);
 for(let i=-2;i<=2;i++){box(i*5,4,-17,.18,8,23,materials.trim);box(i*5,8,-17,5,.18,23,materials.dark,false);}
 for(const p of [[-8,-8],[8,8],[-38,0],[38,0],[0,38]])makeStreetLamp(...p);
 // Overhead warehouse lighting, loading-bay details and painted safety markings.
 for(const [x,z] of [[-27,-25],[26,-26],[-28,27],[28,27]]){
  for(let lx=-1;lx<=1;lx++)makeIndustrialLight(x+lx*6,8,z);
  for(let side=-1;side<=1;side+=2){
   detailBox(x+side*11.7,.9,z+13.25,.12,1.8,3.2,materials.trim);
   for(let k=0;k<5;k++)detailBox(x+side*11.7,.18+k*.3,z+11.7+k*.58,.16,.12,.42,materials.amber);
  }
  detailBox(x,.22,z+13.35,7,.44,.12,materials.dark);
  detailBox(x,1.95,z+13.35,7,.12,.12,materials.trim);
 }
 for(let i=0;i<9;i++){const x=-36+i*9,z=(i%2?18:-18);
  box(x,.65,z,2.2,1.3,1.6,materials.crate);
  for(let k=0;k<4;k++)detailBox(x-1.05+k*.7,1.32,z,.055,.08,1.55,materials.trim);
 }
 // Cable trays and ventilation stacks.
 for(let x=-36;x<=36;x+=12){detailBox(x,5.6,0,.22,.22,68,materials.dark);detailBox(x,5.74,0,.3,.05,68,materials.trim);}
 for(const [x,z] of [[-42,-42],[42,-42],[-42,42],[42,42]]){
  box(x,.42,z,2.6,.84,2.6,materials.dark);
  for(let k=0;k<4;k++)detailBox(x-1+k*.65,.88,z,.035,.05,2.35,materials.trim);
 }
 player.pos.set(0,1.7,8);player.yaw=Math.PI;updateCamera();
}
function createEclipse(){
 const sun=new THREE.Mesh(new THREE.SphereGeometry(5,32,32),new THREE.MeshBasicMaterial({color:0x080b11}));sun.position.set(-35,42,-78);scene.add(sun);mapObjects.push(sun);
 const halo=new THREE.Mesh(new THREE.TorusGeometry(5.8,.16,10,96),new THREE.MeshBasicMaterial({color:0xe0a66b,transparent:true,opacity:.9}));halo.position.copy(sun.position);halo.lookAt(0,0,0);scene.add(halo);mapObjects.push(halo);
 const corona=new THREE.Mesh(new THREE.SphereGeometry(6.7,32,32),new THREE.MeshBasicMaterial({color:0x9a5932,transparent:true,opacity:.10,side:THREE.BackSide}));corona.position.copy(sun.position);scene.add(corona);mapObjects.push(corona);
 const stars=new THREE.Group();for(let i=0;i<180;i++){const dot=new THREE.Mesh(new THREE.SphereGeometry(.07,5,5),new THREE.MeshBasicMaterial({color:0x9eabb8,transparent:true,opacity:Math.random()*.65}));dot.position.set((Math.random()-.5)*180,15+Math.random()*65,(Math.random()-.5)*180);stars.add(dot);}scene.add(stars);mapObjects.push(stars);
}
function updateCamera(){camera.position.copy(player.pos);camera.rotation.order='YXZ';camera.rotation.y=player.yaw;camera.rotation.x=player.pitch;}
function buildViewWeapon(){
 if(viewWeapon){camera.remove(viewWeapon);viewWeapon.traverse(o=>{if(o.geometry)o.geometry.dispose();});}
 const w=weapons[weaponIndex],g=new THREE.Group();const dark=new THREE.MeshStandardMaterial({color:0x202a32,metalness:.72,roughness:.32}),body=new THREE.MeshStandardMaterial({color:weaponIndex===1?0x263b45:weaponIndex===2?0x3a2927:0x343b42,metalness:.58,roughness:.38}),glow=new THREE.MeshStandardMaterial({color:w.color,emissive:w.color,emissiveIntensity:1.1,metalness:.2,roughness:.25});
 const add=(geo,mat,x,y,z)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;g.add(m);return m;};
 add(new THREE.BoxGeometry(.22,.18,.48),body,0,0,0);add(new THREE.BoxGeometry(.13,.12,.27),dark,0,.015,-.31);add(new THREE.CylinderGeometry(.035,.045,.36,10),dark,0,.02,-.48).rotation.x=Math.PI/2;add(new THREE.BoxGeometry(.1,.2,.16),dark,0,-.16,.08);add(new THREE.BoxGeometry(.045,.035,.24),glow,0,.105,-.05);add(new THREE.BoxGeometry(.08,.035,.09),dark,0,.12,-.22);
 const handMat=new THREE.MeshStandardMaterial({color:0x34383c,roughness:.9});add(new THREE.BoxGeometry(.13,.22,.16),handMat,-.13,-.12,.12);
 g.position.set(.43,-.34,-.72);g.rotation.set(-.04,-.08,0);camera.add(g);viewWeapon=g;
 $('weapon-name').textContent=w.name;$('weapon-class').textContent=w.className;syncAmmo();
}
function syncAmmo(){const a=weaponAmmo[weaponIndex];ammo=a.ammo;reserve=a.reserve;$('ammo').textContent=ammo;$('reserve').textContent=reserve;}
function switchWeapon(index){if(index<0||index>=weapons.length||index===weaponIndex)return;if(reloadTimer){clearTimeout(reloadTimer);reloadTimer=null;}weaponAmmo[weaponIndex].ammo=ammo;weaponAmmo[weaponIndex].reserve=reserve;weaponIndex=index;reloading=false;buildViewWeapon();toast(weapons[index].name);}

function collides(pos){const pbox=new THREE.Box3(new THREE.Vector3(pos.x-.32,pos.y-1.55,pos.z-.32),new THREE.Vector3(pos.x+.32,pos.y+.05,pos.z+.32));return colliders.some(b=>b.intersectsBox(pbox));}
function movePlayer(dt){
 const forward=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw)),right=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));let dir=new THREE.Vector3();if(keys.KeyW)dir.add(forward);if(keys.KeyS)dir.sub(forward);if(keys.KeyD)dir.add(right);if(keys.KeyA)dir.sub(right);if(dir.lengthSq())dir.normalize();
 const speed=keys.ShiftLeft?7.3:keys.ControlLeft?2.7:5.2;player.vel.x=THREE.MathUtils.damp(player.vel.x,dir.x*speed,12,dt);player.vel.z=THREE.MathUtils.damp(player.vel.z,dir.z*speed,12,dt);
 const next=player.pos.clone();next.x+=player.vel.x*dt;if(!collides(next))player.pos.x=next.x;next.copy(player.pos);next.z+=player.vel.z*dt;if(!collides(next))player.pos.z=next.z;
 const floor=rampFloorHeight(player.pos.x,player.pos.z)+(keys.ControlLeft?1.15:1.7);verticalVelocity-=19*dt;player.pos.y+=verticalVelocity*dt;if(player.pos.y<=floor){player.pos.y=floor;verticalVelocity=0;player.onGround=true;}else player.onGround=false;
 if(viewWeapon){const moving=dir.lengthSq()>.01;moveBob=THREE.MathUtils.damp(moveBob,moving?1:0,8,dt);viewWeapon.position.y=-.34+Math.sin(performance.now()*.009)*.012*moveBob;viewWeapon.position.x=.43+Math.cos(performance.now()*.006)*.009*moveBob;weaponRecoil=Math.max(0,weaponRecoil-dt*4.5);viewWeapon.position.z=-.72+weaponRecoil*.09;viewWeapon.rotation.x=-.04-weaponRecoil*.13;}
 updateCamera();
}
function makeRemote(id){const group=new THREE.Group();const suit=new THREE.Mesh(new THREE.CapsuleGeometry(.38,.95,4,8),new THREE.MeshStandardMaterial({color:0x71828b,roughness:.8}));suit.position.y=.95;suit.castShadow=true;group.add(suit);const visor=new THREE.Mesh(new THREE.BoxGeometry(.34,.15,.12),new THREE.MeshStandardMaterial({color:0xd5a56a,emissive:0x39200b}));visor.position.set(0,1.55,-.18);group.add(visor);scene.add(group);remotePlayers.set(id,group);return group;}
function updateRemote(data){let g=remotePlayers.get(data.id)||makeRemote(data.id);g.position.set(data.x,0,data.z);g.rotation.y=data.yaw||0;g.userData.team=data.team;}
function removeRemote(id){const g=remotePlayers.get(id);if(g){scene.remove(g);remotePlayers.delete(id);}}
function send(type,payload={}){if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type,...payload}));}
function connectServer(){return new Promise((resolve)=>{let url=$('server-url').value.trim()||autoServerUrl();try{socket=new WebSocket(url);}catch{resolve(false);return;}let done=false;const timeout=setTimeout(()=>{if(!done){done=true;resolve(false);}},1800);socket.onopen=()=>{clearTimeout(timeout);done=true;$('server-dot').parentElement.classList.add('connected');$('server-label').textContent='CONNECTED';send('join',{mode:selectedMode,map:selectedMap,name:'ECLIPSE-'+Math.floor(10+Math.random()*89)});resolve(true);};socket.onmessage=(ev)=>{let m;try{m=JSON.parse(ev.data);}catch{return;}handleNetwork(m);};socket.onclose=()=>{$('server-dot').parentElement.classList.remove('connected');$('server-label').textContent='OFFLINE / LOCAL';if(running&&!training)toast('Connection lost. Returning to local training.');};socket.onerror=()=>{};});}
function handleNetwork(m){if(m.type==='welcome'){myId=m.id;teamId=m.team;players=m.players||[];renderPlayers();}if(m.type==='players'){players=m.players;renderPlayers();players.forEach(p=>{if(p.id!==myId)updateRemote(p);});const ids=new Set(players.map(p=>p.id));for(const id of remotePlayers.keys())if(!ids.has(id))removeRemote(id);}if(m.type==='state'||m.type==='scoreUpdate'){players=m.players||[];players.forEach(p=>{if(p.id!==myId)updateRemote(p);});const mine=players.find(p=>p.id===myId);if(mine)$('scoreboard-mini').innerHTML=`YOU <b>${mine.score||0}</b> <i>—</i> TOP <b>${Math.max(0,...players.map(p=>p.score||0))}</b>`;}if(m.type==='shot'){if(m.id!==myId){spawnPulse(new THREE.Vector3(m.x,1.45,m.z),new THREE.Vector3(m.dx,m.dy||0,m.dz),false,weapons.find(w=>w.id===m.weapon)||weapons[0]);}}if(m.type==='tag'){if(m.target===myId){feed('PULSE TAGGED YOU');}if(m.source===myId&&m.point){kills++;showHit();feed('CONFIRMED TAG +1');}}if(m.type==='matchStart'){matchStarted=true;remaining=m.duration||480;if(!running){if(selectedMap==='district')buildDistrict();else buildIndustrial();createEclipse();beginMatch(false);}toast('OPERATION LIVE');}if(m.type==='matchEnd')showResults(m.results||[]);if(m.type==='error')toast(m.message||'Server error');}
function renderPlayers(){const list=$('player-list');if(!list)return;list.innerHTML='';players.forEach(p=>{const row=document.createElement('div');row.className='player-row';const name=document.createElement('span');name.textContent=p.name+(p.id===myId?'  (YOU)':'');if(p.id===myId)name.className='self';const role=document.createElement('small');role.textContent=p.team!==null&&p.team!==undefined?'SQUAD '+(p.team+1):'SOLO';row.append(name,role);list.append(row);});$('lobby-count').textContent=`${players.length} / ${selectedMode==='ffa'?8:selectedMode==='duos'?8:12}`;updateTeamPanel();}
function updateTeamPanel(){const panel=$('team-panel');panel.innerHTML='';if(selectedMode==='ffa'){panel.classList.add('hidden');return;}panel.classList.remove('hidden');players.filter(p=>p.team===teamId).forEach(p=>{const el=document.createElement('div');el.className='team-member';el.textContent=(p.id===myId?'YOU':p.name);panel.append(el);});}
function spawnPulse(origin,dir,local=true,weapon=weapons[weaponIndex]){const mat=new THREE.MeshBasicMaterial({color:weapon.color});const mesh=new THREE.Mesh(new THREE.SphereGeometry(weapon.id==='arc'?.13:.085,8,8),mat);mesh.position.copy(origin);scene.add(mesh);projectiles.push({mesh,dir:dir.clone().normalize(),life:1.2,local,speed:weapon.speed});}
function fire(){if(!running||paused||!pointerLocked||reloading||ammo<=0)return;const w=weapons[weaponIndex],now=performance.now();if(now-lastShot<w.rate)return;lastShot=now;ammo--;weaponAmmo[weaponIndex].ammo=ammo;syncAmmo();weaponRecoil=Math.min(1,weaponRecoil+.75);const dir=new THREE.Vector3();camera.getWorldDirection(dir);const origin=camera.position.clone();spawnPulse(origin,dir,true,w);send('shot',{weapon:w.id,x:player.pos.x,z:player.pos.z,dx:dir.x,dy:dir.y,dz:dir.z,ox:origin.x,oy:origin.y,oz:origin.z});}
function updateProjectiles(dt){for(let i=projectiles.length-1;i>=0;i--){const p=projectiles[i];p.mesh.position.addScaledVector(p.dir,(p.speed||34)*dt);p.life-=dt;if(p.local){for(const [id,g] of remotePlayers){const target=new THREE.Vector3(g.position.x,1,g.position.z);if(target.distanceTo(p.mesh.position)<.75){p.life=0;break;}}}if(p.life<=0){scene.remove(p.mesh);projectiles.splice(i,1);}}}
function showHit(){const h=$('hit-marker');h.classList.add('show');setTimeout(()=>h.classList.remove('show'),130);}
function reload(){const w=weapons[weaponIndex];if(reloading||ammo===w.mag||reserve<=0)return;reloading=true;toast('RECHARGING '+w.name);reloadTimer=setTimeout(()=>{const n=Math.min(w.mag-ammo,reserve);ammo+=n;reserve-=n;weaponAmmo[weaponIndex]={ammo,reserve};syncAmmo();reloading=false;reloadTimer=null;},weaponIndex===1?850:weaponIndex===2?1450:1050);}
function respawn(){health=100;$('health-fill').style.width='100%';$('health-value').textContent='100';player.pos.set((Math.random()-.5)*12,1.7,(Math.random()-.5)*12);verticalVelocity=0;player.onGround=true;toast('REDEPLOYED');send('respawn');}
function feed(text){const f=$('feed'),el=document.createElement('div');el.textContent=text;f.prepend(el);setTimeout(()=>el.remove(),4000);}
function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2200);}
function beginMatch(isTraining=false){training=isTraining;running=true;paused=false;kills=0;health=100;weaponIndex=0;verticalVelocity=0;player.onGround=true;weaponAmmo.forEach((a,i)=>{a.ammo=weapons[i].mag;a.reserve=weapons[i].stock;});syncAmmo();buildViewWeapon();remaining=480;matchStarted=false;$('menu').classList.remove('active');$('lobby').classList.remove('active');$('pause').classList.remove('active');$('results').classList.remove('active');$('hud').classList.remove('hidden');$('hud-mode').textContent=selectedMode==='ffa'?'FREE FOR ALL':selectedMode.toUpperCase();$('hud-map').textContent=selectedMap.toUpperCase();$('ammo').textContent=ammo;$('reserve').textContent=reserve;$('health-fill').style.width='100%';$('health-value').textContent='100';$('objective-hint').textContent=selectedMode==='ffa'?'EVERY OPERATOR FOR THEMSELVES':'STAY WITH YOUR SQUAD';canvas.requestPointerLock?.();}
function pauseGame(){if(!running)return;paused=true;document.exitPointerLock?.();$('pause').classList.add('active');}
function resumeGame(){paused=false;$('pause').classList.remove('active');canvas.requestPointerLock?.();}
function showResults(results=[]){running=false;document.exitPointerLock?.();$('hud').classList.add('hidden');$('results').classList.add('active');$('result-kills').textContent=kills;$('result-place').textContent=results.findIndex(p=>p.id===myId)+1||'—';$('result-xp').textContent=kills*100+250;const list=$('results-list');list.innerHTML='';results.forEach((p,i)=>{const row=document.createElement('div');row.className='results-row';row.innerHTML=`<span>${i+1}. ${escapeHtml(p.name)}</span><b>${p.score||0}</b>`;list.append(row);});}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function backToMenu(){running=false;paused=false;document.exitPointerLock?.();$('hud').classList.add('hidden');$('pause').classList.remove('active');$('results').classList.remove('active');$('lobby').classList.remove('active');$('menu').classList.add('active');if(socket){socket.close();socket=null;}for(const id of remotePlayers.keys())removeRemote(id);}
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.04);if(running&&!paused){movePlayer(dt);if(mouseHeld&&weapons[weaponIndex].id==='volt')fire();updateProjectiles(dt);remaining-=dt;if(remaining<=0){remaining=0;if(training)showResults([]);else send('endMatch');}const mins=Math.floor(remaining/60),secs=Math.floor(remaining%60);$('timer').textContent=`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;if(!training){send('move',{x:player.pos.x,z:player.pos.z,yaw:player.yaw,pitch:player.pitch});}}else updateProjectiles(dt);renderer.render(scene,camera);}

$('mode-grid');document.querySelectorAll('.mode-card').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.mode-card').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');selectedMode=b.dataset.mode;}));
document.querySelectorAll('.map-choice').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.map-choice').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedMap=b.dataset.map;$('map-name').textContent=selectedMap.toUpperCase();}));
$('deploy').addEventListener('click',async()=>{const ok=await connectServer();if(!ok){toast('SERVER UNAVAILABLE — START SERVER OR USE SOLO TRAINING');return;}$('lobby-title').textContent=selectedMode==='ffa'?'FREE FOR ALL':selectedMode.toUpperCase();$('lobby-subtitle').textContent=isLocalHost?'Connected to local operation server':'Connected to online operation server';$('lobby-map').textContent=selectedMap.toUpperCase();$('lobby-mode').textContent=selectedMode.toUpperCase();$('menu').classList.remove('active');$('lobby').classList.add('active');renderPlayers();});
$('training').addEventListener('click',()=>{if(selectedMap==='district')buildDistrict();else buildIndustrial();createEclipse();beginMatch(true);toast('SOLO TRAINING — NETWORK PLAY DISABLED');});
$('start-match').addEventListener('click',()=>{if(!socket||socket.readyState!==WebSocket.OPEN){toast('NOT CONNECTED TO SERVER');return;}if(players.length<2){toast('AT LEAST 2 PLAYERS REQUIRED');return;}send('startMatch');toast('REQUESTING MATCH START');});
$('back-menu').addEventListener('click',backToMenu);$('resume').addEventListener('click',resumeGame);$('leave-match').addEventListener('click',backToMenu);$('return-menu').addEventListener('click',backToMenu);
canvas.addEventListener('click',()=>{if(running&&!paused&&!pointerLocked)canvas.requestPointerLock?.();});document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===canvas;});document.addEventListener('mousemove',e=>{if(!pointerLocked||!running||paused)return;player.yaw-=e.movementX*.0021;player.pitch-=e.movementY*.0018;player.pitch=THREE.MathUtils.clamp(player.pitch,-1.35,1.35);updateCamera();});document.addEventListener('mousedown',e=>{if(e.button===0){mouseHeld=true;fire();}});document.addEventListener('mouseup',e=>{if(e.button===0)mouseHeld=false;});document.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Escape'&&running){if(paused)resumeGame();else pauseGame();}if(e.code==='KeyR')reload();if(e.code==='Digit1')switchWeapon(0);if(e.code==='Digit2')switchWeapon(1);if(e.code==='Digit3')switchWeapon(2);if(e.code==='Space'&&running&&!paused&&player.onGround){e.preventDefault();verticalVelocity=7.2;player.onGround=false;}});document.addEventListener('keyup',e=>keys[e.code]=false);window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
buildDistrict();createEclipse();animate();
