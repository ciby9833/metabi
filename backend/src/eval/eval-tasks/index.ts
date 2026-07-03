/**
 * 所有 EvalTask 在这聚合导出。新增分类直接 import + 拼数组。
 */
import { EvalTask } from '../types';
import { DATASET_MODE_TASKS } from './dataset-mode';
import { DATASET_STRESS_TASKS } from './dataset-stress';

export const ALL_EVAL_TASKS: EvalTask[] = [
  ...DATASET_MODE_TASKS,
  ...DATASET_STRESS_TASKS,
];

/** 仅 stress 集 — npm run eval -- --suite=stress */
export const STRESS_EVAL_TASKS = DATASET_STRESS_TASKS;
