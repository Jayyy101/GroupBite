import { backendStyles } from "@/styles/backend";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = Pick<ScrollViewProps, "contentContainerStyle" | "keyboardShouldPersistTaps" | "keyboardDismissMode" | "automaticallyAdjustKeyboardInsets"> & {
    children: ReactNode;
    onBack?: () => void;
    busy?: boolean;
    scrollRef?: Ref<ScrollView>;
    edgeToEdge?: boolean;
    title?: string;
    includeBottomInset?: boolean;
};

const BACK_SIZE = 44;

function CircularBack({ onBack, busy = false, compact = false, onLayout }: Pick<Props, "onBack" | "busy"> & {
    compact?: boolean; onLayout?: (event: LayoutChangeEvent) => void;
}) {
    if (compact) return <Pressable accessibilityRole="button" accessibilityLabel="Back"
        accessibilityState={{ disabled: busy }} disabled={busy} onPress={onBack} onLayout={onLayout}
        style={styles.backTarget}>
        {({ pressed }) => <View pointerEvents="none" style={[styles.compactBack, pressed && styles.compactPressed]}>
            <Ionicons name="chevron-back" size={20} color={busy ? "#79665E" : "#C9472C"} allowFontScaling={false}
                accessible={false} importantForAccessibility="no" />
        </View>}
    </Pressable>;
    return <Pressable accessibilityRole="button" accessibilityLabel="Back"
        accessibilityState={{ disabled: busy }} disabled={busy} onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed, busy && backendStyles.disabled]}>
        <Ionicons name="chevron-back" size={22} color="#C9472C" accessible={false} importantForAccessibility="no" />
    </Pressable>;
}

// Details/forms opt in to compact edge-to-edge scrolling. Tabs own their bottom
// inset; full-screen forms explicitly include it and use scroll keyboard insets.
export function ScreenScaffold({ children, onBack, busy = false, scrollRef,
    contentContainerStyle, keyboardShouldPersistTaps, keyboardDismissMode, automaticallyAdjustKeyboardInsets,
    includeBottomInset = false, edgeToEdge = false, title }: Props) {
    const insets = useSafeAreaInsets();
    if (edgeToEdge && onBack && Platform.OS === "ios") {
        return <EdgeToEdgeScaffold onBack={onBack} busy={busy} scrollRef={scrollRef}
            contentContainerStyle={contentContainerStyle} keyboardShouldPersistTaps={keyboardShouldPersistTaps} title={title}
            keyboardDismissMode={keyboardDismissMode} automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets} includeBottomInset={includeBottomInset}>
            {children}
        </EdgeToEdgeScaffold>;
    }
    const horizontal = { paddingLeft: Math.max(24, insets.left), paddingRight: Math.max(24, insets.right) };
    return <View style={[backendStyles.screen, { paddingTop: insets.top }]}>
        {onBack && <View style={[styles.navigation, horizontal]}>
            <CircularBack onBack={onBack} busy={busy} />
        </View>}
        <ScrollView ref={scrollRef} style={styles.viewport}
            contentContainerStyle={[backendStyles.content, styles.content, contentContainerStyle, horizontal, includeBottomInset && { paddingBottom: 32 + insets.bottom }]}
            contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false}
            automaticallyAdjustsScrollIndicatorInsets={false}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps} keyboardDismissMode={keyboardDismissMode}
            automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}>
            {title !== undefined && <Text style={backendStyles.title}>{title}</Text>}
            {children}
        </ScrollView>
    </View>;
}

function EdgeToEdgeScaffold({ children, onBack, busy, scrollRef,
    contentContainerStyle, keyboardShouldPersistTaps, keyboardDismissMode, automaticallyAdjustKeyboardInsets, includeBottomInset, title }: Props & { onBack: () => void }) {
    const insets = useSafeAreaInsets();
    const [backHeight, setBackHeight] = useState(BACK_SIZE);
    const backTop = insets.top + 4;
    const initialContentTop = backTop + backHeight + 8;
    const left = Math.max(24, insets.left), right = Math.max(24, insets.right);
    return <View style={backendStyles.screen}>
        {/* Only Back intercepts touches; content scrolls beneath it and the status area. */}
        <View pointerEvents="box-none" style={{ position: "absolute", top: backTop, left, right, zIndex: 2 }}>
            <CircularBack compact onBack={onBack} busy={busy} onLayout={event => {
                setBackHeight(Math.max(BACK_SIZE, event.nativeEvent.layout.height));
            }} />
        </View>
        <ScrollView ref={scrollRef} style={styles.viewport}
            contentContainerStyle={[backendStyles.content, contentContainerStyle, {
                paddingTop: initialContentTop,
                paddingLeft: left, paddingRight: right,
                ...(includeBottomInset ? { paddingBottom: 32 + insets.bottom } : {}),
            }]}
            contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false}
            automaticallyAdjustsScrollIndicatorInsets={false}
            scrollIndicatorInsets={{ top: insets.top }}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps} keyboardDismissMode={keyboardDismissMode}
            automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}>
            {title !== undefined && <Text accessibilityRole="header" style={styles.compactTitle}>{title}</Text>}
            {children}
        </ScrollView>
    </View>;
}

const styles = StyleSheet.create({
    navigation: { height: 48, justifyContent: "center" },
    back: { width: BACK_SIZE, height: BACK_SIZE, borderRadius: BACK_SIZE / 2, borderWidth: 1, borderColor: "#BFA99B",
        backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
    pressed: { backgroundColor: "#F3E7DC" },
    backTarget: { width: BACK_SIZE, height: BACK_SIZE, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
    compactBack: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: "rgba(191,169,155,0.6)",
        backgroundColor: "rgba(255,248,240,0.88)", alignItems: "center", justifyContent: "center",
        shadowColor: "#2D1F1A", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4 },
    compactPressed: { backgroundColor: "rgba(243,231,220,0.94)" },
    compactTitle: { color: "#2D1F1A", fontSize: 26, fontWeight: "700", marginBottom: 16 },
    viewport: { flex: 1, overflow: "hidden" },
    content: { paddingTop: 12 },
});
