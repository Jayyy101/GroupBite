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

// Types for the Milestone 8 migration; database permissions restrict writes.
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
        };
        Views: { [_ in never]: never };
        Functions: {
            create_group: { Args: { group_name: string }; Returns: Group };
        };
        Enums: { [_ in never]: never };
        CompositeTypes: { [_ in never]: never };
    };
};
