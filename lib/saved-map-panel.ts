export type MapPanelState = "collapsed" | "compact" | "expanded";
export type MapPanelHeights = Record<MapPanelState, number>;

export function panelOffset(state: MapPanelState, heights: MapPanelHeights) {
    return heights.expanded - heights[state];
}
export function clampPanelOffset(offset: number, heights: MapPanelHeights) {
    return Math.max(0, Math.min(panelOffset("collapsed", heights), offset));
}
// Velocity is pixels/ms. Project a short coast, then spring to the closest stop.
export function nearestPanelState(offset: number, velocity: number, heights: MapPanelHeights): MapPanelState {
    const projected = clampPanelOffset(offset + velocity * 180, heights);
    return (["collapsed", "compact", "expanded"] as const).reduce((best, state) =>
        Math.abs(panelOffset(state, heights) - projected) < Math.abs(panelOffset(best, heights) - projected) ? state : best);
}
