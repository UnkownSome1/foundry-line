// Shared material library. Created once; everything references these so the
// static batcher can merge meshes by material.
import * as THREE from 'three';
import * as T from './textures.js';

const std = (o) => new THREE.MeshStandardMaterial(o);
let lib = null;

export function materials() {
  if (lib) return lib;
  const concreteMap = T.concrete();
  const wallMap = T.corrugated('#56707a', { rust: 0.6 });
  const wallBump = T.corrugatedBump(16);
  const roofMap = T.corrugated('#6d7275', { rust: 0.3, rib: 20 });
  const brickMap = T.brick();
  const hazardMap = T.hazard();
  const crateMaps = [
    T.planks([158, 118, 72], { stencil: ['FL-07', 'THIS WAY UP'] }),
    T.planks([140, 104, 64], { stencil: ['PLANT 07', 'LOT 2231'] }),
    T.planks([168, 128, 80], { stencil: ['FRAGILE', 'HANDLE WITH CARE'] }),
  ];
  const woodMap = T.planks([132, 96, 58], { frame: false });
  const chain = T.chainLink();
  chain.repeat.set(1, 1);

  const worldUV = (m, tile) => { m.userData.worldUV = tile; return m; };

  lib = {
    // --- world
    concrete: worldUV(std({ map: concreteMap, roughness: 0.93, metalness: 0 }), 6),
    concreteDark: worldUV(std({ map: concreteMap, color: 0x8a8580, roughness: 0.95 }), 4),
    wallPanel: worldUV(std({ map: wallMap, bumpMap: wallBump, bumpScale: 2.5, roughness: 0.62, metalness: 0.35 }), 3),
    roofPanel: worldUV(std({ map: roofMap, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }), 4),
    brick: worldUV(std({ map: brickMap, roughness: 0.9 }), 2.4),
    hazard: worldUV(std({ map: hazardMap, roughness: 0.7 }), 1.2),
    steelDark: std({ color: 0x3a3f44, roughness: 0.5, metalness: 0.7 }),
    steelBlue: std({ color: 0x3f5a73, roughness: 0.55, metalness: 0.55 }),
    steelYellow: std({ color: 0xd99a1f, roughness: 0.55, metalness: 0.3 }),
    steelGalv: std({ color: 0xb4b9bc, roughness: 0.42, metalness: 0.75 }),
    machineGreen: std({ color: 0x5b7a6c, roughness: 0.55, metalness: 0.35 }),
    rubber: std({ color: 0x1d1e20, roughness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xa9c7d6, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.35, emissive: 0x2a3c48, emissiveIntensity: 0.6, depthWrite: false }),
    skylight: std({ color: 0xcfe1ea, roughness: 0.1, emissive: 0xbad2de, emissiveIntensity: 0.9, side: THREE.DoubleSide }),
    lampOn: std({ color: 0xfff1cf, emissive: 0xffe2a8, emissiveIntensity: 3.2 }),
    ledRed: std({ color: 0xff3b2e, emissive: 0xff2a1a, emissiveIntensity: 2.5 }),
    ledGreen: std({ color: 0x3bff7a, emissive: 0x20ff60, emissiveIntensity: 2.2 }),
    ledAmber: std({ color: 0xffb020, emissive: 0xffa000, emissiveIntensity: 2.2 }),
    crates: crateMaps.map((map) => std({ map, roughness: 0.85 })),
    wood: worldUV(std({ map: woodMap, roughness: 0.85 }), 2),
    timber: std({ color: 0x5e4630, roughness: 0.9 }),
    cardboard: std({ color: 0xb08a5a, roughness: 0.92 }),
    sackWhite: std({ color: 0xd8d2c2, roughness: 0.95 }),
    fence: new THREE.MeshStandardMaterial({ map: chain, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 }),
    beltMap: T.conveyorBelt(),
    // --- nature
    terrain: std({ vertexColors: true, flatShading: true, roughness: 0.95 }),
    bark: std({ color: 0x5a4332, roughness: 0.95, flatShading: true }),
    pine: std({ color: 0xffffff, roughness: 0.9, flatShading: true }),
    leaf: std({ color: 0xffffff, roughness: 0.9, flatShading: true }),
    rock: std({ color: 0xffffff, roughness: 0.92, flatShading: true }),
    grass: std({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }),
  };
  lib.belt = std({ map: lib.beltMap, roughness: 0.9 });
  lib.beltMap.repeat.set(20, 1);
  return lib;
}
