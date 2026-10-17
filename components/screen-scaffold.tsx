import { backendStyles } from "@/styles/backend";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = Pick<ScrollViewProps, "contentContainerStyle" | "keyboardShouldPersistTaps"> & {
    children: ReactNode;
    onBack?: () => void;
    busy?: boolean;
    scrollRef?: Ref<ScrollView>;
    edgeToEdge?: boolean;
    title?: string;
};

const BACK_SIZE = 44;

function CircularBack({ onBack, busy = false, compact = false, onLayout }: Pick<Props, "onBack" | "busy"> & {
    compact?: boolean; onLayout?: (event: LayoutChangeEvent) => void;
}) {
    if (compact) return <Pressable accessibilityRole="button" accessibilityLabel="Back"
        accessibilityState={{ disabled: busy }} disabled={busy} onPress={onBack} onLayout={onLayout}
        style={[styles.backTarget, busy && backendStyles.disabled]}>
        {({ pressed }) => <View pointerEvents="none" style={[styles.compactBack, pressed && styles.pressed]}>
            <Ionicons name="chevron-back" size={20} color="#C9472C" allowFontScaling={false}
                accessible={false} importantForAccessibility="no" />
        </View>}
    </Pressable>;
    return <Pressable accessibilityRole="button" accessibilityLabel="Back"
        accessibilityState={{ disabled: busy }} disabled={busy} onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed, busy && backendStyles.disabled]}>
        <Ionicons name="chevron-back" size={22} color="#C9472C" accessible={false} importantForAccessibility="no" />
    </Pressable>;
}

// Compact scrolling titles are opt-in on the two iOS group details. Other screens retain Astra's
// protected viewport. The tab navigator owns the bottom inset in both modes.
export function ScreenScaffold({ children, onBack, busy = false, scrollRef,
    contentContainerStyle, keyboardShouldPersistTaps, edgeToEdge = false, title }: Props) {
    const insets = useSafeAreaInsets();
    if (edgeToEdge && onBack && Platform.OS === "ios") {
        return <EdgeToEdgeScaffold onBack={onBack} busy={busy} scrollRef={scrollRef}
            contentContainerStyle={contentContainerStyle} keyboardShouldPersistTaps={keyboardShouldPersistTaps} title={title}>
            {children}
        </EdgeToEdgeScaffold>;
    }
    const horizontal = { paddingLeft: Math.max(24, insets.left), paddingRight: Math.max(24, insets.right) };
    return <View style={[backendStyles.screen, { paddingTop: insets.top }]}>
        {onBack && <View style={[styles.navigation, horizontal]}>
            <CircularBack onBack={onBack} busy={busy} />
        </View>}
        <ScrollView ref={scrollRef} style={styles.viewport}
            contentContainerStyle={[backendStyles.content, styles.content, contentContainerStyle, horizontal]}
            contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false}
            automaticallyAdjustsScrollIndicatorInsets={false}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}>
            {title !== undefined && <Text style={backendStyles.title}>{title}</Text>}
            {children}
        </ScrollView>
    </View>;
}

function EdgeToEdgeScaffold({ children, onBack, busy, scrollRef,
    contentContainerStyle, keyboardShouldPersistTaps, title }: Props & { onBack: () => void }) {
    const insets = useSafeAreaInsets();
    const [backHeight, setBackHeight] = useState(BACK_SIZE);
    const backTop = insets.top + 4;
    const left = Math.max(24, insets.left), right = Math.max(24, insets.right);
    return <View style={backendStyles.screen}>
        {/* This touch-through container protects only the circular target. */}
        <View pointerEvents="box-none" style={{ position: "absolute", top: backTop, left, right, zIndex: 2 }}>
            <CircularBack compact onBack={onBack} busy={busy} onLayout={event => {
                setBackHeight(Math.max(BACK_SIZE, event.nativeEvent.layout.height));
            }} />
        </View>
        {insets.top > 0 && <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top,
                backgroundColor: "#FFF8F0", zIndex: 1 }} />}
        <ScrollView ref={scrollRef} style={styles.viewport}
            contentContainerStyle={[backendStyles.content, contentContainerStyle, {
                paddingTop: backTop + backHeight + 8,
                paddingLeft: left, paddingRight: right,
            }]}
            contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false}
            automaticallyAdjustsScrollIndicatorInsets={false}
            scrollIndicatorInsets={{ top: insets.top }}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}>
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
    compactBack: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: "#BFA99B",
        backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
    compactTitle: { color: "#2D1F1A", fontSize: 26, fontWeight: "700", marginBottom: 16 },
    viewport: { flex: 1, overflow: "hidden" },
    content: { paddingTop: 12 },
});
