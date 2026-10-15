// Sheet numbers in drawing order: the main descent, with side sheets for the display,
// power, memory and storage where they branch off the machine.
export const N = {
  machine: 1,
  display: 2,
  chassis: 3,
  power: 4,
  board: 5,
  memory: 6,
  storage: 7,
  package: 8,
  die: 9,
  core: 10,
  logic: 11,
  transistor: 12,
  lattice: 13,
} as const;

/**
 * What each sheet is drawn inside: a zoom into sheet n starts from the part of PARENT[n] it lives in.
 * Sheets not related this way (display beside chassis, memory beside storage) zoom out and back in.
 */
export const PARENT: Record<number, number> = {
  [N.display]: N.machine,
  [N.chassis]: N.machine,
  [N.power]: N.chassis,
  [N.board]: N.chassis,
  [N.memory]: N.board,
  [N.storage]: N.board,
  [N.package]: N.board,
  [N.die]: N.package,
  [N.core]: N.die,
  [N.logic]: N.core,
  [N.transistor]: N.logic,
  [N.lattice]: N.transistor,
};
