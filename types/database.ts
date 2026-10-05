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
        };
        Enums: { [_ in never]: never };
        CompositeTypes: { [_ in never]: never };
    };
};
