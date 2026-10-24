import { accountAccessToken } from "@/lib/account-session";
import { withRequestDeadline } from "@/lib/request-deadline";
import { supabase, supabasePublicConfig } from "@/lib/supabase";
import { photoFile } from "@/lib/visit-photo-files";
import type { PhotoJob, PhotoTarget, VisitPhoto } from "@/types/visit-photos";

export const photoScope = (target: PhotoTarget) => ({ target_kind: target.kind, target_entry_id: target.entryId,
    target_visit_id: target.visitId, target_group_id: target.groupId ?? null, expected_membership_id: target.membershipId ?? null });
export async function listVisitPhotos(userId: string, target: PhotoTarget): Promise<VisitPhoto[]> {
    const token = await accountAccessToken(userId);
    const result = await withRequestDeadline(signal => supabase.rpc("get_visit_photos", photoScope(target))
        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
    if (result.error) throw new Error(result.error.code === "PGRST202"
        ? "Photos need the prepared backend update. Your visits are unchanged."
        : "Could not verify photo access. Refresh when connected.");
    return result.data;
}
export async function reservePhoto(userId: string, job: PhotoJob, canSend: () => boolean) {
    if (!job.target) throw new Error("The visit has not been confirmed yet.");
    const token = await accountAccessToken(userId);
    if (!canSend()) throw new Error("Return to this screen to continue.");
    const result = await withRequestDeadline(signal => supabase.rpc("visit_photo_command", {
        ...photoScope(job.target!), operation: "reserve", photo_id: job.id, image_width: job.asset.width,
        image_height: job.asset.height, image_size: job.asset.bytes, thumbnail_size: job.asset.thumbnailBytes,
    }).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
    if (result.error) throw new Error(result.error.code === "PGRST202"
        ? "Photos need the prepared backend update. Your visit is saved."
        : "Could not prepare this photo. Check its status before continuing.");
    if (result.data[0]?.removed) throw new Error("This photo was removed. Select it again to create a new attachment.");
}
export async function removeVisitPhoto(userId: string, target: PhotoTarget, photo: VisitPhoto, canSend: () => boolean) {
    const token = await accountAccessToken(userId);
    if (!canSend()) return;
    const result = await withRequestDeadline(signal => supabase.rpc("visit_photo_command", {
        ...photoScope(target), operation: "remove", photo_id: photo.id, expected_revision: photo.revision,
    }).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
    if (result.error || !result.data[0]?.removed) throw new Error("Removal may have completed. Refresh photos to check before trying again.");
}
export async function uploadPhotoFile(userId: string, job: PhotoJob, variant: "image" | "thumbnail", canSend: () => boolean) {
    const bytes = await photoFile(userId, job.asset[variant]).arrayBuffer();
    const token = await accountAccessToken(userId);
    if (!canSend()) throw new Error("Return to this screen to continue.");
    const path = `${userId}/${job.id}/${variant}.jpg`;
    const response = await withRequestDeadline(signal => fetch(`${supabasePublicConfig.url}/storage/v1/object/visit-photos/${path}`, {
        method: "POST", headers: { apikey: supabasePublicConfig.publishableKey, Authorization: `Bearer ${token}`,
            "Content-Type": "image/jpeg", "x-upsert": "false", "cache-control": "no-store" }, body: bytes, signal,
    }));
    // An immutable path conflict can be an earlier request completing late. The
    // caller reconciles through reads; it never overwrites/replaces those bytes.
    if (!response.ok && response.status !== 409) {
        const error = await response.json().catch(() => null);
        if (!(response.status === 400 && error?.error === "Duplicate")) throw new Error("Upload interrupted. Check photos before continuing.");
    }
}
export async function photoImageSource(userId: string, path: string) {
    const token = await accountAccessToken(userId);
    if (!/^[a-f0-9-]+\/[a-f0-9-]+\/(image|thumbnail)\.jpg$/.test(path)) throw new Error("Photo unavailable.");
    return { uri: `${supabasePublicConfig.url}/storage/v1/object/authenticated/visit-photos/${path}`,
        headers: { Authorization: `Bearer ${token}`, apikey: supabasePublicConfig.publishableKey, "Cache-Control": "no-store" } };
}
