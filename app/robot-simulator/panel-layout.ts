import type { PanelKey, PanelVisibility } from './types';

export const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  plan: true,
  device: false,
  angles: true,
  cartesian: true,
};

export function updatePanelVisibility(current: PanelVisibility, panel: PanelKey, visible: boolean): PanelVisibility {
  if (!visible) return { ...current, [panel]: false };
  if (panel === 'plan') return { ...current, plan: true, device: false };
  if (panel === 'device') return { ...current, plan: false, device: true };
  return { ...current, [panel]: true };
}
