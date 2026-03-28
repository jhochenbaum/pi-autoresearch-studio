export const BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export const COL_WIDTHS = {
  run: 5,
  status: 12,
  metric: 12,
  delta: 9,
  conf: 8,
  commit: 9,
  pr: 5,
} as const;

export const CHART = {
  yAxisWidth: 8,
  minHeight: 6,
  maxHeight: 10,
} as const;

export const MAX_DIVIDER_WIDTH = 120;

export const PLAN_VIEWER = {
  footerHeight: 2,
  scrollStep: 3,
} as const;
