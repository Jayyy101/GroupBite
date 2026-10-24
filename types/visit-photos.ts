export type PhotoTarget = {
    kind: "personal" | "group";
    entryId: string;
    visitId: string;
    groupId?: string;
    membershipId?: string;
};
export type VisitPhoto = {
    id: string;
    image_path: string;
    thumbnail_path: string;
    width: number;
    height: number;
    state: "pending" | "ready" | "removed";
    revision: number;
};
export type SelectedPhoto = {
    id: string;
    image: string;
    thumbnail: string;
    width: number;
    height: number;
    bytes: number;
    thumbnailBytes: number;
};
export type PhotoJob = {
    id: string;
    asset: SelectedPhoto;
    target?: PhotoTarget;
    requestId?: string;
    destination: { kind: "personal" | "group"; groupId?: string; membershipId?: string };
    status: "waiting" | "uploading" | "review" | "done";
};
