// Headless checks for the bounded reinforcement learner used by the brain lab.

import { RewardSkillTrainer, SKILL_ACTIONS } from '../src/skilltrainer.js';

let seed = 123456789;
const rng = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const trainer = new RewardSkillTrainer({ rng });
for (let i = 0; i < 700; i++) trainer.trainEpisode('escape');
const learned = trainer.policy('loomCenter', '正面威胁逃生');

if (learned.action !== 'escape') throw new Error(`Expected escape, learned ${learned.action}`);
if (learned.confidence < 0.85) throw new Error(`Confidence too low: ${learned.confidence}`);
if (learned.recentAccuracy < 0.85) throw new Error(`Recent accuracy too low: ${learned.recentAccuracy}`);
if (Object.keys(learned.actionValues).length !== SKILL_ACTIONS.length) throw new Error('Missing action values');

trainer.reset();
if (trainer.episodes !== 0 || trainer.values.some((value) => value !== 0)) throw new Error('Reset failed');

console.log(`PASS skill trainer learns rewarded escape policy: confidence ${(learned.confidence * 100).toFixed(1)}%, recent accuracy ${(learned.recentAccuracy * 100).toFixed(1)}%`);
