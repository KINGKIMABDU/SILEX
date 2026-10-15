import type { Sheet } from '../core/sheet';
import { MachineSheet } from './s1-machine';
import { ChassisSheet } from './s3-chassis';
import { DisplaySheet } from './s2-display';
import { PowerSheet } from './s4-power';
import { MemorySheet } from './s6-memory';
import { StorageSheet } from './s7-storage';
import { BoardSheet } from './s5-board';
import { PackageSheet } from './s8-package';
import { DieSheet } from './s9-die';
import { CoreSheet } from './s10-core';
import { LogicSheet } from './s11-logic';
import { TransistorSheet } from './s12-transistor';
import { LatticeSheet } from './s13-lattice';

type SheetCtor = new () => Sheet;

export const SHEETS: SheetCtor[] = [MachineSheet, DisplaySheet, ChassisSheet, PowerSheet, BoardSheet, MemorySheet, StorageSheet, PackageSheet, DieSheet, CoreSheet, LogicSheet, TransistorSheet, LatticeSheet];
