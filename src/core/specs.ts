// The two machines on the bench. Outside dimensions, ports, chargers and cooling follow two real
// laptops (named in `reference`); power, chip and memory figures are typical values for their class.
import type { Arch } from './state';

export type PortKind = 'usbc' | 'usba' | 'hdmi' | 'rj45' | 'sd' | 'microsd' | 'audio' | 'dc' | 'led';

// Reference classes, measured from review photographs: a 16-inch Snapdragon X laptop in the style of
// a Galaxy Book4 Edge 16, and a 16-inch RTX gaming laptop in the style of a ROG Strix SCAR 16 (2025).

export interface Port {
  kind: PortKind;
  /** distance from the rear edge of the base, mm, measured from review photographs */
  z: number;
  label: string;
}

export interface MachineSpec {
  name: string;
  /** the real laptop the drawing is modelled on: named only to identify it, no markings reproduced */
  reference: string;
  short: string;
  w: number; // mm
  d: number;
  h: number; // closed, at the thickest point
  lidT: number;
  massKg: number;
  displayIn: number;
  displayPx: [number, number];
  displayHz: number;
  displayTech: 'oled' | 'miniled';
  displayNits: number;
  /** typical pixel response, ms (OLED black to white; LCD grey to grey) */
  pixelMs: number;
  /** panel power at full brightness on a white screen, W */
  backlightW: number;
  batteryWh: number;
  cells: number;
  packV: number;
  cellConfig: string;
  /** fastest charge rate the pack accepts, W */
  chargeMaxW: number;
  /** size: length along the lead, height, width (mm) */
  charger: { watts: number; kind: string; volts: number; amps: number; size: [number, number, number] };
  keyTravel: number;
  numpad: boolean;
  fans: number;
  cooling: string;
  soc: string;
  cores: string;
  memory: string;
  memBW: number; // GB/s
  memLatencyNs: number;
  ssd: string;
  ssdGBs: number;
  ssdLatencyUs: number;
  transistorsB: number;
  dieMm2: number;
  node: string;
  gpu: string;
  ports: string;
  left: Port[];
  right: Port[];
  /** platform power with the display off and nothing running, W */
  idleW: number;
  speakers: string;
  camera: string;
}

export const SPEC: Record<Arch, MachineSpec> = {
  arm: {
    name: 'ARM laptop, 16-inch',
    reference: 'Samsung Galaxy Book4 Edge 16 (2024, Snapdragon X Elite X1E-84-100)',
    short: 'ARM · 16″ ultrabook',
    w: 355.4,
    d: 250.4,
    h: 12.3,
    lidT: 4.6,
    massKg: 1.545,
    displayIn: 16.0,
    displayPx: [2880, 1800],
    displayHz: 120,
    displayTech: 'oled',
    displayNits: 500,
    pixelMs: 0.7,
    backlightW: 7.0,
    batteryWh: 61.8,
    cells: 4,
    packV: 15.48,
    cellConfig: '4 lithium-ion pouch cells in series (4S), 3,979 mAh',
    chargeMaxW: 50,
    charger: { watts: 65, kind: '65 W wall charger with Europlug pins and a USB-C socket, USB Power Delivery', volts: 20, amps: 3.25, size: [48, 27, 50] },
    keyTravel: 1.2,
    numpad: true,
    fans: 1,
    cooling: 'one quiet fan, one heat pipe and a copper spreader',
    soc: 'ARM SoC, Snapdragon X class, 4 nm',
    cores: '12 performance cores in 3 clusters of 4',
    memory: '16 GB LPDDR5X-8448, soldered beside the SoC',
    memBW: 135,
    memLatencyNs: 102,
    ssd: '512 GB or 1 TB M.2 2230 NVMe SSD, PCIe 4.0 ×4',
    ssdGBs: 6.0,
    ssdLatencyUs: 60,
    transistorsB: 20,
    dieMm2: 170,
    node: 'N4-class FinFET',
    gpu: 'integrated, 4.6 TFLOPS',
    ports: 'HDMI 2.1, 2 × USB4 Type-C on the left; microSD, USB-A, 3.5 mm audio on the right',
    left: [
      { kind: 'hdmi', z: 23, label: 'HDMI 2.1, 4K at 60 Hz' },
      { kind: 'usbc', z: 45, label: 'USB4 40 Gbit/s, DisplayPort, charging' },
      { kind: 'usbc', z: 63, label: 'USB4 40 Gbit/s, DisplayPort, charging' },
      { kind: 'led', z: 74, label: 'Charge indicator' },
    ],
    right: [
      { kind: 'audio', z: 18.5, label: '3.5 mm headphone and microphone' },
      { kind: 'usba', z: 46, label: 'USB-A 3.2 Gen 1, 5 Gbit/s' },
      { kind: 'microsd', z: 65, label: 'microSD card reader' },
    ],
    idleW: 2.0,
    speakers: '4 speakers: 2 woofers, 2 tweeters',
    camera: '1080p camera and an ambient light sensor',
  },
  x86: {
    name: 'x86 gaming laptop, 16-inch',
    reference: 'ASUS ROG Strix SCAR 16 (2025, G635LX: Core Ultra 9 275HX, GeForce RTX 5090 Laptop)',
    short: 'x86 · 16″ gaming',
    w: 354.0,
    d: 268.0,
    h: 30.8,
    lidT: 6.4,
    massKg: 2.78,
    displayIn: 16.0,
    displayPx: [2560, 1600],
    displayHz: 240,
    displayTech: 'miniled',
    displayNits: 1200,
    pixelMs: 5,
    backlightW: 18,
    batteryWh: 90,
    cells: 4,
    packV: 15.52,
    cellConfig: '4 lithium-polymer pouch cells in series (4S), 5,800 mAh',
    chargeMaxW: 100,
    charger: { watts: 380, kind: '380 W adapter, 180 × 82 × 31 mm and 835 g, with a slim rectangular plug and a C13 mains cord', volts: 20, amps: 19, size: [180, 31, 82] },
    keyTravel: 1.9,
    numpad: false,
    fans: 3,
    cooling: 'vapor chamber over CPU and GPU, three fans, liquid metal on the CPU',
    soc: 'x86 HX processor, 24 cores, tiled, N3-class compute tile',
    cores: '8 performance + 16 efficiency cores',
    memory: '32 GB DDR5-5600 in two SO-DIMM slots',
    memBW: 89.6,
    memLatencyNs: 115,
    ssd: '2 TB NVMe SSD, PCIe 4.0 ×4, second M.2 slot free',
    ssdGBs: 7.0,
    ssdLatencyUs: 60,
    transistorsB: 18,
    dieMm2: 243,
    node: 'N3-class FinFET (compute tile)',
    gpu: 'discrete RTX-class GPU, 24 GB GDDR7 on a 256-bit bus, up to 175 W',
    ports: 'DC-in, 2.5 GbE, HDMI 2.1, USB-A, 2 × Thunderbolt 5, audio on the left; 2 × USB-A on the right',
    left: [
      { kind: 'dc', z: 55, label: 'DC-in, 380 W slim plug' },
      { kind: 'rj45', z: 76, label: 'RJ45, 2.5 Gbit Ethernet' },
      { kind: 'hdmi', z: 116, label: 'HDMI 2.1 FRL' },
      { kind: 'usba', z: 137, label: 'USB-A 3.2 Gen 2, 10 Gbit/s' },
      { kind: 'usbc', z: 158, label: 'Thunderbolt 5, 80 Gbit/s (120 boost), power delivery' },
      { kind: 'usbc', z: 173, label: 'Thunderbolt 5, 80 Gbit/s (120 boost), DisplayPort' },
      { kind: 'audio', z: 186, label: '3.5 mm audio' },
    ],
    right: [
      { kind: 'usba', z: 187, label: 'USB-A 3.2 Gen 2, 10 Gbit/s' },
      { kind: 'usba', z: 217, label: 'USB-A 3.2 Gen 2, 10 Gbit/s' },
    ],
    idleW: 9,
    speakers: '4 speakers with smart amplifiers',
    camera: '1080p camera with IR',
  },
};
