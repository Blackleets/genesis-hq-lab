const BASE = '/assets/free-office-pixel-art';

export const pixelSpriteMap = {
  characters: {
    boss: `${BASE}/boss.png`,
    worker1: `${BASE}/worker1.png`,
    worker2: `${BASE}/worker2.png`,
    worker4: `${BASE}/worker4.png`,
    juliaIdle: `${BASE}/Julia-Idle.png`,
    juliaPc: `${BASE}/Julia_PC.png`,
    juliaWalkForward: `${BASE}/Julia_walk_Foward.png`,
    juliaWalkLeft: `${BASE}/Julia_walk_Left.png`,
    juliaWalkRight: `${BASE}/Julia_walk_Rigth.png`,
    juliaWalkUp: `${BASE}/Julia_walk_Up.png`,
  },
  furniture: {
    desk: `${BASE}/desk.png`,
    deskWithPc: `${BASE}/desk-with-pc.png`,
    chair: `${BASE}/Chair.png`,
    pc1: `${BASE}/PC1.png`,
    pc2: `${BASE}/PC2.png`,
    plant: `${BASE}/plant.png`,
    cabinet: `${BASE}/cabinet.png`,
    coffeeMaker: `${BASE}/coffee-maker.png`,
    waterCooler: `${BASE}/water-cooler.png`,
    partitions1: `${BASE}/office-partitions-1.png`,
    partitions2: `${BASE}/office-partitions-2.png`,
    printer: `${BASE}/printer.png`,
    trash: `${BASE}/Trash.png`,
    writingTable: `${BASE}/writing-table.png`,
  },
} as const;

export type PixelSpriteMap = typeof pixelSpriteMap;
