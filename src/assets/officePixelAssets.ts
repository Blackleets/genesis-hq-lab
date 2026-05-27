const BASE = '/assets/free-office-pixel-art';

export const officeAssets = {
  characters: {
    boss: `${BASE}/boss.png`,
    worker1: `${BASE}/worker1.png`,
    worker2: `${BASE}/worker2.png`,
    worker4: `${BASE}/worker4.png`,
    julia: `${BASE}/Julia.png`,
    juliaIdle: `${BASE}/Julia-Idle.png`,
    juliaPc: `${BASE}/Julia_PC.png`,
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
    printer: `${BASE}/printer.png`,
    sink: `${BASE}/sink.png`,
    stampingTable: `${BASE}/stamping-table.png`,
    trash: `${BASE}/Trash.png`,
    waterCooler: `${BASE}/water-cooler.png`,
    writingTable: `${BASE}/writing-table.png`,
  },
  office: {
    partition1: `${BASE}/office-partitions-1.png`,
    partition2: `${BASE}/office-partitions-2.png`,
  },
  animations: {
    juliaWalkForward: `${BASE}/Julia_walk_Foward.png`,
    juliaWalkLeft: `${BASE}/Julia_walk_Left.png`,
    juliaWalkRight: `${BASE}/Julia_walk_Rigth.png`,
    juliaWalkUp: `${BASE}/Julia_walk_Up.png`,
    juliaDrinkingCoffee: `${BASE}/Julia_Drinking_Coffee.png`,
  },
} as const;

export type OfficeAssets = typeof officeAssets;
