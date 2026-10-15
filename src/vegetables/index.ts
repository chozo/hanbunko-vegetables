import { broccoli } from './broccoli';
import { cabbage } from './cabbage';
import { corn } from './corn';
import type { VegDef } from './common';
import { daikon } from './daikon';
import { eggplant } from './eggplant';
import { hakusai } from './hakusai';
import { onion } from './onion';
import { pepper } from './pepper';
import { potato } from './potato';
import { pumpkin } from './pumpkin';

/** ステージ順 */
export const VEGETABLES: VegDef[] = [eggplant, pumpkin, potato, cabbage, pepper, onion, hakusai, corn, daikon, broccoli];
