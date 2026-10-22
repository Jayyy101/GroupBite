export type DashboardRead<T> =
    | { status: "loading"; data: null; error: null }
    | { status: "ready"; data: T; error: null }
    | { status: "error"; data: null; error: string };

export type DashboardGroup = {
    id: string;
    name: string;
    role: "Owner" | "Member";
    membershipId: string;
};

type RecentVisit = {
    visitId: string;
    entryId: string;
    name: string;
    address: string;
    visited_on: string | null;
    created_at: string;
    rating: number | null;
};

export type DashboardPersonalVisit = RecentVisit & {
    kind: "personal";
    origin: "legacy" | "visit";
};

export type DashboardGroupVisit = RecentVisit & {
    kind: "group";
    restaurantId: string;
    groupId: string;
    groupName: string;
    membershipId: string;
};

export type DashboardVisit = DashboardPersonalVisit | DashboardGroupVisit;

// Personal visits count history rows, including legacy/undated rows. Groups count
// current memberships (Owners included). Independent destinations are never merged.
export type HomeDashboardSnapshot = {
    places: DashboardRead<number>;
    visits: DashboardRead<number>;
    groups: DashboardRead<{ count: number; preview: DashboardGroup[] }>;
    personalRecent: DashboardRead<DashboardPersonalVisit[]>;
    groupRecent: DashboardRead<DashboardGroupVisit[]>;
};

export type DashboardStatus = "loading" | "ready" | "partial" | "error";
