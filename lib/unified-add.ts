import AsyncStorage from "@react-native-async-storage/async-storage";
import { accountAccessToken } from "@/lib/account-session";
import { normalizePersonalPlace } from "@/lib/personal-places";
import { withRequestDeadline } from "@/lib/request-deadline";
import { isUuid } from "@/lib/restaurant-ui";
import { supabase } from "@/lib/supabase";
import { normalizeMapKitAddress, type MapKitAddress } from "@/lib/mapkit-address";
import type { AddDestinationResult, AddRestaurant, AddVisitArgs } from "@/types/database";

export type Destination = Readonly<{ kind: "personal" | "group"; groupId?: string; membershipId?: string; label: string }>;
export type AddFields = { restaurant: AddRestaurant; visited_on: string | null; rating: number | null;
    would_go_again: boolean | null; privateNotes: string; groupNotes: string };
export type Submission = Readonly<{ userId: string; destination: Destination; args: Readonly<AddVisitArgs>; eventId?: string;
    mapkitPoint?: Readonly<{ latitude: number; longitude: number; structured_address?: MapKitAddress }> }>;
export type Attempt = Readonly<{ requestId: string; eventId?: string; destination: Destination; status: "pending" | "saved" | "failed" | "uncertain";
    submission?: Submission; result?: AddDestinationResult; message?: string }>;
export type PreviousAdd = Readonly<{ id: string; attempts: readonly Attempt[]; durable: boolean; unreadable: boolean }>;
type Marker = { requestId: string; eventId?: string; kind: "personal" | "group"; groupId?: string; status?: Attempt["status"] };
type ArchivedAdd = { id: string; markers: Marker[]; raw?: string; unreadable: boolean };
export type AddState = Readonly<{ ready: boolean; busy: boolean; attempts: readonly Attempt[]; error: string; restaurant: AddRestaurant | null;
    previous: readonly PreviousAdd[]; historyError: string }>;
export function isConfirmedAdd(state: AddState) {
    return state.ready && !state.busy && state.attempts.length > 0 && state.attempts.every(a => a.status === "saved");
}
const requestId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const key = (userId: string) => `groupbite:add-recovery:v1:${userId}`;
const historyKey = (userId: string) => `groupbite:add-recovery-history:v1:${userId}`;
const journalWrites = new Map<string, Promise<void>>();
const failure = "Could not confirm this destination. Check Saved Results; do not submit it again.";

const marker = (attempt: Attempt): Marker => ({ requestId: attempt.requestId, ...(attempt.eventId ? { eventId: attempt.eventId } : {}), kind: attempt.destination.kind,
    ...(attempt.destination.groupId ? { groupId: attempt.destination.groupId } : {}), status: attempt.status });
function validMarker(row: unknown): row is Marker {
    if (!row || typeof row !== "object") return false;
    const value = row as Marker;
    return typeof value.requestId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(value.requestId)
        && (value.eventId === undefined || (typeof value.eventId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(value.eventId)))
        && ["personal", "group"].includes(value.kind) && (value.kind !== "group" || isUuid(value.groupId))
        && (value.status === undefined || ["pending", "saved", "failed", "uncertain"].includes(value.status));
}
const restoredAttempt = (row: Marker, archived = false): Attempt => ({ requestId: row.requestId, ...(row.eventId ? { eventId: row.eventId } : {}),
    destination: { kind: row.kind, groupId: row.kind === "group" ? row.groupId : undefined, label: row.kind === "personal" ? "My Places" : "Group" },
    status: archived ? row.status ?? "uncertain" : "uncertain" });
function history(raw: string | null): ArchivedAdd[] {
    if (!raw) return [];
    try {
        const records: unknown = JSON.parse(raw);
        if (Array.isArray(records) && records.every(record => record && typeof record.id === "string"
            && Array.isArray(record.markers) && record.markers.every(validMarker) && typeof record.unreadable === "boolean"
            && (record.raw === undefined || typeof record.raw === "string"))) return records;
    } catch { /* Quarantine the exact unreadable evidence, never print it. */ }
    return [{ id: "unreadable-history", markers: [], raw, unreadable: true }];
}
const previousAdd = (record: ArchivedAdd, durable: boolean, known: readonly Attempt[] = []): PreviousAdd => ({ id: record.id, durable,
    unreadable: record.unreadable, attempts: record.markers.map(row => {
        const attempt = restoredAttempt(row, true), current = known.find(saved => saved.requestId === row.requestId);
        return current ? { ...attempt, status: current.status, result: current.result, message: current.message } : attempt;
    }) });

export function freezeAddSubmissions(userId: string, fields: AddFields, destinations: readonly Destination[]): Submission[] {
    if (!destinations.length || destinations.length > 50) throw new Error("Choose at least one destination.");
    const unique = new Set<string>(), eventId = requestId();
    return destinations.map(destination => {
        if (!["personal", "group"].includes(destination.kind)) throw new Error("Invalid destination.");
        const identity = destination.kind === "personal" ? "personal" : destination.groupId;
        if (!identity || unique.has(identity) || (destination.kind === "group" && (!isUuid(destination.groupId) || !isUuid(destination.membershipId)))) {
            throw new Error("Refresh destinations before saving.");
        }
        unique.add(identity);
        const value = normalizePersonalPlace({ ...fields.restaurant, visited_on: fields.visited_on,
            rating: fields.rating, would_go_again: fields.would_go_again,
            notes: destination.kind === "personal" ? fields.privateNotes : fields.groupNotes });
        const apple = __DEV__ ? fields.restaurant.apple_place_id ?? null : null;
        if (apple !== null && (!apple || apple !== apple.trim() || Array.from(apple).length > 300 || /[\u0000-\u001f\u007f-\u009f]/.test(apple))) {
            throw new Error("Select a restaurant with a valid Apple Place ID.");
        }
        // An existing entry reference belongs only to its original destination.
        const sameDestination = fields.restaurant.destination_kind === destination.kind
            && (destination.kind === "personal" || fields.restaurant.group_id === destination.groupId);
        if (sameDestination && fields.restaurant.entry_id !== undefined && !isUuid(fields.restaurant.entry_id)) {
            throw new Error("Select a valid saved restaurant.");
        }
        const args: AddVisitArgs = { client_request_id: requestId(), restaurant_name: value.name, restaurant_address: value.address,
            restaurant_cuisine: value.cuisine, restaurant_apple_place_id: apple,
            target_entry_id: sameDestination ? fields.restaurant.entry_id ?? null : null,
            visit_date: value.visited_on, visit_rating: value.rating, visit_would_go_again: value.would_go_again, visit_notes: value.notes };
        const point = __DEV__ ? fields.restaurant.mapkit_point : undefined;
        if (point !== undefined && (!point || typeof point.name !== "string" || typeof point.address !== "string"
            || point.name.trim() !== value.name || point.address.trim() !== value.address
            || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
            || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180 || (point.latitude === 0 && point.longitude === 0))) {
            throw new Error("Select this restaurant's location again before saving.");
        }
        const address = point ? normalizeMapKitAddress(point.structured_address) : undefined;
        return Object.freeze({ userId, eventId, destination: Object.freeze({ ...destination }), args: Object.freeze(args),
            ...(point ? { mapkitPoint: Object.freeze({ latitude: point.latitude, longitude: point.longitude,
                ...(address ? { structured_address: address } : {}) }) } : {}) });
    });
}

class ServerRejection extends Error { constructor(readonly code: string) { super("The server rejected this attempt without saving it."); } }
const definitive = (error: unknown): error is ServerRejection => error instanceof ServerRejection && ["22023", "22007", "22008", "42501", "23514", "23503", "23505",
    "25001", "PGRST202", "GB001", "GB002", "40P01", "40001", "57014"].includes(error.code);

export async function sendAddSubmission(submission: Submission, canSend: () => boolean): Promise<AddDestinationResult | null> {
    const token = await withRequestDeadline(() => accountAccessToken(submission.userId));
    if (!canSend()) return null;
    const { destination, args, mapkitPoint, eventId } = submission;
    const response = await withRequestDeadline(signal => (eventId ? supabase.rpc("save_visit_event_destination", { ...args,
            client_event_id: eventId, destination_kind: destination.kind, target_group_id: destination.groupId ?? null,
            expected_membership_id: destination.membershipId ?? null, selected_latitude: mapkitPoint?.latitude ?? null,
            selected_longitude: mapkitPoint?.longitude ?? null, selected_address: mapkitPoint?.structured_address ?? null }) : destination.kind === "personal"
        ? mapkitPoint ? supabase.rpc("save_personal_visit_with_mapkit_location", { ...args,
            selected_latitude: mapkitPoint.latitude, selected_longitude: mapkitPoint.longitude,
            selected_address: mapkitPoint.structured_address ?? null }) : supabase.rpc("save_personal_visit", { ...args })
        : mapkitPoint ? supabase.rpc("save_group_visit_with_mapkit_location", { ...args, target_group_id: destination.groupId!,
            expected_membership_id: destination.membershipId!, selected_latitude: mapkitPoint.latitude,
            selected_longitude: mapkitPoint.longitude, selected_address: mapkitPoint.structured_address ?? null })
            : supabase.rpc("save_group_visit_destination", { ...args, target_group_id: destination.groupId!, expected_membership_id: destination.membershipId! }))
        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
    if (response.error) {
        if (response.status >= 400 && response.status <= 599) throw new ServerRejection(response.error.code);
        throw new Error(failure);
    }
    if (!isUuid(response.data)) throw new Error(failure);
    // The RPC's successful response proves the SAME-transaction receipt committed.
    // A separate read failure can never downgrade this confirmed success.
    return { destination_kind: destination.kind, group_id: destination.groupId ?? null, entry_id: response.data, visit_id: null, available: true };
}

export async function readAddResult(userId: string, id: string): Promise<AddDestinationResult | null> {
    const token = await withRequestDeadline(() => accountAccessToken(userId));
    const response = await withRequestDeadline(signal => supabase.rpc("get_add_destination_result", { client_request_id: id })
        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
    if (response.error || !Array.isArray(response.data) || response.data.length > 1) throw new Error(failure);
    const value = response.data[0];
    if (!value) return null;
    if (!["personal", "group"].includes(value.destination_kind) || typeof value.available !== "boolean"
        || (value.entry_id !== null && !isUuid(value.entry_id)) || (value.visit_id !== null && !isUuid(value.visit_id))
        || (value.destination_kind === "group" ? !isUuid(value.group_id) : value.group_id !== null)
        || (value.available && !isUuid(value.entry_id))) throw new Error(failure);
    return value;
}

// One small account-owned controller above disposable screens. Only recovery
// markers reach storage: never notes, tokens, Apple results or mutation payloads.
export class AddCoordinator {
    state: AddState = { ready: false, busy: false, attempts: [], error: "", restaurant: null, previous: [], historyError: "" };
    private listeners = new Set<(state: AddState) => void>();
    private disposed = false;
    private restoreVersion = 0;
    private pendingArchives: ArchivedAdd[] = [];
    private separation: ArchivedAdd | null = null;
    private preservationFailed = false;
    private async captureEvidence(record: ArchivedAdd) {
        // Never replace quarantined bytes with a later workflow's journal.
        if (record.raw !== undefined) return;
        const raw = await AsyncStorage.getItem(key(this.userId));
        if (raw === null) return;
        record.raw = raw;
        try {
            const rows: unknown = JSON.parse(raw);
            if (!Array.isArray(rows) || !rows.every(validMarker)) record.unreadable = true;
            if (Array.isArray(rows)) for (const row of rows.filter(validMarker)) {
                if (!record.markers.some(saved => saved.requestId === row.requestId)) record.markers.push(marker(restoredAttempt(row)));
            }
        } catch { record.unreadable = true; }
    }
    // Called only inside the account's serialized storage operation. Archive
    // before removing/replacing the active journal; interrupted moves are safe.
    private async preserve(records: ArchivedAdd[]) {
        const existing = history(await AsyncStorage.getItem(historyKey(this.userId)));
        const byId = new Map(existing.map(record => [record.id, record]));
        for (const record of records) {
            const old = byId.get(record.id);
            byId.set(record.id, { ...old, ...record, ...(record.raw === undefined && old?.raw !== undefined ? { raw: old.raw } : {}),
                markers: record.markers.map(row => old?.markers.find(prior => prior.requestId === row.requestId)?.status === "saved" ? { ...row, status: "saved" } : row) });
        }
        await AsyncStorage.setItem(historyKey(this.userId), JSON.stringify([...byId.values()]));
    }
    private async loadPrevious(version = this.restoreVersion) {
        const raw = await withRequestDeadline(() => AsyncStorage.getItem(historyKey(this.userId)));
        if (this.disposed || version !== this.restoreVersion) return;
        const records = history(raw).map(record => previousAdd(record, true));
        for (const retained of this.state.previous) {
            const index = records.findIndex(record => record.id === retained.id);
            if (index < 0) records.push(retained);
            else records[index] = { ...records[index], attempts: records[index].attempts.map(attempt => {
                const known = retained.attempts.find(row => row.requestId === attempt.requestId);
                return known?.status === "saved" ? known : attempt;
            }) };
        }
        this.update({ previous: records, historyError: "" });
    }
    async refreshPrevious(canRead: () => boolean) {
        if (this.disposed || this.state.busy || !canRead()) return;
        this.update({ busy: true });
        try {
            await withRequestDeadline(() => accountAccessToken(this.userId));
            if (!this.disposed && canRead()) await this.loadPrevious();
        } catch { this.update({ historyError: "Previous save recovery could not be read. Its stored evidence has not been cleared. Temporary records may be lost after restart or sign-out." }); }
        finally { this.update({ busy: false }); }
    }
    private store(operation: () => Promise<void>) {
        // Preserve ordering even after a deadline: a late marker write must not
        // overwrite a cleared journal or a later submission.
        const write = (journalWrites.get(this.userId) ?? Promise.resolve()).catch(() => {}).then(operation);
        journalWrites.set(this.userId, write);
        return withRequestDeadline(() => write);
    }
    constructor(readonly userId: string) {}
    activate() { this.disposed = false; }
    subscribe(listener: (state: AddState) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    dispose() { this.disposed = true; this.listeners.clear(); }
    selectRestaurant(restaurant: AddRestaurant | null) {
        if (!this.state.busy && !this.state.attempts.length) this.update({ restaurant });
    }
    labelDestinations(groups: readonly { id: string; name: string }[]) {
        const label = (attempt: Attempt): Attempt => ({ ...attempt, destination: {
            ...attempt.destination, label: attempt.destination.kind === "personal" ? "My Places"
                : groups.find(group => group.id === attempt.destination.groupId)?.name ?? `Group (${attempt.destination.groupId?.slice(0,8)})`,
        } });
        this.update({ attempts: this.state.attempts.map(label), previous: this.state.previous.map(previous => ({ ...previous, attempts: previous.attempts.map(label) })) });
    }
    private update(patch: Partial<AddState>) {
        if (this.disposed) return;
        this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener(this.state));
    }
    private replace(id: string, patch: Partial<Attempt>) {
        this.update({ attempts: this.state.attempts.map(attempt => attempt.requestId === id ? { ...attempt, ...patch } : attempt) });
    }
    async restore(keepUnknown = false) {
        const version = ++this.restoreVersion;
        this.update({ ready: false });
        try {
            // A completed failed write must not prevent reading the last good
            // journal when this account/provider returns.
            await withRequestDeadline(() => (journalWrites.get(this.userId) ?? Promise.resolve()).catch(() => {}));
            const raw = await withRequestDeadline(() => AsyncStorage.getItem(key(this.userId)));
            if (this.disposed || version !== this.restoreVersion) return;
            const missing = "No readable request markers are available. This does not prove an earlier save failed. Review your destinations or confirm a separate Add.";
            if (!raw) { this.update({ error: keepUnknown ? missing : "" }); return; }
            const data: unknown = JSON.parse(raw);
            if (!Array.isArray(data) || data.length > 50) throw new Error("Invalid recovery journal.");
            const seen = new Set<string>();
            const attempts: Attempt[] = data.map(row => {
                if (!row || typeof row.requestId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(row.requestId) || seen.has(row.requestId)
                    || !["personal", "group"].includes(row.kind) || (row.kind === "group" && !isUuid(row.groupId))) throw new Error("Invalid recovery journal.");
                seen.add(row.requestId);
                if (!validMarker(row)) throw new Error("Invalid recovery event marker.");
                return { requestId: row.requestId, ...(row.eventId ? { eventId: row.eventId } : {}), destination: { kind: row.kind, groupId: row.kind === "group" ? row.groupId : undefined,
                    label: row.kind === "personal" ? "My Places" : "Group" }, status: "uncertain" };
            });
            this.update({ attempts, error: keepUnknown && !attempts.length ? missing : "" });
        } catch { if (version !== this.restoreVersion) return; this.update({ error: "Could not read save recovery. Review your saved places before starting a separate save." }); }
        finally {
            if (!this.disposed && version === this.restoreVersion) {
                try {
                    await this.loadPrevious(version);
                } catch { this.update({ historyError: "Previous save recovery could not be read. Its stored evidence has not been cleared." }); }
                if (!this.disposed && version === this.restoreVersion) this.update({ ready: true });
            }
        }
    }
    async start(fields: AddFields, destinations: readonly Destination[], canSend: () => boolean,
        beforeSend?: (submissions: readonly Submission[]) => Promise<void>) {
        if (this.disposed || !this.state.ready || this.state.busy || this.state.attempts.length || this.state.error || !canSend()) return;
        const submissions = freezeAddSubmissions(this.userId, fields, destinations);
        this.update({ busy: true, attempts: submissions.map(submission => ({ requestId: submission.args.client_request_id,
            eventId: submission.eventId, destination: submission.destination, submission, status: "pending" })) });
        try {
            // Persist ALL markers before ANY mutation. Storage failure dispatches
            // nothing. A crash before dispatch remains conservatively uncertain.
            const retained = [...this.pendingArchives];
            await this.store(async () => {
                if (retained.length) {
                    // Temporary separation left the old journal untouched. Read
                    // it before the first replacement once storage recovers.
                    const uncaptured = retained.find(record => record.raw === undefined);
                    if (uncaptured) await this.captureEvidence(uncaptured);
                    await this.preserve(retained);
                }
                await AsyncStorage.setItem(key(this.userId), JSON.stringify(submissions.map(s => ({
                    requestId: s.args.client_request_id, eventId: s.eventId, kind: s.destination.kind, ...(s.destination.groupId ? { groupId: s.destination.groupId } : {}) }))));
            });
            // Photo consent/local files are retained against these exact receipt
            // identities before any visit write. Photos never enter visit payloads.
            if (beforeSend) await beforeSend(submissions);
            this.pendingArchives = this.pendingArchives.filter(record => !retained.includes(record));
            this.update({ previous: this.state.previous.map(record => {
                const saved = retained.find(saved => saved.id === record.id);
                return saved ? previousAdd(saved, true, record.attempts) : record;
            }) });
        } catch {
            this.update({ busy: false, error: "Recovery could not be recorded. Nothing was sent. Review recovery or start a separate Add." }); return;
        }
        this.update({ busy: false });
        await this.sendPending(canSend);
    }
    async sendPending(canSend: () => boolean, failedId?: string) {
        if (this.disposed || this.state.busy || !canSend() || this.state.error) return;
        this.update({ busy: true });
        try {
            for (const attempt of this.state.attempts) {
                if (this.disposed || !canSend()) break;
                if (!attempt.submission || !(failedId ? attempt.status === "failed" && attempt.requestId === failedId : attempt.status === "pending")) continue;
                try {
                    const result = await sendAddSubmission(attempt.submission, () => !this.disposed && canSend());
                    if (result) this.replace(attempt.requestId, { status: "saved", result, message: "" });
                } catch (error) {
                    this.replace(attempt.requestId, { status: definitive(error) ? "failed" : "uncertain",
                        message: definitive(error) ? error.code === "PGRST202" && attempt.submission.eventId
                            ? "Visit saving needs the pending backend update. Nothing was saved to this destination."
                            : error.code === "PGRST202" && attempt.submission.mapkitPoint
                            ? "Apple Maps location saving needs the pending backend update. Nothing was saved to this destination."
                            : error.code === "GB001" ? "Not saved: this restaurant already has different Apple Maps details. Choose the saved restaurant to add a visit."
                            : error.code === "GB002" ? "Not saved: only the group Owner can add Apple Maps details to an existing restaurant. Choose the saved restaurant to add a visit."
                            : "Not saved: the server rejected this attempt. Refresh permissions before retrying this destination." : failure });
                }
            }
        } finally { this.update({ busy: false }); }
    }
    async reconcile(canRead: () => boolean) {
        if (this.disposed || this.state.busy || !canRead()) return;
        if (!this.state.attempts.length && this.state.error) { await this.restore(true); return; }
        this.update({ busy: true });
        try {
            for (const attempt of this.state.attempts) {
                if (this.disposed || !canRead()) break;
                if (attempt.status === "failed" || attempt.status === "pending") continue;
                try {
                    const result = await readAddResult(this.userId, attempt.requestId);
                    if (result && result.destination_kind === attempt.destination.kind && result.group_id === (attempt.destination.groupId ?? null)) {
                        this.replace(attempt.requestId, { status: "saved", result, message: result.available ? "" : "Saved previously; this entry is deleted or access is no longer available." });
                    } else if (attempt.status !== "saved") this.replace(attempt.requestId, { message: "No receipt is visible yet. This does not prove failure. Check again or review your destinations." });
                } catch { if (attempt.status !== "saved") this.replace(attempt.requestId, { message: failure }); }
            }
        } finally { this.update({ busy: false }); }
    }
    async startSeparate(expected: AddState, canOperate: () => boolean, temporary = false): Promise<"started" | "storage-unavailable" | "stale"> {
        if (this.disposed || this.state !== expected || !expected.ready || expected.busy || !canOperate()
            || (!expected.attempts.length && !expected.error) || (temporary && !this.preservationFailed)) return "stale";
        this.update({ busy: true });
        let storageStarted = false;
        try {
            await withRequestDeadline(() => accountAccessToken(this.userId));
            if (this.disposed || !canOperate()) return "stale";
            const record = this.separation ??= { id: requestId(), markers: expected.attempts.map(marker), unreadable: !!expected.error && !expected.attempts.length };
            for (const attempt of expected.attempts) {
                const index = record.markers.findIndex(row => row.requestId === attempt.requestId);
                if (index < 0) record.markers.push(marker(attempt)); else record.markers[index] = marker(attempt);
            }
            const retainedArchives = [...this.pendingArchives];
            if (!temporary) {
                storageStarted = true;
                await this.store(async () => {
                    await this.captureEvidence(retainedArchives.find(previous => previous.raw === undefined) ?? record);
                    await this.preserve([...retainedArchives, record]);
                    await AsyncStorage.removeItem(key(this.userId));
                });
                this.pendingArchives = [];
            } else this.pendingArchives.push(record);
            this.update({ attempts: [], error: "", restaurant: null,
                previous: [...this.state.previous.map(previous => {
                    const saved = !temporary && retainedArchives.find(saved => saved.id === previous.id);
                    return saved ? previousAdd(saved, true, previous.attempts) : previous;
                }), previousAdd(record, !temporary, expected.attempts)],
                historyError: temporary ? "Previous recovery is temporary. Restart or sign-out may lose access to it. New saves stay paused until recovery can be stored." : "" });
            this.separation = null; this.preservationFailed = false;
            return this.disposed || !canOperate() ? "stale" : "started";
        } catch {
            if (!storageStarted) return "stale";
            this.preservationFailed = true;
            this.update({ historyError: "Could not preserve previous recovery on this device. Nothing was resent. Keep reviewing or explicitly acknowledge temporary recovery." });
            return "storage-unavailable";
        } finally { this.update({ busy: false }); }
    }
    async checkPrevious(id: string, canRead: () => boolean) {
        if (this.disposed || this.state.busy || !canRead()) return;
        const record = this.state.previous.find(previous => previous.id === id);
        if (!record) return;
        this.update({ busy: true });
        try {
            for (const attempt of record.attempts) {
                if (this.disposed || !canRead()) break;
                const savedAvailability = "Saved previously. Current availability could not be verified; check again.";
                let patch: Partial<Attempt> = { message: attempt.status === "saved" ? savedAvailability
                    : attempt.status === "failed" ? "No receipt found. This attempt was previously confirmed not saved."
                    : attempt.status === "pending" ? "No receipt found. This destination was not sent."
                    : "No receipt is visible yet. This does not prove failure. Review My Places and your groups." };
                try {
                    const result = await readAddResult(this.userId, attempt.requestId);
                    if (result && result.destination_kind === attempt.destination.kind && result.group_id === (attempt.destination.groupId ?? null))
                        patch = { status: "saved", result, message: result.available ? "" : "Saved previously; this entry is deleted or access is no longer available." };
                } catch { patch = { message: attempt.status === "saved" ? savedAvailability : failure }; }
                this.update({ previous: this.state.previous.map(previous => previous.id === id ? { ...previous,
                    attempts: previous.attempts.map(row => row.requestId === attempt.requestId ? { ...row, ...patch } : row) } : previous) });
            }
            if (!this.disposed && canRead()) {
                const current = this.state.previous.find(previous => previous.id === id)!;
                const temporary = this.pendingArchives.find(previous => previous.id === id);
                if (temporary) temporary.markers = current.attempts.map(marker);
                // Preserve newly confirmed statuses locally when possible. This
                // writes no database data and stores no private visit payload.
                if (current.durable) try {
                    await this.store(() => this.preserve([{ id, unreadable: current.unreadable, markers: current.attempts.map(marker) }]));
                } catch { this.update({ historyError: "The receipt check completed, but its latest status could not be stored. Original evidence remains available where previously preserved." }); }
            }
        } finally { this.update({ busy: false }); }
    }
    clearConfirmed() {
        if (!isConfirmedAdd(this.state)) return Promise.resolve(false);
        return this.clear();
    }
    async clear() {
        if (this.disposed || this.state.busy) return false;
        this.update({ busy: true });
        try {
            await this.store(() => AsyncStorage.removeItem(key(this.userId)));
            this.separation = null; this.preservationFailed = false;
            this.update({ attempts: [], error: "", busy: false, restaurant: null }); return !this.disposed;
        } catch { this.update({ busy: false, error: "Could not clear recovery. Check your device storage and try again." }); return false; }
    }
}
