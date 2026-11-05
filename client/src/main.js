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
 for(let i=0;i<hangars.length;i++){const [x,z,w,d,h]=hangars[i];box(x,h/2,z,w,h,d,new THREE.MeshStandardMaterial({color:i%2?0x3d535f:0x334954,metalness:.56,roughness:.48}),true);const roof=addVisualMesh(new THREE.CylinderGeometry(w*.56,w*.56,d,32,1,true,0,Math.PI),new THREE.MeshStandardMaterial({color:0x1c303b,metalness:.7,roughness:.32,side:THREE.DoubleSide}),x,h*.82,z);roof.rotation.z=Math.PI/2;roof.scale.set(1,1,.78);detailBox(x,h*.48,z+(z<0?1:-1)*(d/2+.08),w*.64,h*.72,.16,new THREE.MeshBasicMaterial({color:0x46b8d0,transparent:true,opacity:.18,side:THREE.DoubleSide}));for(let k=-3;k<=3;k++)detailBox(x+k*1.35,h*.48,z+(z<0?1:-1)*(d/2+.18),.12,h*.7,.2,hazard);for(const s of [-1,1]){box(x+s*(w/2+.35),h/2,z,.6,h+.6,d+.5,steel);detailBox(x+s*(w/2+.35),h*.72,z,.68,.2,d+.45,hazard);}mapLight(x,h*.7,z+(z<0?1:-1)*(d/2+1),0x53cce0,1.4,24);}
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
function createEclipse(){
 const sun=new THREE.Mesh(new THREE.SphereGeometry(5,32,32),new THREE.MeshBasicMaterial({color:0x080b11}));sun.position.set(-35,42,-78);scene.add(sun);mapObjects.push(sun);
 const halo=new THREE.Mesh(new THREE.TorusGeometry(5.8,.16,10,96),new THREE.MeshBasicMaterial({color:0xe0a66b,transparent:true,opacity:.9}));halo.position.copy(sun.position);halo.lookAt(0,0,0);scene.add(halo);mapObjects.push(halo);
 const corona=new THREE.Mesh(new THREE.SphereGeometry(6.7,32,32),new THREE.MeshBasicMaterial({color:0x9a5932,transparent:true,opacity:.10,side:THREE.BackSide}));corona.position.copy(sun.position);scene.add(corona);mapObjects.push(corona);
 const stars=new THREE.Group();for(let i=0;i<180;i++){const dot=new THREE.Mesh(new THREE.SphereGeometry(.07,5,5),new THREE.MeshBasicMaterial({color:0x9eabb8,transparent:true,opacity:Math.random()*.65}));dot.position.set((Math.random()-.5)*180,15+Math.random()*65,(Math.random()-.5)*180);stars.add(dot);}scene.add(stars);mapObjects.push(stars);
}
function updateCamera(){camera.position.copy(player.pos);camera.rotation.order='YXZ';camera.rotation.y=player.yaw;camera.rotation.x=player.pitch;}
function buildViewWeapon(){
  if(viewWeapon){camera.remove(viewWeapon);viewWeapon.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});}
  const w=weapons[weaponIndex],g=new THREE.Group();
  const dark=new THREE.MeshStandardMaterial({color:0x101a22,metalness:.82,roughness:.25}),body=new THREE.MeshStandardMaterial({color:weaponIndex===1?0x31505a:weaponIndex===2?0x514036:0x344d43,metalness:.62,roughness:.31}),glow=new THREE.MeshStandardMaterial({color:w.color,emissive:w.color,emissiveIntensity:1.35,metalness:.3,roughness:.18}),armor=new THREE.MeshPhysicalMaterial({color:0x667d56,metalness:.48,roughness:.35,clearcoat:.4}),glove=new THREE.MeshStandardMaterial({color:0x101719,roughness:.92}),trim=new THREE.MeshStandardMaterial({color:0x9aabae,metalness:.82,roughness:.25});
  const add=(parent,geo,mat,x,y,z)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;};
  const ell=(parent,mat,x,y,z,sx,sy,sz)=>{const m=add(parent,new THREE.SphereGeometry(1,20,14),mat,x,y,z);m.scale.set(sx,sy,sz);return m;};
  const box=(parent,mat,x,y,z,sx,sy,sz)=>add(parent,new THREE.BoxGeometry(sx,sy,sz),mat,x,y,z);
  const cyl=(parent,mat,x,y,z,r,len)=>{const m=add(parent,new THREE.CylinderGeometry(r,r,len,12),mat,x,y,z);m.rotation.x=Math.PI/2;return m;};
  const cap=(parent,mat,x,y,z,r,len)=>add(parent,new THREE.CapsuleGeometry(r,len,5,12),mat,x,y,z);
  const leftSleeve=cap(g,armor,-.27,-.25,.13,.105,.34);leftSleeve.rotation.z=.38;const rightSleeve=cap(g,armor,.28,-.25,.15,.11,.36);rightSleeve.rotation.z=-.42;
  ell(g,trim,-.27,-.43,.02,.12,.055,.12);ell(g,trim,.28,-.43,.03,.125,.055,.125);
  ell(g,glove,-.16,-.16,-.05,.105,.085,.14);ell(g,glove,.18,-.16,-.06,.11,.09,.15);
  ell(g,armor,-.16,-.14,-.12,.095,.055,.12);ell(g,armor,.18,-.14,-.13,.1,.06,.13);
  let muzzle;
  if(w.id==='pulse'){
    box(g,body,0,0,0,.31,.22,.56);box(g,dark,0,.02,-.3,.22,.14,.25);box(g,body,0,-.12,.16,.2,.28,.2);
    box(g,trim,0,.14,-.04,.25,.045,.4);box(g,glow,0,.095,-.16,.11,.035,.16);
    cyl(g,dark,0,.015,-.53,.052,.38);cyl(g,trim,0,.015,-.73,.068,.055);
    box(g,body,0,-.22,.04,.13,.22,.16);box(g,glow,.105,-.04,.06,.035,.1,.2);
    box(g,dark,0,.16,-.12,.09,.07,.15);box(g,trim,0,.21,-.12,.045,.025,.12);
    const stock=box(g,dark,0,-.015,.36,.24,.16,.32);stock.rotation.x=-.08;
    muzzle=ell(g,glow,0,.015,-.78,.07,.07,.035);
  }else if(w.id==='volt'){
    box(g,body,0,.015,-.03,.25,.16,.34);box(g,dark,0,.07,-.22,.2,.1,.22);
    cyl(g,dark,0,.04,-.37,.045,.2);cyl(g,glow,0,.04,-.48,.052,.035);
    box(g,trim,0,.12,-.07,.16,.035,.28);box(g,glow,.145,.015,-.02,.045,.12,.18);
    const grip=box(g,dark,0,-.16,.12,.14,.27,.16);grip.rotation.x=-.2;grip.rotation.z=-.08;
    box(g,body,0,-.04,.23,.12,.12,.12);box(g,trim,0,.18,-.08,.045,.06,.12);
    muzzle=ell(g,glow,0,.04,-.51,.055,.055,.03);
  }else{
    box(g,body,0,0,.02,.39,.27,.78);box(g,dark,0,.02,-.43,.29,.2,.38);
    box(g,body,0,-.18,.2,.25,.34,.3);box(g,dark,0,-.06,.46,.32,.2,.3);
    for(const side of [-1,1]){cyl(g,dark,side*.105,.025,-.72,.052,.52);cyl(g,glow,side*.105,.025,-.99,.064,.05);const coil=add(g,new THREE.TorusGeometry(.065,.018,8,18),glow,side*.105,.025,-.64);coil.rotation.x=Math.PI/2;}
    box(g,glow,.225,.015,.08,.09,.2,.29);box(g,trim,0,.18,-.12,.23,.08,.32);
    box(g,dark,0,.28,-.14,.17,.12,.2);box(g,trim,0,.35,-.14,.12,.035,.14);
    const stock=box(g,dark,0,.005,.52,.34,.2,.34);stock.rotation.x=-.05;
    muzzle=ell(g,glow,0,.025,-1.04,.11,.08,.04);
  }
  muzzle.visible=false;g.userData.muzzleFlash=muzzle;
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
function makeRemote(id,data={}){
 const group=new THREE.Group(),teamColors=[0x4c9eac,0xd2a45c,0x78a77c,0x9b83c5],teamColor=data.team==null?0x6b9b67:teamColors[data.team%teamColors.length];
 const armor=new THREE.MeshPhysicalMaterial({color:0x536b4c,metalness:.48,roughness:.34,clearcoat:.42}),armorLight=new THREE.MeshPhysicalMaterial({color:0x82936b,metalness:.42,roughness:.36,clearcoat:.35}),undersuit=new THREE.MeshStandardMaterial({color:0x111a1c,roughness:.92}),graphite=new THREE.MeshStandardMaterial({color:0x26343a,metalness:.76,roughness:.3}),steel=new THREE.MeshStandardMaterial({color:0x87999a,metalness:.8,roughness:.28}),accent=new THREE.MeshStandardMaterial({color:teamColor,emissive:teamColor,emissiveIntensity:.22,metalness:.38,roughness:.3}),gold=new THREE.MeshPhysicalMaterial({color:0xe7ad43,metalness:.86,roughness:.18,clearcoat:1,emissive:0x5a2b08,emissiveIntensity:.24}),rubber=new THREE.MeshStandardMaterial({color:0x080d10,roughness:.98});
 const add=(p,g,m,x,y,z)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;p.add(o);return o;},ell=(p,m,x,y,z,sx,sy,sz)=>{const o=add(p,new THREE.SphereGeometry(1,24,16),m,x,y,z);o.scale.set(sx,sy,sz);return o;},cap=(p,m,x,y,z,r,l)=>add(p,new THREE.CapsuleGeometry(r,l,6,14),m,x,y,z);
 // Smooth, athletic powered-armor proportions. The silhouette uses ellipsoids and capsules, not box limbs.
 cap(group,undersuit,0,1.06,0,.255,.54);ell(group,armor,0,1.26,-.035,.34,.39,.235);ell(group,armorLight,0,1.29,-.205,.285,.255,.105);ell(group,graphite,0,.91,.005,.25,.18,.205);
 for(let i=0;i<3;i++)ell(group,i===1?armorLight:armor,0,.83+i*.13,-.205,.235,.075,.075);
 const collar=add(group,new THREE.TorusGeometry(.245,.075,12,32),graphite,0,1.53,0);collar.rotation.x=Math.PI/2;
 ell(group,undersuit,0,1.67,0,.225,.245,.205);ell(group,armorLight,0,1.72,.005,.255,.265,.22);ell(group,armor,0,1.81,.015,.255,.19,.225);ell(group,gold,0,1.69,-.183,.205,.105,.055);ell(group,graphite,0,1.91,.005,.19,.055,.18);
 for(const s of [-1,1]){ell(group,graphite,s*.245,1.68,0,.075,.12,.14);ell(group,accent,s*.255,1.68,-.01,.035,.065,.09);const shoulder=ell(group,armorLight,s*.405,1.38,-.005,.245,.205,.255);shoulder.rotation.z=s*.12;ell(group,armor,s*.405,1.43,-.11,.205,.135,.19);ell(group,accent,s*.405,1.47,-.255,.09,.035,.025);cap(group,undersuit,s*.31,.94,0,.115,.27);}
 ell(group,graphite,0,1.25,.255,.27,.39,.17);ell(group,armor,0,1.29,.365,.215,.29,.11);
 for(const s of [-1,1]){ell(group,steel,s*.205,1.38,.34,.075,.19,.09);ell(group,accent,s*.205,1.46,.405,.045,.07,.025);const antenna=cap(group,graphite,s*.18,1.72,.31,.018,.22);antenna.rotation.z=s*.12;}
 const leftArm=new THREE.Group();leftArm.position.set(-.34,1.34,0);group.add(leftArm);const rightArm=new THREE.Group();rightArm.position.set(.34,1.34,0);group.add(rightArm);
 for(const [p,s] of [[leftArm,-1],[rightArm,1]]){cap(p,undersuit,s*.025,-.21,0,.105,.3);const upper=ell(p,armor,s*.025,-.22,-.015,.145,.235,.145);upper.rotation.z=s*-.1;cap(p,undersuit,s*.035,-.49,-.035,.09,.27);const bracer=ell(p,armorLight,s*.035,-.49,-.115,.12,.205,.12);bracer.rotation.z=s*-.08;ell(p,graphite,s*.035,-.65,-.12,.105,.09,.1);ell(p,accent,s*.035,-.5,-.215,.055,.1,.025);ell(p,rubber,s*.035,-.72,-.09,.095,.12,.105);}
 const leftLeg=new THREE.Group();leftLeg.position.set(-.15,.72,0);group.add(leftLeg);const rightLeg=new THREE.Group();rightLeg.position.set(.15,.72,0);group.add(rightLeg);
 for(const [p,s] of [[leftLeg,-1],[rightLeg,1]]){cap(p,undersuit,0,-.245,0,.12,.39);const thigh=ell(p,armor,0,-.235,-.015,.155,.255,.16);thigh.rotation.z=s*.025;ell(p,armorLight,0,-.49,-.105,.145,.12,.115);ell(p,graphite,0,-.53,-.02,.13,.105,.13);cap(p,undersuit,0,-.72,-.015,.105,.28);const shin=ell(p,armor,0,-.72,-.105,.13,.205,.12);shin.rotation.x=-.08;ell(p,accent,s*.055,-.7,-.205,.055,.105,.025);ell(p,rubber,0,-.91,-.11,.15,.085,.245);ell(p,graphite,0,-.91,-.23,.12,.055,.12);}
 // Angular armour overlays: hard panel breaks and raised bevels replace the soft blended silhouette.
 const panelMat=new THREE.MeshPhysicalMaterial({color:0x91a477,metalness:.62,roughness:.28,clearcoat:.55});
 const panelDark=new THREE.MeshStandardMaterial({color:0x34483d,metalness:.72,roughness:.3});
 const panelEdge=new THREE.LineBasicMaterial({color:0x172329,transparent:true,opacity:.95});
 const makePlate=(parent,mat,x,y,z,points,depth=.065)=>{
  const sh=new THREE.Shape();sh.moveTo(points[0][0],points[0][1]);for(let n=1;n<points.length;n++)sh.lineTo(points[n][0],points[n][1]);sh.closePath();
  const geo=new THREE.ExtrudeGeometry(sh,{depth,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.018,bevelThickness:.018,curveSegments:1});
  geo.translate(0,0,-depth/2);
  const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo,20),panelEdge));return mesh;
 };
 // Split chest into left/right breastplates with a central armored spine.
 makePlate(group,panelMat,0,1.34,-.305,[[-.27,.12],[-.21,.22],[-.035,.16],[-.025,-.09],[-.18,-.14],[-.27,-.02]],.075);
 makePlate(group,panelMat,0,1.34,-.305,[[.27,.12],[.21,.22],[.035,.16],[.025,-.09],[.18,-.14],[.27,-.02]],.075);
 makePlate(group,panelDark,0,1.33,-.35,[[-.035,.18],[.035,.18],[.045,-.17],[-.045,-.17]],.035);
 for(let n=0;n<3;n++){const y=1.04-n*.105,w=.19-n*.012;makePlate(group,n===1?panelMat:armor,0,y,-.27,[[-w,.045],[-w*.78,-.045],[0,-.07],[w*.78,-.045],[w,.045],[0,.075]],.055);}
 // Angular shoulder shells, forearm shields, thigh guards and shin plates.
 for(const side of [-1,1]){
  makePlate(group,panelMat,side*.405,1.4,-.235,[[0,.21],[side*.17,.13],[side*.18,-.035],[side*.07,-.19],[-side*.12,-.15],[-side*.19,.035]],.075);
  makePlate(group,accent,side*.405,1.4,-.282,[[0,.075],[side*.075,.035],[side*.04,-.045],[-side*.04,-.045],[-side*.075,.025]],.025);
  const arm=side<0?leftArm:rightArm,leg=side<0?leftLeg:rightLeg;
  makePlate(arm,panelMat,side*.025,-.49,-.235,[[-.085,.17],[.065,.19],[.11,.035],[.065,-.16],[-.06,-.19],[-.12,-.035]],.06);
  makePlate(leg,panelMat,0,-.235,-.235,[[-.13,.2],[.075,.23],[.15,.08],[.105,-.17],[-.04,-.22],[-.145,-.055]],.06);
  makePlate(leg,panelMat,0,-.72,-.225,[[-.105,.18],[.08,.18],[.12,.02],[.075,-.17],[-.055,-.2],[-.13,-.035]],.06);
  makePlate(leg,accent,0,-.49,-.19,[[-.09,.055],[.09,.055],[.08,-.055],[0,-.1],[-.08,-.055]],.025);
 }
 const gun=new THREE.Group();gun.position.set(.25,1.02,-.31);gun.rotation.x=-.08;group.add(gun);ell(gun,graphite,0,0,-.1,.115,.105,.26);ell(gun,armor,0,.035,-.09,.09,.075,.22);const barrel=cap(gun,steel,0,.005,-.39,.035,.24);barrel.rotation.x=Math.PI/2;ell(gun,accent,0,.075,-.17,.052,.025,.12);const grip=cap(gun,graphite,0,-.13,.04,.045,.13);grip.rotation.x=-.18;
 const shadow=new THREE.Mesh(new THREE.CircleGeometry(.43,24),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.28,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.015;group.add(shadow);
 const labelCanvas=document.createElement('canvas');labelCanvas.width=256;labelCanvas.height=64;const ctx=labelCanvas.getContext('2d');ctx.fillStyle='rgba(5,12,18,.7)';ctx.fillRect(12,10,232,44);ctx.strokeStyle='#9fc4b1';ctx.strokeRect(12,10,232,44);ctx.fillStyle='#eef4ef';ctx.font='bold 22px Arial';ctx.textAlign='center';ctx.fillText(String(data.name||'SPARTAN').slice(0,18),128,39);const tex=new THREE.CanvasTexture(labelCanvas);const label=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));label.scale.set(1.35,.34,1);label.position.set(0,2.22,0);group.add(label);
 group.userData={targetPosition:new THREE.Vector3(),targetYaw:0,moving:false,crouching:false,animTime:Math.random()*5,leftLeg,rightLeg,leftArm,rightArm,gun,health:100,alive:true};scene.add(group);remotePlayers.set(id,group);return group;
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

const CROSSHAIR_STYLES=['standard','red','dot','green','amber'];
function setCrosshair(style,save=true){
 const chosen=CROSSHAIR_STYLES.includes(style)?style:'standard';
 const sight=$('game-crosshair');if(sight)sight.dataset.style=chosen;
 document.querySelectorAll('[data-crosshair]').forEach(b=>b.classList.toggle('selected',b.dataset.crosshair===chosen));
 if(save){try{localStorage.setItem('eclipse-crosshair',chosen);}catch{}}
}

function updateHealthHud(){health=Math.max(0,Math.min(100,health));$('health-fill').style.width=`${health}%`;$('health-value').textContent=String(Math.round(health));}

function renderPlayers(){const list=$('player-list');if(!list)return;list.innerHTML='';players.forEach(p=>{const row=document.createElement('div');row.className='player-row';const name=document.createElement('span');name.textContent=p.name+(p.id===myId?'  (YOU)':'');if(p.id===myId)name.className='self';const role=document.createElement('small');role.textContent=p.team!==null&&p.team!==undefined?'SQUAD '+(p.team+1):'SOLO';row.append(name,role);list.append(row);});$('lobby-count').textContent=`${players.length} / ${selectedMode==='ffa'?8:selectedMode==='duos'?8:12}`;updateTeamPanel();}
function updateTeamPanel(){const panel=$('team-panel');panel.innerHTML='';if(selectedMode==='ffa'){panel.classList.add('hidden');return;}panel.classList.remove('hidden');players.filter(p=>p.team===teamId).forEach(p=>{const el=document.createElement('div');el.className='team-member';el.textContent=(p.id===myId?'YOU':p.name);panel.append(el);});}
function spawnPulse(origin,dir,local=true,weapon=weapons[weaponIndex]){const mat=new THREE.MeshBasicMaterial({color:weapon.color});const mesh=new THREE.Mesh(new THREE.SphereGeometry(weapon.id==='arc'?.13:.085,8,8),mat);mesh.position.copy(origin);scene.add(mesh);projectiles.push({mesh,dir:dir.clone().normalize(),life:1.2,local,speed:weapon.speed});}
function fire(){if(!running||paused||health<=0||!pointerLocked||reloading||ammo<=0)return;const w=weapons[weaponIndex],now=performance.now();if(now-lastShot<w.rate)return;lastShot=now;ammo--;weaponAmmo[weaponIndex].ammo=ammo;syncAmmo();weaponRecoil=Math.min(1,weaponRecoil+(w.id==='arc'?.95:w.id==='pulse'?.62:.32));if(viewWeapon?.userData.muzzleFlash){const flash=viewWeapon.userData.muzzleFlash;flash.visible=true;setTimeout(()=>{flash.visible=false;},w.id==='arc'?75:45);}const dir=new THREE.Vector3();camera.getWorldDirection(dir);const origin=camera.position.clone();spawnPulse(origin,dir,true,w);send('shot',{weapon:w.id,x:player.pos.x,y:player.pos.y,z:player.pos.z,dx:dir.x,dy:dir.y,dz:dir.z,ox:origin.x,oy:origin.y,oz:origin.z});}
function updateProjectiles(dt){for(let i=projectiles.length-1;i>=0;i--){const p=projectiles[i];p.mesh.position.addScaledVector(p.dir,(p.speed||34)*dt);p.life-=dt;if(p.local){for(const [id,g] of remotePlayers){const target=new THREE.Vector3(g.position.x,1,g.position.z);if(target.distanceTo(p.mesh.position)<.75){p.life=0;break;}}}if(p.life<=0){scene.remove(p.mesh);projectiles.splice(i,1);}}}
function showHit(){const h=$('hit-marker');h.classList.add('show');setTimeout(()=>h.classList.remove('show'),130);}
function reload(){const w=weapons[weaponIndex];if(reloading||ammo===w.mag||reserve<=0)return;reloading=true;toast('RECHARGING '+w.name);reloadTimer=setTimeout(()=>{const n=Math.min(w.mag-ammo,reserve);ammo+=n;reserve-=n;weaponAmmo[weaponIndex]={ammo,reserve};syncAmmo();reloading=false;reloadTimer=null;},weaponIndex===1?720:weaponIndex===2?1680:1120);}
function respawn(){health=100;$('health-fill').style.width='100%';$('health-value').textContent='100';player.pos.set((Math.random()-.5)*12,1.7,(Math.random()-.5)*12);verticalVelocity=0;player.onGround=true;toast('REDEPLOYED');send('respawn');}
function feed(text){const f=$('feed'),el=document.createElement('div');el.textContent=text;f.prepend(el);setTimeout(()=>el.remove(),4000);}
function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2200);}
function beginMatch(isTraining=false){training=isTraining;running=true;paused=false;kills=0;health=100;weaponIndex=0;verticalVelocity=0;player.onGround=true;weaponAmmo.forEach((a,i)=>{a.ammo=weapons[i].mag;a.reserve=weapons[i].stock;});syncAmmo();buildViewWeapon();remaining=480;matchStarted=false;$('menu').classList.remove('active');$('lobby').classList.remove('active');$('pause').classList.remove('active');$('results').classList.remove('active');$('hud').classList.remove('hidden');$('hud-mode').textContent=selectedMode==='ffa'?'FREE FOR ALL':selectedMode.toUpperCase();$('hud-map').textContent=selectedMap.toUpperCase();$('ammo').textContent=ammo;$('reserve').textContent=reserve;$('health-fill').style.width='100%';$('health-value').textContent='100';$('objective-hint').textContent=selectedMode==='ffa'?'EVERY OPERATOR FOR THEMSELVES':'STAY WITH YOUR SQUAD';canvas.requestPointerLock?.();}
function pauseGame(){if(!running)return;paused=true;document.exitPointerLock?.();$('pause').classList.add('active');}
function resumeGame(){paused=false;$('pause').classList.remove('active');canvas.requestPointerLock?.();}
function showResults(results=[]){running=false;document.exitPointerLock?.();$('hud').classList.add('hidden');$('results').classList.add('active');$('result-kills').textContent=kills;$('result-place').textContent=results.findIndex(p=>p.id===myId)+1||'—';$('result-xp').textContent=kills*100+250;const list=$('results-list');list.innerHTML='';results.forEach((p,i)=>{const row=document.createElement('div');row.className='results-row';row.innerHTML=`<span>${i+1}. ${escapeHtml(p.name)}</span><b>${p.score||0}</b>`;list.append(row);});}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function backToMenu(){running=false;paused=false;document.exitPointerLock?.();$('hud').classList.add('hidden');$('pause').classList.remove('active');$('results').classList.remove('active');$('lobby').classList.remove('active');$('menu').classList.add('active');if(socket){socket.close();socket=null;}for(const id of remotePlayers.keys())removeRemote(id);}
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.04);if(running&&!paused){movePlayer(dt);if(mouseHeld&&weapons[weaponIndex].id!=='arc')fire();updateProjectiles(dt);updateRemoteModels(dt);remaining-=dt;if(remaining<=0){remaining=0;if(training)showResults([]);else send('endMatch');}const mins=Math.floor(remaining/60),secs=Math.floor(remaining%60);$('timer').textContent=`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;if(!training&&performance.now()-lastMoveSend>=50){lastMoveSend=performance.now();send('move',{x:player.pos.x,y:player.pos.y,z:player.pos.z,yaw:player.yaw,pitch:player.pitch,moving:player.moving,crouching:player.crouching,weapon:weapons[weaponIndex].id});}}else {updateProjectiles(dt);updateRemoteModels(dt);}drawMinimap();renderer.render(scene,camera);}

$('mode-grid');setCrosshair((()=>{try{return localStorage.getItem('eclipse-crosshair')||'standard';}catch{return 'standard';}})(),false);document.querySelectorAll('[data-crosshair]').forEach(b=>b.addEventListener('click',()=>setCrosshair(b.dataset.crosshair)));document.querySelectorAll('.mode-card').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.mode-card').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');selectedMode=b.dataset.mode;}));
document.querySelectorAll('.map-choice').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.map-choice').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedMap=b.dataset.map;$('map-name').textContent=selectedMap.toUpperCase();}));
$('deploy').addEventListener('click',async()=>{const ok=await connectServer();if(!ok){toast('SERVER UNAVAILABLE — START SERVER OR USE SOLO TRAINING');return;}$('lobby-title').textContent=selectedMode==='ffa'?'FREE FOR ALL':selectedMode.toUpperCase();$('lobby-subtitle').textContent=isLocalHost?'Connected to local operation server':'Connected to online operation server';$('lobby-map').textContent=selectedMap.toUpperCase();$('lobby-mode').textContent=selectedMode.toUpperCase();$('menu').classList.remove('active');$('lobby').classList.add('active');renderPlayers();});
$('training').addEventListener('click',()=>{if(selectedMap==='district')buildDistrict();else buildIndustrial();createEclipse();beginMatch(true);toast('SOLO TRAINING — NETWORK PLAY DISABLED');});
$('start-match').addEventListener('click',()=>{if(!socket||socket.readyState!==WebSocket.OPEN){toast('NOT CONNECTED TO SERVER');return;}if(players.length<2){toast('AT LEAST 2 PLAYERS REQUIRED');return;}send('startMatch');toast('REQUESTING MATCH START');});
$('back-menu').addEventListener('click',backToMenu);$('resume').addEventListener('click',resumeGame);$('leave-match').addEventListener('click',backToMenu);$('return-menu').addEventListener('click',backToMenu);
canvas.addEventListener('click',()=>{if(running&&!paused&&!pointerLocked)canvas.requestPointerLock?.();});document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===canvas;});document.addEventListener('mousemove',e=>{if(!pointerLocked||!running||paused)return;player.yaw-=e.movementX*.0021;player.pitch-=e.movementY*.0018;player.pitch=THREE.MathUtils.clamp(player.pitch,-1.35,1.35);updateCamera();});document.addEventListener('mousedown',e=>{if(e.button===0){mouseHeld=true;fire();}});document.addEventListener('mouseup',e=>{if(e.button===0)mouseHeld=false;});document.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Escape'&&running){if(paused)resumeGame();else pauseGame();}if(e.code==='KeyR')reload();if(e.code==='Digit1')switchWeapon(0);if(e.code==='Digit2')switchWeapon(1);if(e.code==='Digit3')switchWeapon(2);if(e.code==='Space'&&running&&!paused&&player.onGround){e.preventDefault();verticalVelocity=7.2;player.onGround=false;}});document.addEventListener('keyup',e=>keys[e.code]=false);window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
buildDistrict();createEclipse();animate();
