import { clampPanelOffset, nearestPanelState, panelOffset, type MapPanelHeights, type MapPanelState } from "@/lib/saved-map-panel";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

export default function SavedMapPanel({ state, onChange, heights, title, subtitle, children }: {
    state: MapPanelState; onChange: (state: MapPanelState) => void; heights: MapPanelHeights;
    title: string; subtitle: string; children: ReactNode;
}) {
    const translation = useRef(new Animated.Value(panelOffset(state, heights))).current;
    const current = useRef({ state, onChange, heights }); current.current = { state, onChange, heights };
    const start = useRef(0), offset = useRef(panelOffset(state, heights));
    const [dragging, setDragging] = useState(false);
    const targetOffset = panelOffset(state, heights);
    function snap(next: MapPanelState) {
        const value = panelOffset(next, current.current.heights);
        current.current.onChange(next);
        Animated.spring(translation, { toValue: value, useNativeDriver: true, damping: 29, stiffness: 300, mass: 1,
            overshootClamping: true }).start();
    }
    useEffect(() => {
        const subscription = translation.addListener(({ value }) => { offset.current = value; });
        return () => { translation.removeListener(subscription); translation.stopAnimation(); };
    }, [translation]);
    useEffect(() => {
        Animated.spring(translation, { toValue: targetOffset, useNativeDriver: true,
            damping: 29, stiffness: 300, mass: 1, overshootClamping: true }).start();
    }, [translation, targetOffset]);
    const [gesture] = useState(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => { setDragging(true); start.current = offset.current; translation.stopAnimation(value => { start.current = value; }); },
        onPanResponderMove: (_, g) => translation.setValue(clampPanelOffset(start.current + g.dy, current.current.heights)),
        onPanResponderRelease: (_, g) => { setDragging(false); snap(nearestPanelState(start.current + g.dy, g.vy, current.current.heights)); },
        onPanResponderTerminate: () => { setDragging(false); snap(nearestPanelState(offset.current, 0, current.current.heights)); },
        onPanResponderTerminationRequest: () => false,
    }));
    const collapsed = state === "collapsed";
    return <View pointerEvents="box-none" style={[s.clip, { height: heights.expanded }]}>
        <Animated.View style={[s.sheet, { height: heights.expanded, transform: [{ translateY: translation }] }]}>
            <View {...gesture.panHandlers} style={[s.handle, { height: heights.collapsed }]}>
                <View style={s.grabber} />
                <View style={s.heading}>
                    <Pressable accessibilityRole="adjustable" accessibilityLabel="Restaurant panel"
                        accessibilityValue={{ text: state }} accessibilityHint={`${title}. ${subtitle}. Drag the handle, or use expand and collapse actions.`}
                        accessibilityActions={[{ name: "increment", label: "Expand" }, { name: "decrement", label: "Collapse" }]}
                        onAccessibilityAction={e => snap(e.nativeEvent.actionName === "increment" ? state === "collapsed" ? "compact" : "expanded" : state === "expanded" ? "compact" : "collapsed")}
                        onPress={() => snap(collapsed ? "compact" : state === "compact" ? "expanded" : "compact")} style={s.toggle}>
                        <View style={s.headingText}><Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={s.title}>{collapsed ? "Browse saved restaurants" : title}</Text>
                            <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={s.subtitle}>{subtitle}</Text></View>
                        <Ionicons name={state === "expanded" ? "chevron-down" : "chevron-up"} size={19} color="#655047" accessible={false} />
                    </Pressable>
                    {!collapsed && <Pressable accessibilityRole="button" accessibilityLabel="Dismiss restaurant panel" onPress={() => snap("collapsed")} style={s.close}>
                        <Ionicons name="close" size={21} color="#655047" accessible={false} />
                    </Pressable>}
                </View>
            </View>
            <View style={[s.body, { height: Math.max(0, (dragging ? heights.expanded : heights[state]) - heights.collapsed) }]} pointerEvents={collapsed ? "none" : "auto"} accessibilityElementsHidden={collapsed} importantForAccessibility={collapsed ? "no-hide-descendants" : "auto"}>
                {children}
            </View>
        </Animated.View>
    </View>;
}
const s = StyleSheet.create({
    clip: { position: "absolute", bottom: 10, left: 10, right: 10, overflow: "hidden", borderRadius: 25 },
    sheet: { backgroundColor: "#FFFAF5", borderRadius: 25, borderWidth: 1.5, borderColor: "#C5A994",
        shadowColor: "#342016", shadowOpacity: 0.24, shadowRadius: 14, shadowOffset: { width: 0, height: 2 } },
    handle: { minHeight: 74, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#DCC8B9", paddingBottom: 7 },
    grabber: { width: 38, height: 5, borderRadius: 3, backgroundColor: "#9B8272", alignSelf: "center", marginTop: 8, marginBottom: 3 },
    heading: { flexDirection: "row", alignItems: "center", paddingLeft: 17, paddingRight: 8 },
    toggle: { flex: 1, minHeight: 49, flexDirection: "row", alignItems: "center", gap: 9 },
    headingText: { flex: 1, gap: 3 }, title: { fontSize: 17, lineHeight: 22, fontWeight: "700", color: "#302018" },
    subtitle: { fontSize: 12, lineHeight: 16, fontWeight: "500", color: "#655047" },
    close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, body: { overflow: "hidden" },
});
