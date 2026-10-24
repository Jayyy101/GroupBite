import type { Submission } from "@/lib/unified-add";
import type { AddDestinationResult } from "@/types/database";
import type { PhotoJob, PhotoTarget, SelectedPhoto, VisitPhoto } from "@/types/visit-photos";

type Dependencies = {
    read: () => Promise<string | null>;
    write: (value: string) => Promise<void>;
    uuid: () => string;
    receipt: (requestId: string) => Promise<AddDestinationResult | null>;
    list: (target: PhotoTarget) => Promise<VisitPhoto[]>;
    reserve: (job: PhotoJob, canSend: () => boolean) => Promise<void>;
    upload: (job: PhotoJob, variant: "image" | "thumbnail", canSend: () => boolean) => Promise<void>;
    releaseAsset?: (asset: SelectedPhoto) => Promise<void>;
};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
function validJob(value: PhotoJob) {
    const d = value?.destination, a = value?.asset, t = value?.target;
    return uuid(value?.id) && a && uuid(a.id) && a.image === `${a.id}-image.jpg` && a.thumbnail === `${a.id}-thumbnail.jpg`
        && Number.isInteger(a.width) && a.width > 0 && a.width <= 1600 && Number.isInteger(a.height) && a.height > 0 && a.height <= 1600
        && Number.isInteger(a.bytes) && a.bytes > 0 && a.bytes <= 5242880 && Number.isInteger(a.thumbnailBytes) && a.thumbnailBytes > 0 && a.thumbnailBytes <= 524288
        && d && ["personal", "group"].includes(d.kind) && (d.kind === "group" ? uuid(d.groupId) && uuid(d.membershipId) : !d.groupId && !d.membershipId)
        && ["waiting", "uploading", "review", "done"].includes(value.status)
        && (!value.requestId || /^[a-zA-Z0-9-]{1,100}$/.test(value.requestId))
        && (!!t || !!value.requestId) && (!t || (t.kind === d.kind && t.groupId === d.groupId && t.membershipId === d.membershipId && uuid(t.entryId) && uuid(t.visitId)));
}

// Explicit, account-owned work. Restoring/focusing/foregrounding only reads local
// evidence; none of those events dispatch uploads or visit mutations.
export class PhotoJobs {
    jobs: readonly PhotoJob[] = [];
    ready = false;
    busy = false;
    error = "";
    private disposed = false;
    private restoreVersion = 0;
    private releasedAssets = new Set<string>();
    private listeners = new Set<() => void>();
    constructor(private deps: Dependencies) {}
    subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    activate() { this.disposed = false; }
    dispose() { this.disposed = true; this.restoreVersion++; this.listeners.clear(); }
    private changed() { if (!this.disposed) this.listeners.forEach(f => f()); }
    async restore() {
        const version = ++this.restoreVersion;
        this.ready = false;
        try {
            const raw = await this.deps.read();
            const jobs: PhotoJob[] = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(jobs) || !jobs.every(validJob) || new Set(jobs.map(j => j.id)).size !== jobs.length) throw new Error();
            if (this.disposed || version !== this.restoreVersion) return;
            this.jobs = jobs.map(j => j.status !== "done" ? { ...j, status: "review" } : j);
            this.ready = true;
        } catch { if (!this.disposed && version === this.restoreVersion) this.error = "Photo recovery could not be read. It has been retained; new uploads are paused."; }
        this.changed();
    }
    private async persist(jobs: readonly PhotoJob[]) {
        // A write failure leaves the old in-memory and durable evidence intact.
        await this.deps.write(JSON.stringify(jobs));
        if (!this.disposed) { this.jobs = jobs; this.changed(); }
    }
    private async replace(job: PhotoJob) { await this.persist(this.jobs.map(j => j.id === job.id ? job : j)); }
    private async stage(assets: readonly SelectedPhoto[], destinations: { destination: PhotoJob["destination"]; requestId?: string; target?: PhotoTarget }[]) {
        if (!this.ready || this.busy || this.disposed || this.error) throw new Error("Photo recovery is unavailable. No new upload was sent.");
        this.busy = true; this.changed();
        try {
            const added = destinations.flatMap(d => assets.map(asset => ({ ...d, id: this.deps.uuid(), asset: { ...asset }, status: "waiting" as const })));
            if (!added.every(validJob)) throw new Error("Choose these photos again.");
            await this.persist([...this.jobs, ...added]);
        } finally { this.busy = false; this.changed(); }
    }
    async stageAdd(assets: readonly SelectedPhoto[], submissions: readonly Submission[], sharedGroups: readonly string[]) {
        await this.stage(assets, submissions.filter(s => s.destination.kind === "personal" || sharedGroups.includes(s.destination.groupId!))
            .map(s => ({ requestId: s.args.client_request_id, destination: { kind: s.destination.kind,
                ...(s.destination.kind === "group" ? { groupId: s.destination.groupId, membershipId: s.destination.membershipId } : {}) } })));
    }
    async stageVisit(assets: readonly SelectedPhoto[], target: PhotoTarget) {
        await this.stage(assets, [{ target: { ...target }, destination: { kind: target.kind,
            ...(target.kind === "group" ? { groupId: target.groupId, membershipId: target.membershipId } : {}) } }]);
    }
    async run(canSend: () => boolean, mode: "new" | "check" | "continue" = "new", targetVisitId?: string) {
        if (!this.ready || this.busy || this.disposed || this.error || !canSend()) return;
        this.busy = true; this.changed();
        const current = () => !this.disposed && canSend();
        try {
            for (const original of this.jobs) {
                if (!current()) break;
                if (original.status === "done" || (targetVisitId && original.target?.visitId !== targetVisitId)) continue;
                if (mode === "new" && original.status !== "waiting") continue;
                let job = original;
                try {
                    if (!job.target && job.requestId) {
                        const receipt = await this.deps.receipt(job.requestId);
                        if (!current()) break;
                        if (!receipt?.available || !receipt.entry_id || !receipt.visit_id || receipt.destination_kind !== job.destination.kind
                            || receipt.group_id !== (job.destination.groupId ?? null)) continue;
                        job = { ...job, target: { ...job.destination, entryId: receipt.entry_id, visitId: receipt.visit_id } };
                        await this.replace(job);
                    }
                    if (!job.target || !current()) continue;
                    const photos = await this.deps.list(job.target);
                    if (!current()) break;
                    const saved = photos.find(p => p.id === job.id);
                    if (saved?.state === "ready" || saved?.state === "removed") { await this.replace({ ...job, status: "done" }); continue; }
                    if (mode === "check") continue;
                    // Persist uncertainty BEFORE dispatch. After a crash the only
                    // automatic action is a read. Continue is always user-driven.
                    job = { ...job, status: "uploading" }; await this.replace(job);
                    if (!current()) break;
                    await this.deps.reserve(job, current);
                    if (!current()) break;
                    await this.deps.upload(job, "image", current);
                    if (!current()) break;
                    await this.deps.upload(job, "thumbnail", current);
                    if (!current()) break;
                    const confirmed = (await this.deps.list(job.target!)).find(p => p.id === job.id);
                    await this.replace({ ...job, status: confirmed?.state === "ready" ? "done" : "review" });
                } catch {
                    if (!this.disposed) await this.replace({ ...job, status: "review" });
                }
            }
        } catch { this.error = "Photo recovery could not be updated. Uploads are paused; retained evidence is unchanged."; }
        finally {
            // Release only generated copies after every consented destination is
            // durably confirmed. The originals remain in the device photo library.
            if (!this.disposed && this.deps.releaseAsset) for (const job of this.jobs) {
                if (job.status !== "done" || this.releasedAssets.has(job.asset.id)
                    || this.jobs.some(other => other.asset.id === job.asset.id && other.status !== "done")) continue;
                try { await this.deps.releaseAsset(job.asset); this.releasedAssets.add(job.asset.id); }
                catch { /* Retain the copy if device storage is unavailable. */ }
            }
            this.busy = false; this.changed();
        }
    }
}
