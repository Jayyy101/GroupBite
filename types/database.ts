export type Profile = {
    id: string;
    display_name: string;
    created_at: string;
};

export type Group = {
    id: string;
    name: string;
    owner_user_id: string;
    created_at: string;
};

type Membership = {
    group_id: string;
    user_id: string;
    joined_at: string;
    membership_id: string;
};

export type GroupMembershipTarget = {
    user_id: string;
    membership_id: string;
    display_name: string;
};

export type JoinRequest = {
    id: string;
    group_id: string;
    user_id: string;
    invite_id: string;
    status: "pending" | "approved" | "denied";
    requested_at: string;
    decided_by: string | null;
    decided_at: string | null;
};

export type PendingJoinRequest = {
    id: string;
    display_name: string;
    requested_at: string;
};

export type GroupMember = {
    user_id: string;
    display_name: string;
    is_owner: boolean;
};

export type GroupInvite = {
    id: string;
    group_id: string;
    token_hash: string;
    created_by: string;
    created_at: string;
    expires_at: string | null;
    revoked_at: string | null;
};

export type Restaurant = {
    id: string;
    name: string;
    address: string;
    cuisine: string | null;
    created_at: string;
    updated_at: string;
};

export type GroupRestaurant = {
    id: string;
    group_id: string;
    restaurant_id: string;
    created_by: string;
    created_at: string;
};

export type Visit = {
    id: string;
    group_restaurant_id: string;
    created_by: string;
    visited_on: string | null;
    rating: number | null;
    would_go_again: boolean | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
};

export type GroupRestaurantSummary = {
    id: string;
    restaurant_id: string;
    name: string;
    address: string;
    cuisine: string | null;
    average_rating: number | null;
    rated_visit_count: number;
    total_visit_count: number;
};

export type GroupVisit = Pick<Visit, "id" | "visited_on" | "rating" | "would_go_again" | "notes" | "created_at"> & {
    creator_display_name: string;
    can_manage: boolean;
};

export type VisitScope = {
    target_group_id: string;
    target_group_restaurant_id: string;
    target_visit_id: string;
};

export type UpdateVisitArgs = VisitScope & {
    visit_date: string | null;
    visit_rating: number | null;
    visit_would_go_again: boolean | null;
    visit_notes: string | null;
};

export type SaveVisitArgs = {
    client_request_id: string;
    target_group_ids: string[];
    restaurant_name: string;
    restaurant_address: string;
    restaurant_cuisine?: string | null;
    visit_date?: string | null;
    visit_rating?: number | null;
    visit_would_go_again?: boolean | null;
    visit_notes?: string | null;
};

// Types for the applied schema; database permissions restrict writes.
export type Database = {
    public: {
        Tables: {
            profiles: {
                Row: Profile;
                Insert: { id: string; display_name: string; created_at?: string };
                Update: { display_name?: string };
                Relationships: [];
            };
            groups: {
                Row: Group;
                Insert: { id?: string; name: string; owner_user_id: string; created_at?: string };
                Update: { name?: string };
                Relationships: [];
            };
            group_memberships: {
                Row: Membership;
                Insert: { group_id: string; user_id: string; joined_at?: string };
                Update: never;
                Relationships: [];
            };
            group_invites: {
                Row: GroupInvite;
                Insert: never;
                Update: never;
                Relationships: [];
            };
            join_requests: {
                Row: JoinRequest;
                Insert: never;
                Update: never;
                Relationships: [];
            };
            restaurants: {
                Row: Restaurant;
                Insert: never;
                Update: never;
                Relationships: [];
            };
            group_restaurants: {
                Row: GroupRestaurant;
                Insert: never;
                Update: never;
                Relationships: [];
            };
            visits: {
                Row: Visit;
                Insert: never;
                Update: never;
                Relationships: [];
            };
            visit_save_requests: {
                Row: { user_id: string; request_id: string; payload_hash: string; restaurant_id: string | null; created_at: string };
                Insert: never;
                Update: never;
                Relationships: [];
            };
        };
        Views: { [_ in never]: never };
        Functions: {
            create_group: { Args: { group_name: string }; Returns: Group };
            generate_group_invite: { Args: { target_group_id: string }; Returns: string };
            revoke_group_invite: { Args: { target_group_id: string }; Returns: undefined };
            request_group_access: { Args: { invite_code: string }; Returns: string };
            decide_join_request: { Args: { target_request_id: string; decision: "approved" | "denied" }; Returns: undefined };
            get_pending_join_requests: { Args: { target_group_id: string }; Returns: PendingJoinRequest[] };
            get_group_members: { Args: { target_group_id: string }; Returns: GroupMember[] };
            get_group_membership_targets: { Args: { target_group_id: string }; Returns: GroupMembershipTarget[] };
            leave_group: { Args: { target_group_id: string; expected_membership_id: string }; Returns: undefined };
            remove_group_member: { Args: { target_group_id: string; target_user_id: string; expected_membership_id: string }; Returns: undefined };
            transfer_group_ownership: { Args: { target_group_id: string; target_user_id: string; expected_membership_id: string }; Returns: undefined };
            save_restaurant_visit: { Args: SaveVisitArgs; Returns: string };
            update_group_visit: { Args: UpdateVisitArgs; Returns: undefined };
            delete_group_visit: { Args: VisitScope; Returns: boolean };
            get_group_restaurants: { Args: { target_group_id: string }; Returns: GroupRestaurantSummary[] };
            get_group_restaurant_visits: { Args: { target_group_restaurant_id: string }; Returns: GroupVisit[] };
        };
        Enums: { [_ in never]: never };
        CompositeTypes: { [_ in never]: never };
    };
};
