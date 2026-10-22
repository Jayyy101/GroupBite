import type { MapKitAddress } from "@/lib/mapkit-address";

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

export type PersonalPlaceFields = {
    name: string;
    address: string;
    cuisine: string | null;
    visited_on: string | null;
    rating: number | null;
    would_go_again: boolean | null;
    notes: string | null;
};

export type PersonalPlace = PersonalPlaceFields & {
    // Older schemas/responses may omit this creation-only identifier.
    apple_place_id?: string | null;
    id: string;
    owner_user_id: string;
    client_request_id: string;
    created_at: string;
    updated_at: string;
    revision: number;
};

export type PersonalVisit = Pick<PersonalPlaceFields, "visited_on" | "rating" | "would_go_again" | "notes"> & {
    id: string; personal_place_id: string; owner_user_id: string; origin: "legacy" | "visit";
    created_at: string; updated_at: string; revision: number;
};
export type PersonalPlaceSummary = PersonalPlace & Pick<GroupRestaurantSummary, "average_rating" | "rated_visit_count" | "total_visit_count">;
export type AddRestaurant = {
    name: string; address: string; cuisine: string | null; apple_place_id?: string | null;
    destination_kind?: "personal" | "group"; group_id?: string | null; entry_id?: string;
    // Transient native selection tied to display facts, never a route/journal value.
    mapkit_point?: Readonly<{ name: string; address: string; latitude: number; longitude: number; structured_address?: MapKitAddress | null }>;
};
export type AddVisitArgs = {
    client_request_id: string; restaurant_name: string; restaurant_address: string;
    restaurant_cuisine: string | null; restaurant_apple_place_id: string | null;
    target_entry_id: string | null; visit_date: string | null; visit_rating: number | null;
    visit_would_go_again: boolean | null; visit_notes: string | null;
};
export type AddDestinationResult = {
    destination_kind: "personal" | "group"; group_id: string | null;
    entry_id: string | null; visit_id: string | null; available: boolean;
};

export type GroupRestaurant = {
    apple_place_id?: string | null;
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

export type SavedLocation = {
    saved_kind: "personal" | "group";
    saved_id: string;
    restaurant_id: string | null;
    group_id: string | null;
    group_name: string | null;
    name: string;
    address: string;
    cuisine: string | null;
    latitude: number | null;
    longitude: number | null;
    resolution_status: "unresolved" | "resolved" | "failed" | "ambiguous";
    standardized_address: string | null;
    resolution_accuracy: "building" | "address" | null;
    distance_meters: number | null;
    personal_rating: number | null;
    group_average_rating: number | null;
    rated_visit_count: number | null;
    total_visit_count: number | null;
};

// Types for the applied schema; database permissions restrict writes.
export type Database = {
    public: {
        Tables: {
            personal_mapkit_locations: { Row: { personal_place_id: string; owner_user_id: string; address_snapshot: string;
                latitude: number; longitude: number; structured_address: MapKitAddress | null; created_at: string };
                Insert: never; Update: never; Relationships: [] };
            group_mapkit_locations: { Row: { group_restaurant_id: string; address_snapshot: string;
                latitude: number; longitude: number; structured_address: MapKitAddress | null; created_at: string };
                Insert: never; Update: never; Relationships: [] };
            // Existing migration-8 tables: read types only, no new permissions.
            personal_place_locations: { Row: {
                personal_place_id: string; address_snapshot: string; resolution_status: "unresolved" | "resolved" | "failed" | "ambiguous";
                standardized_address: string | null; resolution_accuracy: "address" | "building" | null;
                latitude: number | null; longitude: number | null;
            }; Insert: never; Update: never; Relationships: [] };
            group_restaurant_locations: { Row: {
                group_restaurant_id: string; address_snapshot: string; resolution_status: "unresolved" | "resolved" | "failed" | "ambiguous";
                standardized_address: string | null; resolution_accuracy: "address" | "building" | null;
                latitude: number | null; longitude: number | null;
            }; Insert: never; Update: never; Relationships: [] };
            personal_visits: { Row: PersonalVisit; Insert: never; Update: never; Relationships: [] };
            personal_places: {
                Row: PersonalPlace;
                Insert: never;
                Update: never;
                Relationships: [];
            };
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
            save_visit_event_destination: { Args: AddVisitArgs & { client_event_id: string; destination_kind: "personal" | "group";
                target_group_id: string | null; expected_membership_id: string | null; selected_latitude: number | null;
                selected_longitude: number | null; selected_address: MapKitAddress | null }; Returns: string };
            get_my_visit_event_summary: { Args: Record<string, never>;
                Returns: { linked_events: number; linked_records: number; unlinked_records: number }[] };
            save_personal_visit_with_mapkit_location: { Args: AddVisitArgs & { selected_latitude: number; selected_longitude: number;
                selected_address: MapKitAddress | null }; Returns: string };
            save_group_visit_with_mapkit_location: { Args: AddVisitArgs & { target_group_id: string; expected_membership_id: string;
                selected_latitude: number; selected_longitude: number; selected_address: MapKitAddress | null }; Returns: string };
            get_saved_mapkit_location: { Args: { target_kind: "personal" | "group"; target_entry_id: string; expected_address: string };
                Returns: NonNullable<AddRestaurant["mapkit_point"]> | null };
            get_recent_add_restaurants_with_mapkit: { Args: { page_size?: number; page_offset?: number };
                Returns: (AddRestaurant & { destination_kind: "personal" | "group"; group_id: string | null; entry_id: string })[] };
            save_personal_visit_with_mapkit_point: { Args: AddVisitArgs & { selected_latitude: number; selected_longitude: number }; Returns: string };
            set_personal_mapkit_location: { Args: { target_personal_place_id: string; expected_revision: number; expected_address: string;
                selected_latitude: number; selected_longitude: number }; Returns: boolean };
            set_personal_mapkit_location_with_address: { Args: { target_personal_place_id: string; expected_revision: number; expected_address: string;
                selected_latitude: number; selected_longitude: number; selected_address: MapKitAddress | null }; Returns: boolean };
            get_personal_mapkit_locations: { Args: { page_size?: number; page_offset?: number };
                Returns: { id: string; owner_user_id: string; name: string; address: string; latitude: number; longitude: number }[] };
            save_personal_visit: { Args: AddVisitArgs; Returns: string };
            save_group_visit_destination: { Args: AddVisitArgs & { target_group_id: string; expected_membership_id: string }; Returns: string };
            get_add_destination_result: { Args: { client_request_id: string }; Returns: AddDestinationResult[] };
            get_recent_add_restaurants: { Args: { page_size?: number; page_offset?: number }; Returns: (AddRestaurant & { destination_kind: "personal" | "group"; group_id: string | null; entry_id: string })[] };
            update_personal_place: { Args: { target_personal_place_id: string; expected_revision: number;
                restaurant_name: string; restaurant_address: string; restaurant_cuisine: string | null }; Returns: PersonalPlace[] };
            delete_personal_place: { Args: { target_personal_place_id: string; expected_revision: number }; Returns: boolean };
            manage_personal_visit: { Args: { target_personal_place_id: string; target_visit_id: string; expected_revision: number;
                remove_visit: boolean; visit_date: string | null; visit_rating: number | null;
                visit_would_go_again: boolean | null; visit_notes: string | null }; Returns: PersonalVisit[] };
            get_saved_locations: { Args: {
                scope?: "all" | "personal" | "group";
                target_group_id?: string | null;
                center_latitude?: number | null;
                center_longitude?: number | null;
                radius_meters?: number | null;
                page_size?: number;
                page_offset?: number;
            }; Returns: SavedLocation[] };
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
            save_restaurant_visit_with_apple_place_id: {
                Args: SaveVisitArgs & { restaurant_apple_place_id?: string | null };
                Returns: { restaurant_id: string; bindings_recorded: boolean }[];
            };
            get_group_restaurant_apple_place_id: {
                Args: { target_group_id: string; target_group_restaurant_id: string };
                Returns: { group_id: string; group_restaurant_id: string; apple_place_id: string | null }[];
            };
            update_group_visit: { Args: UpdateVisitArgs; Returns: undefined };
            delete_group_visit: { Args: VisitScope; Returns: boolean };
            get_group_restaurants: { Args: { target_group_id: string }; Returns: GroupRestaurantSummary[] };
            get_group_restaurant_visits: { Args: { target_group_restaurant_id: string }; Returns: GroupVisit[] };
        };
        Enums: { [_ in never]: never };
        CompositeTypes: { [_ in never]: never };
    };
};
