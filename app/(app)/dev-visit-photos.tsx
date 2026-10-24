// Local visual acceptance harness. No Storage calls, save RPCs or upload jobs.
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { PhotoGallery, PhotoPreviewStrip, PhotoSelection, photoStyles } from "@/components/visit-photos";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { SelectedPhoto } from "@/types/visit-photos";

const samples = [require("@/assets/phase-g-preview/table.jpg"), require("@/assets/phase-g-preview/pizza.jpg"), require("@/assets/phase-g-preview/restaurant.jpg")]
    .map((image, index) => ({ id: `sample-${index}`, image, thumbnail: image }));
export default function VisitPhotoPreview() {
    const { session } = useAuth(), focused = useIsFocused(), { isActive } = useForegroundRefresh(), router = useRouter();
    const [gallery, setGallery] = useState<number | null>(null), [confirm, setConfirm] = useState(false), [removed, setRemoved] = useState(false);
    const [photos, setPhotos] = useState<SelectedPhoto[]>([]), [busy, setBusy] = useState(false), [shared, setShared] = useState(false);
    const alive = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => { if (!focused || !isActive) { setGallery(null); setConfirm(false); } }, [focused, isActive]);
    if (!__DEV__ || !session || !focused || !isActive) return null;
    const canOperate = () => focused && AppState.currentState === "active";
    return <ScreenScaffold edgeToEdge title="Photo preview" onBack={() => router.canGoBack() ? router.back() : router.replace("/add")} busy={busy}>
        <Text style={styles.contextLabel}>Design preview · Device only</Text>
        <Text style={styles.message}>Sample photos. No visits or photos are uploaded here.</Text>
        <View style={styles.card}>
            <Text style={styles.contextLabel}>My Places · Private</Text>
            <Text style={styles.cardTitle}>A slow Sunday lunch</Text>
            <Text style={styles.message}>October 22, 2026 · ★ 5 · Would go again</Text>
            <View style={photoStyles.section}><Text style={photoStyles.eyebrow}>VISIT PHOTOS · 3</Text>
                {!removed && <PhotoPreviewStrip photos={samples} onOpen={setGallery} />}
                {removed && <Text style={photoStyles.copy}>Sample photo removed from this preview.</Text>}
                <Text style={photoStyles.privacy}>Only you can see these photos.</Text>
            </View>
        </View>
        <PhotoSelection userId={session.user.id} photos={photos} onChange={setPhotos} disabled={busy} canOperate={canOperate} canRetain={() => alive.current} onBusyChange={setBusy} />
        <Text style={styles.label}>Where should these photos go?</Text>
        <Text style={styles.message}>My Places keeps a private copy. Sharing with each group is your choice.</Text>
        <Pressable accessibilityRole="checkbox" accessibilityLabel="Share sample photos with Dinner Club" accessibilityState={{ checked: shared }}
            style={[styles.card, styles.destinationCard, shared && styles.destinationSelected]} onPress={() => setShared(v => !v)}>
            <Text style={[styles.cardTitle, styles.cardHeadingText]}>Share photos with Dinner Club</Text><Text style={styles.secondaryText}>{shared ? "✓" : "○"}</Text>
        </Pressable>
        <Text style={styles.message}>Each destination gets its own attachment. Removing a photo later affects only that visit.</Text>
        {gallery !== null && <PhotoGallery photos={samples} index={gallery} onIndex={index => { setGallery(index); setConfirm(false); }} onClose={() => setGallery(null)}
            canManage busy={false} confirmRemove={confirm} onAskRemove={() => setConfirm(true)} onCancelRemove={() => setConfirm(false)}
            onRemove={() => { setRemoved(true); setGallery(null); setConfirm(false); }} />}
    </ScreenScaffold>;
}
