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
const platforms=[]; let lastMoveSend=0;
let running=false, training=false, paused=false, matchEnd=0, remaining=480, kills=0, health=100, ammo=24, reserve=96, reloading=false;
const weapons=[{id:'pulse',name:'PULSE CARBINE',className:'MK.01 · BALANCED',mag:24,stock:96,rate:220,speed:36,color:0xffc16e},{id:'volt',name:'VOLT PISTOL',className:'SIDEARM · RAPID',mag:18,stock:108,rate:85,speed:42,color:0x7de4ff},{id:'arc',name:'HEAVY ARC RIFLE',className:'MARKSMAN · POWER',mag:10,stock:50,rate:390,speed:52,color:0xff8a65}];
let weaponIndex=0; const weaponAmmo=weapons.map(w=>({ammo:w.mag,reserve:w.stock})); let viewWeapon=null, weaponRecoil=0, moveBob=0, verticalVelocity=0, reloadTimer=null, mouseHeld=false;
let socket=null, myId=null, players=[], teamId=null, matchStarted=false, lastShot=0, toastTimer=null, serverSpawn=null;
const player={pos:new THREE.Vector3(0,1.7,7),vel:new THREE.Vector3(),yaw:0,pitch:0,onGround:true,speed:5.2,moving:false,crouching:false};
const ramps=[];
const keys={}; let pointerLocked=false; const raycaster=new THREE.Raycaster();
const isLocalHost=['localhost','127.0.0.1'].includes(location.hostname);
const autoServerUrl=()=>((isLocalHost||location.port==='5173')?`ws://${location.hostname}:3001`:`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);
$('server-url').value=autoServerUrl();

function box(x,y,z,sx,sy,sz,mat,solid=true){const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);mapObjects.push(m);if(solid)colliders.push(new THREE.Box3().setFromObject(m));return m;}
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
 hemi.color.set(0x9aaec5);hemi.groundColor.set(0x20232a);hemi.intensity=1.35;moonLight.color.set(0xffd4a1);moonLight.intensity=2.1;moonLight.position.set(-35,55,-20);fill.color.set(0x6382a7);fill.intensity=.45;
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
 clearMap();scene.background.set(0x111820);scene.fog.color.set(0x18232b);scene.fog.density=.011;
 hemi.color.set(0x8298a7);hemi.groundColor.set(0x171b1d);hemi.intensity=1.05;
 moonLight.color.set(0xffc78a);moonLight.intensity=2.35;moonLight.position.set(-24,42,-12);
 fill.color.set(0x668ba0);fill.intensity=.55;
 const concrete=new THREE.MeshStandardMaterial({color:0x454b4d,roughness:.97}),wetAsphalt=new THREE.MeshStandardMaterial({color:0x20292d,roughness:.32,metalness:.18});
 box(0,-.2,0,104,.35,104,concrete,false);
 box(0,-.045,0,18,.09,100,wetAsphalt,false);box(0,-.04,0,100,.08,16,wetAsphalt,false);
 // Perimeter retaining walls and chain-link security fence.
 for(const side of [-1,1]){
  box(side*50,1.15,0,.7,2.3,100,materials.dark);box(0,1.15,side*50,100,2.3,.7,materials.dark);
  for(let p=-46;p<=46;p+=4){detailBox(side*49.45,3.1,p,.09,1.9,.09,materials.trim);detailBox(p,3.1,side*49.45,.09,1.9,.09,materials.trim);}
  detailBox(side*49.45,4.05,0,.12,.12,100,materials.trim);detailBox(0,4.05,side*49.45,100,.12,.12,materials.trim);
 }
 // Four large, accessible freight halls define the perimeter without sealing the arena.
 makeWarehouse(-29,-34,29,22,11,1,'NORTH-01');
 makeWarehouse(29,-34,29,22,12,1,'NORTH-02');
 makeWarehouse(-29,34,29,22,10,-1,'SOUTH-03');
 makeWarehouse(29,34,29,22,11,-1,'SOUTH-04');
 // Central sorting yard: staggered container lanes, gaps, blind corners and low service cover.
 makeContainer(-19,-10,10,2.8,0,0x43545b);makeContainer(-19,-1,7,2.8,0,0x59605a);
 makeContainer(-19,9,10,2.8,0,0x46545e);makeContainer(19,-10,10,2.8,0,0x5b5147);
 makeContainer(19,1,7,2.8,0,0x47565b);makeContainer(19,11,10,2.8,0,0x4d5b50);
 makeContainer(-7,-23,8,2.7,Math.PI/2,0x4e565b);makeContainer(7,-23,8,2.7,Math.PI/2,0x55534b);
 makeContainer(-7,23,8,2.7,Math.PI/2,0x4c5960);makeContainer(7,23,8,2.7,Math.PI/2,0x5b5147);
 // Pallet stacks, cable drums, forklifts-as-static-props, skips and maintenance cabinets.
 for(const [x,z] of [[-12,-13],[12,-13],[-12,14],[12,14],[-31,0],[31,0]]){
  for(let k=0;k<3;k++)box(x+(k%2)*.72,.38+Math.floor(k/2)*.76,z,.68,.72,.68,materials.crate);
  box(x+2,.58,z,1.5,1.15,1.0,materials.dark);detailBox(x+2,.12,z,1.8,.16,1.2,materials.trim);
 }
 for(const [x,z] of [[-3,-12],[3,12],[-27,15],[27,-15],[-8,7],[8,-7]]){
  const drum=new THREE.Mesh(new THREE.CylinderGeometry(.65,.65,1.25,16),new THREE.MeshStandardMaterial({color:0x59656a,metalness:.55,roughness:.45}));drum.position.set(x,.65,z);drum.castShadow=true;scene.add(drum);mapObjects.push(drum);colliders.push(new THREE.Box3(new THREE.Vector3(x-.65,0,z-.65),new THREE.Vector3(x+.65,1.3,z+.65)));
  detailBox(x,1.3,z,.9,.08,.9,materials.trim);
 }
 // Two elevated maintenance catwalks with ramps at both ends. Their surfaces are walkable.
 makeWalkway(-12,-23,3.6,13,2.4,0);makeRamp(-12,-13,3.8,7,2.4,0);makeRamp(-12,-33,3.8,7,2.4,Math.PI);
 makeWalkway(12,23,3.6,13,2.4,0);makeRamp(12,20,3.8,7,2.4,Math.PI);makeRamp(12,33,3.8,7,2.4,0);
 // Cross-yard pipe bridge, support frames, insulated pipes and valve stations.
 for(const x of [-4,4]){
  for(const z of [-7,7]){box(x,2.1,z,.24,4.2,.24,materials.dark);detailBox(x,4.25,z,.42,.16,.42,materials.trim);}
  detailBox(x,4.25,0,.36,.36,34,materials.dark);
 }
 for(const z of [-2.2,0,2.2]){const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.16,.16,36,12),new THREE.MeshStandardMaterial({color:z===0?0x9b744a:0x5a686c,metalness:.7,roughness:.35}));pipe.rotation.x=Math.PI/2;pipe.position.set(0,4.05,z);scene.add(pipe);mapObjects.push(pipe);}
 // Loading-zone hazard stripes, painted lane guides, drain grates and oil-stained patches.
 for(let z=-43;z<=43;z+=6){detailBox(0,.012,z,.12,.018,2.5,materials.trim);}
 for(const x of [-8,8])for(let z=-42;z<=42;z+=8){detailBox(x,.014,z,2.8,.018,.12,materials.amber);}
 for(const [x,z] of [[-23,-20],[23,-20],[-23,20],[23,20],[0,-39],[0,39]]){
  detailBox(x,.016,z,2.1,.025,1.2,materials.dark);
  for(let k=0;k<9;k++)detailBox(x-.9+k*.22,.032,z,.035,.012,1.0,materials.trim);
 }
 for(const [x,z] of [[-42,-15],[42,15],[-42,15],[42,-15]]){
  box(x,.55,z,2.8,1.1,2.2,materials.dark);detailBox(x,.12,z,3.2,.18,2.6,materials.trim);
  for(let k=0;k<5;k++)detailBox(x-1+k*.5,1.13,z,.08,.08,2.0,materials.amber);
 }
 // High mast lamps, low amber work lights, exhaust stacks and atmospheric steam vents.
 for(const [x,z] of [[-42,-42],[42,-42],[-42,42],[42,42],[0,-44],[0,44]]){
  box(x,5,z,.18,10,.18,materials.dark);detailBox(x,9.8,z,1.4,.12,.12,materials.trim);
  const lamp=new THREE.PointLight(0xe8b77b,1.0,19,2);lamp.position.set(x,9.4,z);scene.add(lamp);mapObjects.push(lamp);
 }
 for(const [x,z] of [[-34,-10],[34,10],[-34,10],[34,-10]]){
  box(x,3,z,.7,6,.7,materials.dark);detailBox(x,6.1,z,1.2,.22,1.2,materials.trim);
  for(let k=0;k<4;k++)detailBox(x,6.3+k*.08,z,.95,.035,.95,materials.amber);
 }
 // Scattered rubble, wheel stops and small hiding pockets beside the freight halls.
 for(let i=0;i<16;i++){
  const x=-43+(i*17)%86,z=-40+((i*23)%80);
  if(Math.abs(x)<5&&Math.abs(z)<8)continue;
  detailBox(x,.09,z,.55+((i%3)*.2),.16,.35,materials.dark);
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

function collides(pos){if(Math.abs(pos.x)>47.8||Math.abs(pos.z)>47.8)return true;const pbox=new THREE.Box3(new THREE.Vector3(pos.x-.32,pos.y-1.55,pos.z-.32),new THREE.Vector3(pos.x+.32,pos.y+.05,pos.z+.32));return colliders.some(b=>b.intersectsBox(pbox));}
function movePlayer(dt){
 if(health<=0){updateCamera();return;}
 const forward=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw)),right=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));let dir=new THREE.Vector3();if(keys.KeyW)dir.add(forward);if(keys.KeyS)dir.sub(forward);if(keys.KeyD)dir.add(right);if(keys.KeyA)dir.sub(right);if(dir.lengthSq())dir.normalize();
 const speed=keys.ShiftLeft?7.3:keys.ControlLeft?2.7:5.2;player.moving=dir.lengthSq()>.01;player.crouching=Boolean(keys.ControlLeft);player.vel.x=THREE.MathUtils.damp(player.vel.x,dir.x*speed,12,dt);player.vel.z=THREE.MathUtils.damp(player.vel.z,dir.z*speed,12,dt);
 const next=player.pos.clone();next.x+=player.vel.x*dt;if(!collides(next))player.pos.x=next.x;next.copy(player.pos);next.z+=player.vel.z*dt;if(!collides(next))player.pos.z=next.z;
 const floor=rampFloorHeight(player.pos.x,player.pos.z)+(keys.ControlLeft?1.15:1.7);verticalVelocity-=19*dt;player.pos.y+=verticalVelocity*dt;if(player.pos.y<=floor){player.pos.y=floor;verticalVelocity=0;player.onGround=true;}else player.onGround=false;
 if(viewWeapon){const moving=player.moving;moveBob=THREE.MathUtils.damp(moveBob,moving?1:0,8,dt);viewWeapon.position.y=-.34+Math.sin(performance.now()*.009)*.012*moveBob;viewWeapon.position.x=.43+Math.cos(performance.now()*.006)*.009*moveBob;weaponRecoil=Math.max(0,weaponRecoil-dt*4.5);viewWeapon.position.z=-.72+weaponRecoil*.09;viewWeapon.rotation.x=-.04-weaponRecoil*.13;}
 updateCamera();
}
function makeRemote(id, data = {}) {
 const group = new THREE.Group();
 const teamColors = [0x83b9c8, 0xc79a65, 0x8eaa83, 0xb28ebd];
 const accentColor = data.team === null || data.team === undefined ? 0xc58a4d : teamColors[data.team % teamColors.length];
 const armor = new THREE.MeshStandardMaterial({ color: 0x303b43, metalness: .32, roughness: .72 });
 const fabric = new THREE.MeshStandardMaterial({ color: 0x18232b, roughness: .96 });
 const trim = new THREE.MeshStandardMaterial({ color: 0x59656b, metalness: .48, roughness: .58 });
 const accent = new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: .16, roughness: .7 });
 const visor = new THREE.MeshStandardMaterial({ color: 0x9ac0c9, metalness: .72, roughness: .2, emissive: 0x16343b, emissiveIntensity: .35 });
 const add = (parent, geometry, material, x, y, z) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
 // Feet are at y=0. Separate limb pivots allow simple replicated locomotion.
 const torso = add(group, new THREE.CapsuleGeometry(.27,.55,4,9), armor, 0,1.12,0);
 add(group,new THREE.BoxGeometry(.48,.42,.25),fabric,0,1.18,.015);
 add(group,new THREE.BoxGeometry(.38,.24,.31),armor,0,1.12,-.12);
 add(group,new THREE.BoxGeometry(.17,.23,.12),accent,0,1.2,-.285);
 add(group,new THREE.BoxGeometry(.24,.32,.24),fabric,0,1.27,.27);
 add(group,new THREE.BoxGeometry(.3,.12,.28),armor,0,1.43,.27);
 add(group,new THREE.SphereGeometry(.19,12,10),fabric,0,1.66,0);
 add(group,new THREE.SphereGeometry(.215,12,10),armor,0,1.78,.005);
 add(group,new THREE.BoxGeometry(.29,.095,.035),visor,0,1.68,-.183);
 add(group,new THREE.BoxGeometry(.26,.07,.23),accent,0,1.91,.01);
 const leftArm = new THREE.Group(); leftArm.position.set(-.34,1.35,0); group.add(leftArm);
 const rightArm = new THREE.Group(); rightArm.position.set(.34,1.35,0); group.add(rightArm);
 for (const [pivot, side] of [[leftArm,-1],[rightArm,1]]) {
  const upper=add(pivot,new THREE.CapsuleGeometry(.105,.34,3,7),armor,side*.025,-.23,-.015);upper.rotation.z=side*-.12;
  const fore=add(pivot,new THREE.CapsuleGeometry(.085,.28,3,7),fabric,side*.035,-.48,-.095);fore.rotation.z=side*-.08;
  add(pivot,new THREE.BoxGeometry(.13,.12,.14),trim,side*.035,-.65,-.13);
  add(pivot,new THREE.BoxGeometry(.19,.13,.2),accent,side*.025,-.25,-.01);
 }
 const leftLeg = new THREE.Group(); leftLeg.position.set(-.145,.73,0); group.add(leftLeg);
 const rightLeg = new THREE.Group(); rightLeg.position.set(.145,.73,0); group.add(rightLeg);
 for (const [pivot,side] of [[leftLeg,-1],[rightLeg,1]]) {
  add(pivot,new THREE.CapsuleGeometry(.125,.48,3,7),fabric,0,-.27,0);
  add(pivot,new THREE.BoxGeometry(.2,.16,.34),armor,0,-.59,-.055);
  add(pivot,new THREE.BoxGeometry(.12,.12,.07),accent,side*.035,-.1,-.12);
 }
 // A compact sidearm/carbine silhouette is held in front of the chest.
 const gun = new THREE.Group(); gun.position.set(.27,1.02,-.28); gun.rotation.x=-.08; group.add(gun);
 add(gun,new THREE.BoxGeometry(.11,.13,.42),trim,0,0,-.08);
 add(gun,new THREE.BoxGeometry(.055,.055,.22),accent,0,.055,-.12);
 add(gun,new THREE.CylinderGeometry(.025,.03,.23,8),fabric,0,0,-.36).rotation.x=Math.PI/2;
 const shadow = new THREE.Mesh(new THREE.CircleGeometry(.42,18),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.24,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.015;group.add(shadow);
 // Small floating callsign, kept subtle so it doesn't obscure the model.
 const labelCanvas=document.createElement('canvas');labelCanvas.width=256;labelCanvas.height=64;
 const ctx=labelCanvas.getContext('2d');ctx.fillStyle='rgba(5,12,18,.72)';ctx.fillRect(12,10,232,44);ctx.strokeStyle='#b78a5a';ctx.strokeRect(12,10,232,44);ctx.fillStyle='#e7edf0';ctx.font='bold 22px Arial';ctx.textAlign='center';ctx.fillText(String(data.name||'OPERATOR').slice(0,18),128,39);
 const labelTexture=new THREE.CanvasTexture(labelCanvas);const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture,transparent:true,depthTest:false}));label.scale.set(1.45,.36,1);label.position.set(0,2.25,0);group.add(label);
 group.userData={targetPosition:new THREE.Vector3(),targetYaw:0,moving:false,crouching:false,animTime:Math.random()*5,leftLeg,rightLeg,leftArm,rightArm,gun,health:100,alive:true};
 scene.add(group);remotePlayers.set(id,group);return group;
}
function updateRemote(data){
 let g=remotePlayers.get(data.id)||makeRemote(data.id,data);
 const baseY=(Number(data.y)||1.7)-(data.crouching?1.15:1.7);
 g.userData.targetPosition.set(Number(data.x)||0,Math.max(0,baseY),Number(data.z)||0);
 g.userData.targetYaw=Number(data.yaw)||0;g.userData.moving=Boolean(data.moving);g.userData.crouching=Boolean(data.crouching);
 g.userData.health=Number.isFinite(data.health)?data.health:100;g.userData.alive=data.alive!==false;g.visible=g.userData.alive;
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
function connectServer(){return new Promise((resolve)=>{let url=$('server-url').value.trim()||autoServerUrl();let done=false;try{socket=new WebSocket(url);}catch{resolve(false);return;}const finish=(ok)=>{if(done)return;done=true;clearTimeout(timeout);resolve(ok);};const timeout=setTimeout(()=>{finish(false);try{socket?.close();}catch{}},8000);socket.onopen=()=>{$('server-dot').parentElement.classList.add('connected');$('server-label').textContent='CONNECTED';send('join',{mode:selectedMode,map:selectedMap,name:'ECLIPSE-'+Math.floor(10+Math.random()*89)});};socket.onmessage=(ev)=>{let m;try{m=JSON.parse(ev.data);}catch{return;}if(m.type==='welcome')finish(true);if(m.type==='error'&&!done)finish(false);handleNetwork(m);};socket.onclose=()=>{$('server-dot').parentElement.classList.remove('connected');$('server-label').textContent='OFFLINE / LOCAL';if(!done)finish(false);if(running&&!training)toast('Connection lost. Returning to local training.');};socket.onerror=()=>{if(!done)finish(false);};});}
function handleNetwork(m){
 if(m.type==='welcome'){
  myId=m.id;teamId=m.team;players=m.players||[];serverSpawn=m.self||players.find(p=>p.id===myId)||null;
  if(serverSpawn)applyServerPosition(serverSpawn);renderPlayers();
 }
 if(m.type==='players'||m.type==='state'||m.type==='scoreUpdate'||m.type==='elimination'){
  players=m.players||players;if(m.type==='players'||m.type==='elimination')renderPlayers();
  players.forEach(p=>{if(p.id!==myId)updateRemote(p);});
  const ids=new Set(players.map(p=>p.id));for(const id of remotePlayers.keys())if(!ids.has(id))removeRemote(id);
  const mine=players.find(p=>p.id===myId);if(mine){health=Number.isFinite(mine.health)?mine.health:health;updateHealthHud();}
  $('scoreboard-mini').innerHTML=`YOU <b>${kills}</b> <i>—</i> TOP <b>${Math.max(0,...players.map(p=>p.score||0))}</b>`;
 }
 if(m.type==='shot'&&m.id!==myId){
  const origin=new THREE.Vector3(m.ox??m.x,m.oy??1.45,m.oz??m.z);
  spawnPulse(origin,new THREE.Vector3(m.dx,m.dy||0,m.dz),false,weapons.find(w=>w.id===m.weapon)||weapons[0]);
  const remote=remotePlayers.get(m.id);if(remote)remote.userData.gun.rotation.x=-.2;
 }
 if(m.type==='hitConfirm'){
  showHit();feed(`HIT CONFIRMED · ${m.damage} DAMAGE`);
  if(m.eliminated)feed(`ELIMINATION · ${m.targetName||'OPERATOR'}`);
 }
 if(m.type==='damaged'){
  health=Number.isFinite(m.health)?m.health:health;updateHealthHud();
  feed(m.eliminated?'OPERATOR DOWN · REDEPLOYING':`HIT RECEIVED · ${m.damage} DAMAGE`);
 }
 if(m.type==='elimination'){
  if(m.source===myId){kills++;feed(`ELIMINATED ${m.targetName||'OPERATOR'}`);}
  if(m.target===myId){health=0;updateHealthHud();feed('YOU WERE ELIMINATED · REDEPLOYING');document.exitPointerLock?.();}
  (m.players||[]).forEach(p=>{if(p.id!==myId)updateRemote(p);});
 }
 if(m.type==='respawned'){
  health=Number.isFinite(m.health)?m.health:100;updateHealthHud();
  applyServerPosition(m);feed('REDEPLOYED');canvas.requestPointerLock?.();
 }
 if(m.type==='matchStart'){
  matchStarted=true;remaining=m.duration||480;
  if(!running){if(selectedMap==='district')buildDistrict();else buildIndustrial();createEclipse();beginMatch(false);}
  const mine=(m.players||players).find(p=>p.id===myId);if(mine)applyServerPosition(mine);
  toast('OPERATION LIVE');
 }
 if(m.type==='matchEnd')showResults(m.results||[]);
 if(m.type==='error')toast(m.message||'Server error');
}

// Top-down tactical radar. World coordinates stay north-up; the player marker shows facing.
function drawMinimap(){
 const canvas=$('minimap-canvas');if(!canvas)return;
 const ctx=canvas.getContext('2d');if(!ctx)return;
 const size=canvas.width, pad=10, span=100, scale=(size-pad*2)/span;
 const px=x=>pad+(x+50)*scale, py=z=>pad+(z+50)*scale;
 ctx.clearRect(0,0,size,size);
 ctx.fillStyle='rgba(5,12,19,.91)';ctx.fillRect(0,0,size,size);
 ctx.strokeStyle='rgba(188,205,218,.12)';ctx.lineWidth=1;
 for(let v=-40;v<=40;v+=20){ctx.beginPath();ctx.moveTo(px(v),pad);ctx.lineTo(px(v),size-pad);ctx.stroke();ctx.beginPath();ctx.moveTo(pad,py(v));ctx.lineTo(size-pad,py(v));ctx.stroke();}
 // Map perimeter: movement is blocked just inside this line.
 ctx.strokeStyle='rgba(230,168,91,.9)';ctx.lineWidth=2;ctx.strokeRect(px(-47.8),py(-47.8),95.6*scale,95.6*scale);
 // A few orientation/road references keep the radar readable without clutter.
 ctx.strokeStyle='rgba(160,177,190,.18)';ctx.lineWidth=4;
 ctx.beginPath();ctx.moveTo(px(-7.5),py(-45));ctx.lineTo(px(-7.5),py(45));ctx.stroke();
 ctx.beginPath();ctx.moveTo(px(-45),py(-7));ctx.lineTo(px(45),py(-7));ctx.stroke();
 // Teammates are cyan; opponents are red. Training has no network contacts.
 for(const p of players){
  if(p.id===myId||p.alive===false)continue;
  const friendly=selectedMode!=='ffa'&&p.team===teamId;
  const x=px(THREE.MathUtils.clamp(Number(p.x)||0,-49,49));
  const y=py(THREE.MathUtils.clamp(Number(p.z)||0,-49,49));
  ctx.beginPath();ctx.arc(x,y,friendly?4.1:4.6,0,Math.PI*2);
  ctx.fillStyle=friendly?'#69d5e8':'#ff5656';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=8;ctx.fill();ctx.shadowBlur=0;
 }
 const x=px(player.pos.x),y=py(player.pos.z),a=player.yaw;
 ctx.save();ctx.translate(x,y);ctx.rotate(-a);
 ctx.fillStyle='#f5c27d';ctx.strokeStyle='#fff0d8';ctx.lineWidth=1.2;ctx.shadowColor='#f5c27d';ctx.shadowBlur=8;
 ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(5.5,6);ctx.lineTo(0,3.5);ctx.lineTo(-5.5,6);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
 ctx.fillStyle='rgba(226,235,241,.7)';ctx.font='bold 8px Inter,Arial';ctx.fillText('N',size/2-3,9);
}

function updateHealthHud(){health=Math.max(0,Math.min(100,health));$('health-fill').style.width=`${health}%`;$('health-value').textContent=String(Math.round(health));}

function renderPlayers(){const list=$('player-list');if(!list)return;list.innerHTML='';players.forEach(p=>{const row=document.createElement('div');row.className='player-row';const name=document.createElement('span');name.textContent=p.name+(p.id===myId?'  (YOU)':'');if(p.id===myId)name.className='self';const role=document.createElement('small');role.textContent=p.team!==null&&p.team!==undefined?'SQUAD '+(p.team+1):'SOLO';row.append(name,role);list.append(row);});$('lobby-count').textContent=`${players.length} / ${selectedMode==='ffa'?8:selectedMode==='duos'?8:12}`;updateTeamPanel();}
function updateTeamPanel(){const panel=$('team-panel');panel.innerHTML='';if(selectedMode==='ffa'){panel.classList.add('hidden');return;}panel.classList.remove('hidden');players.filter(p=>p.team===teamId).forEach(p=>{const el=document.createElement('div');el.className='team-member';el.textContent=(p.id===myId?'YOU':p.name);panel.append(el);});}
function spawnPulse(origin,dir,local=true,weapon=weapons[weaponIndex]){const mat=new THREE.MeshBasicMaterial({color:weapon.color});const mesh=new THREE.Mesh(new THREE.SphereGeometry(weapon.id==='arc'?.13:.085,8,8),mat);mesh.position.copy(origin);scene.add(mesh);projectiles.push({mesh,dir:dir.clone().normalize(),life:1.2,local,speed:weapon.speed});}
function fire(){if(!running||paused||health<=0||!pointerLocked||reloading||ammo<=0)return;const w=weapons[weaponIndex],now=performance.now();if(now-lastShot<w.rate)return;lastShot=now;ammo--;weaponAmmo[weaponIndex].ammo=ammo;syncAmmo();weaponRecoil=Math.min(1,weaponRecoil+.75);const dir=new THREE.Vector3();camera.getWorldDirection(dir);const origin=camera.position.clone();spawnPulse(origin,dir,true,w);send('shot',{weapon:w.id,x:player.pos.x,y:player.pos.y,z:player.pos.z,dx:dir.x,dy:dir.y,dz:dir.z,ox:origin.x,oy:origin.y,oz:origin.z});}
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
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.04);if(running&&!paused){movePlayer(dt);if(mouseHeld&&weapons[weaponIndex].id==='volt')fire();updateProjectiles(dt);updateRemoteModels(dt);remaining-=dt;if(remaining<=0){remaining=0;if(training)showResults([]);else send('endMatch');}const mins=Math.floor(remaining/60),secs=Math.floor(remaining%60);$('timer').textContent=`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;if(!training&&performance.now()-lastMoveSend>=50){lastMoveSend=performance.now();send('move',{x:player.pos.x,y:player.pos.y,z:player.pos.z,yaw:player.yaw,pitch:player.pitch,moving:player.moving,crouching:player.crouching,weapon:weapons[weaponIndex].id});}}else {updateProjectiles(dt);updateRemoteModels(dt);}drawMinimap();renderer.render(scene,camera);}

$('mode-grid');document.querySelectorAll('.mode-card').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.mode-card').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');selectedMode=b.dataset.mode;}));
document.querySelectorAll('.map-choice').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.map-choice').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedMap=b.dataset.map;$('map-name').textContent=selectedMap.toUpperCase();}));
$('deploy').addEventListener('click',async()=>{const ok=await connectServer();if(!ok){toast('SERVER UNAVAILABLE — START SERVER OR USE SOLO TRAINING');return;}$('lobby-title').textContent=selectedMode==='ffa'?'FREE FOR ALL':selectedMode.toUpperCase();$('lobby-subtitle').textContent=isLocalHost?'Connected to local operation server':'Connected to online operation server';$('lobby-map').textContent=selectedMap.toUpperCase();$('lobby-mode').textContent=selectedMode.toUpperCase();$('menu').classList.remove('active');$('lobby').classList.add('active');renderPlayers();});
$('training').addEventListener('click',()=>{if(selectedMap==='district')buildDistrict();else buildIndustrial();createEclipse();beginMatch(true);toast('SOLO TRAINING — NETWORK PLAY DISABLED');});
$('start-match').addEventListener('click',()=>{if(!socket||socket.readyState!==WebSocket.OPEN){toast('NOT CONNECTED TO SERVER');return;}if(players.length<2){toast('AT LEAST 2 PLAYERS REQUIRED');return;}send('startMatch');toast('REQUESTING MATCH START');});
$('back-menu').addEventListener('click',backToMenu);$('resume').addEventListener('click',resumeGame);$('leave-match').addEventListener('click',backToMenu);$('return-menu').addEventListener('click',backToMenu);
canvas.addEventListener('click',()=>{if(running&&!paused&&!pointerLocked)canvas.requestPointerLock?.();});document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===canvas;});document.addEventListener('mousemove',e=>{if(!pointerLocked||!running||paused)return;player.yaw-=e.movementX*.0021;player.pitch-=e.movementY*.0018;player.pitch=THREE.MathUtils.clamp(player.pitch,-1.35,1.35);updateCamera();});document.addEventListener('mousedown',e=>{if(e.button===0){mouseHeld=true;fire();}});document.addEventListener('mouseup',e=>{if(e.button===0)mouseHeld=false;});document.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Escape'&&running){if(paused)resumeGame();else pauseGame();}if(e.code==='KeyR')reload();if(e.code==='Digit1')switchWeapon(0);if(e.code==='Digit2')switchWeapon(1);if(e.code==='Digit3')switchWeapon(2);if(e.code==='Space'&&running&&!paused&&player.onGround){e.preventDefault();verticalVelocity=7.2;player.onGround=false;}});document.addEventListener('keyup',e=>keys[e.code]=false);window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
buildDistrict();createEclipse();animate();
