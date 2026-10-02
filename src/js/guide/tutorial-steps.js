import { FINISH_TUTORIAL_STEPS } from './tutorial-steps-finish.js';
import { MATERIAL_TUTORIAL_STEPS } from './tutorial-steps-materials.js';
import { PHOTO_TUTORIAL_STEPS } from './tutorial-steps-photos.js';
import { OUTPUT_TUTORIAL_STEPS } from './tutorial-steps-output.js';

export const TUTORIAL_STEPS = [
  ...FINISH_TUTORIAL_STEPS,
  ...MATERIAL_TUTORIAL_STEPS,
  ...PHOTO_TUTORIAL_STEPS,
  ...OUTPUT_TUTORIAL_STEPS
];
