import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { readAddResult } from "@/lib/unified-add";
import { PhotoJobs } from "@/lib/visit-photo-jobs";
import { listVisitPhotos, reservePhoto, uploadPhotoFile } from "@/lib/visit-photos";
import { withRequestDeadline } from "@/lib/request-deadline";
import { releasePhotoCopies } from "@/lib/visit-photo-files";

const Context = createContext<{ jobs: PhotoJobs; revision: number } | null>(null);
const writes = new Map<string, Promise<unknown>>();
export function VisitPhotosProvider({ userId, children }: { userId: string; children: ReactNode }) {
    const [revision, render] = useState(0);
    const [jobs] = useState(() => {
        const key = `groupbite:visit-photos:v1:${userId}`;
        const read = async () => { await writes.get(key)?.catch(() => {}); return AsyncStorage.getItem(key); };
        return new PhotoJobs({ read: () => withRequestDeadline(read),
            write: value => {
                const write = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(() => AsyncStorage.setItem(key, value));
                writes.set(key, write);
                return withRequestDeadline(() => write);
            }, uuid: randomUUID, receipt: id => readAddResult(userId, id),
            list: target => listVisitPhotos(userId, target), reserve: (job, can) => reservePhoto(userId, job, can),
            upload: (job, variant, can) => uploadPhotoFile(userId, job, variant, can),
            releaseAsset: asset => releasePhotoCopies(userId, asset) });
    });
    useEffect(() => {
        jobs.activate();
        const off = jobs.subscribe(() => render(v => v + 1));
        void jobs.restore();
        return () => { off(); jobs.dispose(); };
    }, [jobs]);
    return <Context.Provider value={{ jobs, revision }}>{children}</Context.Provider>;
}
export function usePhotoJobs() { return useContext(Context)?.jobs ?? null; }
