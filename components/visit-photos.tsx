import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, type ImageSource } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { listVisitPhotos, photoImageSource, removeVisitPhoto } from "@/lib/visit-photos";
import { MAX_PHOTO_SELECTION, MAX_VISIT_PHOTOS, photoFile, selectVisitPhotos } from "@/lib/visit-photo-files";
import { usePhotoJobs } from "@/providers/visit-photos";
import { backendStyles as styles } from "@/styles/backend";
import type { PhotoTarget, SelectedPhoto, VisitPhoto } from "@/types/visit-photos";

export function PhotoSelection({ userId, photos, onChange, disabled, canOperate, canRetain, onBusyChange }: {
    userId: string; photos: SelectedPhoto[]; onChange: (photos: SelectedPhoto[]) => void;
    disabled: boolean; canOperate: () => boolean; canRetain: () => boolean; onBusyChange: (busy: boolean) => void;
}) {
    const [error, setError] = useState("");
    const lock = useRef(false), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    async function choose() {
        if (disabled || lock.current || !canOperate()) return;
        lock.current = true; onBusyChange(true); setError("");
        try {
            const selected = await selectVisitPhotos(userId, MAX_PHOTO_SELECTION - photos.length);
            // A system picker can return while React still considers the app
            // inactive. Retain only in the initiating account/form controller;
            // that controller lives above the disposable private visibility gate.
            if (canRetain()) onChange([...photos, ...selected]);
        } catch { if (alive.current && canOperate()) setError("Could not open these photos. Try choosing them again."); }
        finally { lock.current = false; if (canRetain()) onBusyChange(false); }
    }
    return <View style={photoStyles.selection}>
        <View style={photoStyles.heading}><Ionicons name="images-outline" color="#C9472C" size={24} /><Text style={photoStyles.title}>A little more of the memory</Text></View>
        <Text style={photoStyles.copy}>Add up to {MAX_PHOTO_SELECTION} photos. Your visit saves first; photos follow.</Text>
        {!!photos.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={photoStyles.strip}>
            {photos.map((photo, index) => <View key={photo.id}>
                <Image source={{ uri: photoFile(userId, photo.thumbnail).uri }} style={photoStyles.draft} cachePolicy="none" accessibilityLabel={`Selected photo ${index + 1}`} />
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove selected photo ${index + 1}`} disabled={disabled} style={photoStyles.removeDraft}
                    onPress={() => { if (canOperate()) onChange(photos.filter(p => p.id !== photo.id)); }}><Ionicons name="close" size={19} color="#fff" /></Pressable>
            </View>)}
        </ScrollView>}
        <Pressable accessibilityRole="button" disabled={disabled || photos.length >= MAX_PHOTO_SELECTION} onPress={choose}
            style={[photoStyles.add, (disabled || photos.length >= MAX_PHOTO_SELECTION) && styles.disabled]}>
            <Ionicons name="add" color="#C9472C" size={23} /><Text style={photoStyles.action}>{photos.length ? "Choose more photos" : "Choose photos"}</Text>
        </Pressable>
        {!!error && <Text style={styles.error}>{error}</Text>}
    </View>;
}

export function PhotoRecovery({ canOperate }: { canOperate: () => boolean }) {
    const jobs = usePhotoJobs();
    if (!jobs) return null;
    const pending = jobs.jobs.filter(j => j.status !== "done");
    if (!pending.length && !jobs.error) return null;
    return <View style={photoStyles.recovery}>
        <Text style={photoStyles.title}>Photos to finish</Text>
        <Text style={photoStyles.copy}>{pending.length} photo attachment{pending.length === 1 ? "" : "s"} retained on this device. Visits save independently. Checking never resubmits a visit.</Text>
        <Text style={photoStyles.copy}>Continue uses your original sharing choices and the same photo identities. Earlier uploads may still finish.</Text>
        {!!jobs.error && <Text style={styles.error}>{jobs.error}</Text>}
        <Pressable accessibilityRole="button" disabled={jobs.busy || !jobs.ready || !!jobs.error} style={styles.secondaryButton}
            onPress={() => { void jobs.run(canOperate, "check"); }}><Text style={styles.secondaryText}>{jobs.busy ? "Checking photos…" : "Check saved photos"}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={jobs.busy || !jobs.ready || !!jobs.error} style={styles.primaryButton}
            onPress={() => { void jobs.run(canOperate, "continue"); }}><Text style={styles.primaryText}>Continue photo uploads</Text></Pressable>
    </View>;
}

type DisplayPhoto = VisitPhoto & { thumbnail: ImageSource; image: ImageSource };
export function PhotoPreviewStrip({ photos, onOpen, disabled = false }: {
    photos: { id: string; thumbnail: ImageSource }[]; onOpen: (index: number) => void; disabled?: boolean;
}) {
    return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={photoStyles.strip}>
        {photos.map((photo, index) => <Pressable key={photo.id} accessibilityRole="button" accessibilityLabel={`Open visit photo ${index + 1} of ${photos.length}`}
            disabled={disabled} onPress={() => onOpen(index)}>
            <Image source={photo.thumbnail} style={photoStyles.preview} contentFit="cover" cachePolicy="none" transition={150} />
            <View style={photoStyles.expand}><Ionicons name="expand-outline" size={16} color="white" /></View>
        </Pressable>)}
    </ScrollView>;
}
export function VisitPhotoSection({ userId, target, canManage, disabled = false, onBusyChange }: {
    userId: string; target: PhotoTarget; canManage: boolean; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
    const jobs = usePhotoJobs(), focused = useIsFocused(), { isActive, version } = useForegroundRefresh();
    const key = JSON.stringify([userId, target]);
    const [photos, setPhotos] = useState<DisplayPhoto[]>([]), [pendingPhotos, setPendingPhotos] = useState<VisitPhoto[]>([]);
    const pending = pendingPhotos.length;
    const [error, setError] = useState(""), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
    const [gallery, setGallery] = useState<number | null>(null), [confirmRemove, setConfirmRemove] = useState(false), [busy, setBusy] = useState(false);
    const alive = useRef(false), lock = useRef(false), epoch = useRef(0), loaded = useRef(false);
    const notifyBusy = useRef(onBusyChange); notifyBusy.current = onBusyChange;
    const availability = useRef(false); availability.current = focused && isActive;
    const identity = useRef(key); identity.current = key;
    const current = () => alive.current && identity.current === key && availability.current && AppState.currentState === "active";
    const leave = useLeaveGuard({ userId, dirty: false, busy });
    useEffect(() => {
        alive.current = true;
        const off = AppState.addEventListener("change", state => { if (state !== "active") { epoch.current++; loaded.current = false; setGallery(null); setConfirmRemove(false); setPhotos([]); } });
        // This is a request generation, not a native element reference.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        return () => { alive.current = false; epoch.current++; off.remove(); if (lock.current) notifyBusy.current?.(false); };
    }, []);
    useEffect(() => {
        const generation = ++epoch.current;
        setPhotos([]); setGallery(null); setConfirmRemove(false); setLoading(true); loaded.current = false;
        if (!focused || !isActive) return;
        void (async () => {
            try {
                const rows = await listVisitPhotos(userId, target);
                const display = await Promise.all(rows.filter(p => p.state === "ready").map(async p => ({ ...p,
                    thumbnail: await photoImageSource(userId, p.thumbnail_path), image: await photoImageSource(userId, p.image_path) })));
                if (current() && epoch.current === generation) { setPhotos(display); setPendingPhotos(rows.filter(p => p.state === "pending")); setError(""); loaded.current = true; }
            } catch (error) { if (current() && epoch.current === generation) setError(error instanceof Error ? error.message : "Photos unavailable."); }
            finally { if (current() && epoch.current === generation) setLoading(false); }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
        return () => { epoch.current++; loaded.current = false; };
        // target is a value identity; fresh parent renders must not reset a gallery.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, focused, isActive, version, refresh]);
    const localPending = jobs?.jobs.some(j => j.status !== "done" && j.target?.visitId === target.visitId);
    async function add() {
        if (!jobs || !canManage || disabled || lock.current || !loaded.current || !current()) return;
        lock.current = true; setBusy(true); onBusyChange?.(true);
        try {
            const selected = await selectVisitPhotos(userId, MAX_VISIT_PHOTOS - photos.length - pending);
            if (!selected.length) return;
            // Stage against the original account/admission even when native
            // picker presentation temporarily hid this section. Disposed account
            // controllers reject staging; uploads still require current access.
            await jobs.stageVisit(selected, target);
            if (!current()) return;
            await jobs.run(current, "new", target.visitId);
            if (current()) setRefresh(v => v + 1);
        } catch { if (current()) setError("Photos are not confirmed. Review Photos to finish in Add before choosing them again."); }
        finally { lock.current = false; if (alive.current) { setBusy(false); onBusyChange?.(false); } }
    }
    const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
    async function remove(pendingPhoto?: VisitPhoto) {
        const photo = pendingPhoto ?? (gallery === null ? null : photos[gallery]);
        if (!photo || !canManage || disabled || !(pendingPhoto ? pendingRemoval === photo.id : confirmRemove) || lock.current || !current() || !loaded.current) return;
        lock.current = true; setBusy(true); onBusyChange?.(true);
        const generation = epoch.current;
        try { await removeVisitPhoto(userId, target, photo, () => current() && epoch.current === generation); }
        catch (error) { if (current()) setError(error instanceof Error ? error.message : "Refresh to check this removal."); }
        finally {
            lock.current = false;
            if (alive.current) { setBusy(false); onBusyChange?.(false); }
            if (current()) { setGallery(null); setConfirmRemove(false); setPendingRemoval(null); setRefresh(v => v + 1); }
        }
    }
    if (!focused || !isActive) return null;
    return <View style={photoStyles.section}>
        {leave.confirmation}
        <View style={photoStyles.heading}><Ionicons name="camera-outline" size={19} color="#C9472C" /><Text style={photoStyles.eyebrow}>VISIT PHOTOS{photos.length ? ` · ${photos.length}` : ""}</Text></View>
        {!!photos.length && <PhotoPreviewStrip photos={photos} disabled={busy || disabled} onOpen={index => { if (current() && loaded.current) setGallery(index); }} />}
        {loading ? <Text style={photoStyles.copy}>Loading photos…</Text> : error ? <>
            <Text style={photoStyles.copy}>{error}</Text>
            <Pressable accessibilityRole="button" style={photoStyles.add} onPress={() => { if (current()) setRefresh(v => v + 1); }}><Text style={photoStyles.action}>Refresh photos</Text></Pressable>
        </> : <>
            {!photos.length && <Text style={photoStyles.copy}>The table, the dishes, the people. Keep a glimpse of this visit.</Text>}
            {(pending > 0 || localPending) && <Text style={photoStyles.copy}>Some photos are unfinished. Open Add → Photos to finish to check or continue.</Text>}
            {canManage && pendingPhotos.map((photo, index) => <View key={photo.id} style={photoStyles.recovery}>
                <Text style={photoStyles.copy}>Unfinished photo {index + 1}</Text>
                {pendingRemoval === photo.id ? <>
                    <Text style={photoStyles.copy}>Remove this attachment? Any upload that finishes later will stay hidden.</Text>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void remove(photo); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Confirm remove unfinished photo</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => setPendingRemoval(null)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Keep attachment</Text></Pressable>
                </> : <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={() => { if (current()) setPendingRemoval(photo.id); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Remove unfinished photo</Text></Pressable>}
            </View>)}
            {canManage && <Pressable accessibilityRole="button" disabled={busy || disabled || !jobs?.ready || !!jobs?.error || photos.length + pending >= MAX_VISIT_PHOTOS}
                style={[photoStyles.add, (busy || disabled) && styles.disabled]} onPress={add}>
                <Ionicons name="add" size={22} color="#C9472C" /><Text style={photoStyles.action}>{busy ? "Preparing photos…" : "Add photos"}</Text>
            </Pressable>}
            <Text style={photoStyles.privacy}>{target.kind === "personal" ? "Only you can see these photos." : "Visible to current members of this group."}</Text>
        </>}
        {gallery !== null && photos[gallery] && <PhotoGallery photos={photos} index={gallery} onIndex={index => { setGallery(index); setConfirmRemove(false); }}
            onClose={() => { if (!busy) { setGallery(null); setConfirmRemove(false); } }} canManage={canManage && !disabled} busy={busy}
            confirmRemove={confirmRemove} onAskRemove={() => setConfirmRemove(true)} onCancelRemove={() => setConfirmRemove(false)} onRemove={() => { void remove(); }} />}
    </View>;
}

export function PhotoGallery({ photos, index, onIndex, onClose, canManage, busy, confirmRemove, onAskRemove, onCancelRemove, onRemove }: {
    photos: { id: string; image: ImageSource }[]; index: number; onIndex: (index: number) => void; onClose: () => void;
    canManage: boolean; busy: boolean; confirmRemove: boolean; onAskRemove: () => void; onCancelRemove: () => void; onRemove: () => void;
}) {
    const insets = useSafeAreaInsets(), { width } = useWindowDimensions();
    const pager = useRef<ScrollView>(null), [imageHeight, setImageHeight] = useState(400);
    useEffect(() => { pager.current?.scrollTo({ x: index * width, animated: false }); }, [index, width]);
    return <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
        <StatusBar style="light" />
        <View accessibilityViewIsModal style={[photoStyles.gallery, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={photoStyles.galleryHeader}>
                <Text style={photoStyles.galleryTitle}>A visit to remember</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close photo gallery" disabled={busy} onPress={onClose} style={photoStyles.iconButton}><Ionicons name="close" size={28} color="#FFF5EA" /></Pressable>
            </View>
            <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} scrollEnabled={!busy}
                style={{ flex: 1 }} onLayout={event => setImageHeight(event.nativeEvent.layout.height)}
                onMomentumScrollEnd={event => onIndex(Math.max(0, Math.min(photos.length - 1, Math.round(event.nativeEvent.contentOffset.x / width))))}>
                {photos.map((photo, photoIndex) => <ScrollView key={photo.id} minimumZoomScale={1} maximumZoomScale={3} centerContent
                    scrollEnabled={!busy} style={{ width }} contentContainerStyle={{ width, height: imageHeight }}>
                    <Image source={photo.image} accessibilityLabel={`Visit photo ${photoIndex + 1} of ${photos.length}`} contentFit="contain" cachePolicy="none" style={{ width, height: imageHeight }} />
                </ScrollView>)}
            </ScrollView>
            <View style={photoStyles.galleryFooter}>
                <Pressable accessibilityRole="button" accessibilityLabel="Previous photo" disabled={busy || index === 0} onPress={() => onIndex(index - 1)} style={photoStyles.iconButton}><Ionicons name="chevron-back" size={28} color={index === 0 ? "#6D635D" : "#FFF5EA"} /></Pressable>
                <Text accessibilityLiveRegion="polite" style={photoStyles.counter}>{index + 1} / {photos.length}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Next photo" disabled={busy || index === photos.length - 1} onPress={() => onIndex(index + 1)} style={photoStyles.iconButton}><Ionicons name="chevron-forward" size={28} color={index === photos.length - 1 ? "#6D635D" : "#FFF5EA"} /></Pressable>
            </View>
            {canManage && (confirmRemove ? <View style={photoStyles.removeConfirmation}>
                <Text style={[photoStyles.galleryCopy, { alignSelf: "stretch", textAlign: "center" }]}>Remove this photo from this visit?</Text>
                <View style={photoStyles.confirmationActions}>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={onCancelRemove} style={photoStyles.iconButton}><Text style={photoStyles.galleryCopy}>Keep photo</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={onRemove} style={photoStyles.iconButton}><Text style={photoStyles.removeText}>{busy ? "Removing…" : "Remove photo"}</Text></Pressable>
                </View>
            </View> : <Pressable accessibilityRole="button" disabled={busy} onPress={onAskRemove} style={photoStyles.galleryFooter}><Ionicons name="trash-outline" size={17} color="#FFD6BD" /><Text style={photoStyles.galleryCopy}>Remove photo</Text></Pressable>)}
        </View>
    </Modal>;
}

export const photoStyles = StyleSheet.create({
    selection: { backgroundColor: "#FFF2E3", borderRadius: 20, borderWidth: 1, borderColor: "#ECD7C5", padding: 18, gap: 13, marginBottom: 22 },
    recovery: { backgroundColor: "#FFF2E3", borderRadius: 18, padding: 18, marginVertical: 16, gap: 10 },
    heading: { flexDirection: "row", alignItems: "center", gap: 9 },
    title: { fontSize: 19, fontWeight: "600", color: "#44291F", flexShrink: 1 },
    copy: { color: "#79665E", fontSize: 15, lineHeight: 22 },
    action: { color: "#C9472C", fontWeight: "600", fontSize: 16, flexShrink: 1, textAlign: "center" },
    add: { minHeight: 48, borderWidth: 1, borderStyle: "dashed", borderColor: "#D9A38A", borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 10 },
    strip: { gap: 10, paddingVertical: 4 },
    draft: { width: 105, height: 115, borderRadius: 12, backgroundColor: "#EEDBC9" },
    removeDraft: { position: "absolute", top: 2, right: 2, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "#44291FCC" },
    section: { gap: 12, paddingTop: 16, paddingBottom: 8, borderTopWidth: 1, borderTopColor: "#EEDFD1", marginTop: 12 },
    eyebrow: { color: "#9B4B32", fontSize: 12, fontWeight: "700", letterSpacing: 1.4 },
    preview: { width: 205, height: 158, borderRadius: 15, backgroundColor: "#EEDBC9" },
    expand: { position: "absolute", bottom: 10, right: 10, borderRadius: 18, padding: 8, backgroundColor: "#44291F99" },
    privacy: { color: "#79665E", fontSize: 12, lineHeight: 18 },
    gallery: { flex: 1, backgroundColor: "#241B17" },
    galleryHeader: { paddingLeft: 22, paddingRight: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    galleryTitle: { fontSize: 20, color: "#FFF5EA", fontWeight: "500", flexShrink: 1 },
    iconButton: { minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center", padding: 10 },
    galleryFooter: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, paddingVertical: 8 },
    counter: { fontSize: 16, color: "#FFF5EA", minWidth: 68, textAlign: "center" },
    galleryCopy: { color: "#FFD6BD", fontSize: 15 },
    removeText: { color: "#FF987D", fontSize: 15, fontWeight: "700" },
    removeConfirmation: { alignSelf: "stretch", paddingHorizontal: 22, alignItems: "center", gap: 8 },
    confirmationActions: { alignSelf: "stretch", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
});
