'use strict';

// Conservative server-side collision volumes for major gameplay geometry.
// The client still predicts movement, but the server rejects swept paths
// through these blockers and validates shots against the same static volumes.
const MAP_OBSTACLES = { district: [], industrial: [], sublevel: [], starfall: [] };

function addBox(list, x, y, z, sx, sy, sz, rotation = 0) {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  const halfX = Math.abs(c) * sx / 2 + Math.abs(s) * sz / 2;
  const halfZ = Math.abs(s) * sx / 2 + Math.abs(c) * sz / 2;
  list.push({
    minX: x - halfX, maxX: x + halfX,
    minY: y - sy / 2, maxY: y + sy / 2,
    minZ: z - halfZ, maxZ: z + halfZ
  });
}

function addShield(list, x, z, rotation = 0) {
  addBox(list, x, 1.05, z, 3.0, 2.15, 1.65, rotation);
}

// DISTRICT — the large habitat shells, arc towers, planters and shields.
{
  const list = MAP_OBSTACLES.district;
  const towers = [
    [-37,-34,4.8,19],[-22,-39,3.5,13],[37,-34,5.2,22],[23,-39,3.6,15],
    [-37,34,5.1,21],[-22,39,3.7,14],[37,34,4.8,19],[23,39,3.5,13]
  ];
  for (const [x,z,r,h] of towers) addBox(list,x,h/2,z,r*2,h,r*2);
  const habitats = [
    [-29,-17,11,8,5],[-7,-33,10,8,5],[29,-17,11,8,5],[7,-33,10,8,5],
    [-29,17,11,8,5],[7,33,10,8,5],[29,17,11,8,5],[-7,33,10,8,5]
  ];
  for (const [x,z,w,d,h] of habitats) addBox(list,x,h/2,z,w,h,d);
  for (const [x,z,r] of [[-18,-18,0],[18,-18,Math.PI/2],[-18,18,-Math.PI/2],[18,18,Math.PI],[-25,-8,0],[25,8,0],[-8,25,0],[8,-25,0],[-40,12,0],[40,-12,0]]) addShield(list,x,z,r);
  for (let i=0;i<20;i++) {
    const x=-43+(i*19)%86, z=-41+((i*31)%82);
    addBox(list,x,.4,z,1.9,.8,1.9);
  }
  for (const [x,z] of [[-14,-35],[14,-35],[-14,35],[14,35],[-42,-15],[42,15],[-42,15],[42,-15]]) {
    addBox(list,x,3.5,z,.36,7,.36);
  }
}

// INDUSTRIAL — walk-in warehouse shells, the reactor, cargo, tanks and gantry supports.
{
  const list = MAP_OBSTACLES.industrial;
  const hangars = [[-34,-31,22,25,13],[34,-31,22,25,14],[-34,31,22,25,12],[34,31,22,25,13]];
  for (const [x,z,w,d,h] of hangars) {
    const face = z < 0 ? 1 : -1;
    const t = .48, doorW = 9, doorH = 5.4, front = z + face*d/2;
    addBox(list,x,h/2,z-face*d/2,w,h,t);
    addBox(list,x-w/2,h/2,z,t,h,d);
    addBox(list,x+w/2,h/2,z,t,h,d);
    const sideW=(w-doorW)/2;
    addBox(list,x-(doorW/2+sideW/2),h/2,front,sideW,h,t);
    addBox(list,x+(doorW/2+sideW/2),h/2,front,sideW,h,t);
    addBox(list,x,doorH+(h-doorH)/2,front,doorW,h-doorH,t);
    for (let zz=-d/2+2.5;zz<d/2-1;zz+=5) {
      for (const side of [-1,1]) addBox(list,x+side*(w/2-1),h/2,z+zz,.24,h-.4,.24);
    }
    for (let sx=-1;sx<=1;sx++) {
      const rackX=x+sx*8;
      addBox(list,rackX,1.5,z,.28,3,.28);
      addBox(list,rackX+2.3,1.5,z,.28,3,.28);
    }
    for (const side of [-1,1]) addBox(list,x+side*(w/2+.35),h/2,z,.6,h+.6,d+.5);
  }

  // Central reactor column.
  addBox(list,0,8.5,-2,12.4,17,12.4);

  // Shipping containers and cargo lanes.
  const cargo = [
    [-18,-20,12,3,0],[-18,-9,9,3,0],[-18,12,12,3,0],
    [18,-20,12,3,0],[18,-8,9,3,0],[18,13,12,3,0],
    [-7,-32,9,3,Math.PI/2],[7,32,9,3,Math.PI/2]
  ];
  for (const [x,z,w,h,rotation] of cargo) addBox(list,x,h/2,z,w,h,2.8,rotation);

  // Elevated walkways: decks, rails and support legs.
  for (const [x,z] of [[-12,-25],[12,25]]) {
    addBox(list,x,2.5,z,3.8,.2,14);
    for (const side of [-1,1]) {
      addBox(list,x+side*1.78,3.02,z,.12,1,14);
      for (let k=-1;k<=1;k++) addBox(list,x+k*1.216,1.25,z,.14,2.5,.14);
    }
  }

  // Vertical storage tanks.
  for (const x of [-27,27]) for (const z of [-12,0,12]) addBox(list,x,3.5,z,4.4,7,4.4);

  // Ground-level equipment stacks.
  for (const [x,z] of [[-12,-13],[12,-13],[-12,14],[12,14],[-40,0],[40,0]]) {
    addBox(list,x,.55,z,3.4,1.1,2.2);
    for (let k=-1;k<=1;k++) addBox(list,x+k*.85,1.5,z,.65,.9,.7);
  }
  for (const [x,z] of [[-8,-12],[8,12],[-31,18],[31,-18],[-10,7],[10,-7]]) addBox(list,x,.72,z,1.44,1.4,1.44);

  // Main gantry legs and low service posts.
  for (const z of [-22,22]) for (const x of [-42,42]) addBox(list,x,8,z,1.1,16,1.1);
  for (const x of [-5,5]) for (const z of [-40,40]) addBox(list,x,4,z,.3,8,.3);

  for (const [x,z,r] of [[-23,0,0],[23,0,Math.PI],[0,-39,Math.PI/2],[0,39,-Math.PI/2]]) addShield(list,x,z,r);
}

// SUBLEVEL — perimeter, segmented cross-walls, central cover and internal pillars.
{
  const list = MAP_OBSTACLES.sublevel;
  const wallX = (z,x1,x2) => { if (x2>x1) addBox(list,(x1+x2)/2,2.38,z,x2-x1,4.76,.46); };
  const wallZ = (x,z1,z2) => { if (z2>z1) addBox(list,x,2.38,(z1+z2)/2,.46,4.76,z2-z1); };
  addBox(list,0,2.7,-24.7,50,5.4,.7);
  addBox(list,0,2.7,24.7,50,5.4,.7);
  addBox(list,-24.7,2.7,0,.7,5.4,50);
  addBox(list,24.7,2.7,0,.7,5.4,50);
  const gapCenters=[-16,0,16],gapHalf=2.35,edge=24.35;
  for (const x of [-9.5,9.5]) {
    let cursor=-edge;
    for (const center of gapCenters) { wallZ(x,cursor,center-gapHalf); cursor=center+gapHalf; }
    wallZ(x,cursor,edge);
  }
  for (const z of [-9.5,9.5]) {
    let cursor=-edge;
    for (const center of gapCenters) { wallX(z,cursor,center-gapHalf); cursor=center+gapHalf; }
    wallX(z,cursor,edge);
  }

  addBox(list,0,.78,0,3.2,1.55,3.2);
  for (const [x,z,rotation] of [[-4.8,-3.2,.12],[4.8,3.2,-.12],[-3.5,5,Math.PI/2],[3.5,-5,Math.PI/2]]) addBox(list,x,.72,z,2.8,1.44,.72,rotation);

  for (const [x,z] of [[-17,-17],[17,-17],[-17,17],[17,17]]) {
    addBox(list,x+(x<0?3.2:-3.2),.72,z,2.1,1.44,1.45);
    addBox(list,x+(x<0?-3.2:3.2),.55,z+(z<0?3:-3),1.25,1.1,1.15);
  }
  for (const [x,z] of [[-20,-11],[20,-11],[-20,11],[20,11],[-11,-20],[11,-20],[-11,20],[11,20]]) addBox(list,x,1.25,z,1.05,2.5,1.05);
  for (const [x,z,sx,sz] of [[-5.8,-9.5,2.6,.42],[5.8,9.5,2.6,.42],[9.5,-5.8,.42,2.6],[-9.5,5.8,.42,2.6]]) addBox(list,x,1.8,z,sx,3.6,sz);

  for (const [x,z] of [[-5,-20],[5,-20],[-5,20],[5,20],[-20,-5],[20,5]]) addBox(list,x,.48,z,1.65,.96,1.05);
}



 // STARFALL — original orbital research complex with three distinct route families.
 {
  const list = MAP_OBSTACLES.starfall = [];
  addBox(list,48.5,3,0,.9,6,99);addBox(list,-48.5,3,0,.9,6,99);
  addBox(list,0,3,48.5,99,6,.9);addBox(list,0,3,-48.5,99,6,.9);
  addBox(list,0,2.8,0,4.8,5.6,4.8);
  for(const [x,z,w,d,h] of [[-31,-29,12,9,5],[-35,-12,8,10,4],[-31,10,12,8,5],[-36,31,9,10,5],[31,-31,13,10,6],[36,-9,8,12,4.5],[31,16,12,9,5],[36,36,8,8,5]]){
    addBox(list,x,h/2,z,w,h,d);
  }
  for(const z of [-39,-24,-8,9,25,40])addBox(list,-23,2.2,z,.45,4.4,5.5);
  for(const z of [-38,-22,-5,13,30,42])addBox(list,23,2.2,z,.45,4.4,5.5);
  for(const x of [-12,12])addBox(list,x,4,-40,.5,8,12);
  addBox(list,0,4,-46,24,8,.45);
  for(const [x,z] of [[-13,34],[-13,42],[13,34],[13,42]])addBox(list,x,1.5,z,7,3,3);
  for(const x of [-20,20])addBox(list,x,3,39,.5,6,18);
  for(const [x,z,rotation] of [[-15,-5,.15],[15,5,-.15],[-15,24,-.2],[15,-24,.2],[-5,37,Math.PI/2],[5,-37,Math.PI/2]])addBox(list,x,.78,z,4.8,1.56,1.35,rotation);
 }


function overlaps(aMin,aMax,bMin,bMax) {
  return aMin < bMax && aMax > bMin;
}

function isPlayerPositionBlocked(map, x, y, z) {
  const obstacles=MAP_OBSTACLES[map] || [];
  const minX=x-.32,maxX=x+.32,minY=y-1.55,maxY=y+.05,minZ=z-.32,maxZ=z+.32;
  return obstacles.some(box =>
    overlaps(minX,maxX,box.minX,box.maxX) &&
    overlaps(minY,maxY,box.minY,box.maxY) &&
    overlaps(minZ,maxZ,box.minZ,box.maxZ)
  );
}

// Sample the whole path, not just its endpoint, to prevent a fast packet from
// tunnelling through a thin wall between two otherwise clear positions.
function movementBlocked(map, from, to) {
  const dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z;
  const distance=Math.hypot(dx,dy,dz);
  const steps=Math.max(1,Math.ceil(distance/.18));
  for (let i=1;i<=steps;i++) {
    const t=i/steps;
    if (isPlayerPositionBlocked(map,from.x+dx*t,from.y+dy*t,from.z+dz*t)) return true;
  }
  return false;
}

function segmentIntersectsBox(from, to, box) {
  let low=0,high=1;
  for (const axis of ['x','y','z']) {
    const start=from[axis],delta=to[axis]-start;
    const min=box['min'+axis.toUpperCase()],max=box['max'+axis.toUpperCase()];
    if (Math.abs(delta)<1e-9) {
      if (start<min || start>max) return false;
      continue;
    }
    let a=(min-start)/delta,b=(max-start)/delta;
    if (a>b) { const swap=a;a=b;b=swap; }
    low=Math.max(low,a);high=Math.min(high,b);
    if (low>high) return false;
  }
  return high>=0 && low<=1;
}

function hasLineOfSight(map, from, to) {
  const obstacles=MAP_OBSTACLES[map] || [];
  return !obstacles.some(box=>segmentIntersectsBox(from,to,box));
}

module.exports = { isPlayerPositionBlocked, movementBlocked, hasLineOfSight };
