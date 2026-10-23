import Ionicons from "@expo/vector-icons/Ionicons";
import { collectionStyles as s } from "@/styles/collections";
import type { GroupRestaurantSummary } from "@/types/database";
import { visitSummary } from "@/lib/restaurant-ui";
import { Pressable, Text, View } from "react-native";

export function CollectionStats({ restaurants, visits }: { restaurants: number; visits: number }) {
    return <View style={s.stats}>
        <View style={s.stat}><Text style={s.statNumber}>{restaurants}</Text><Text style={s.statLabel}>{restaurants === 1 ? "restaurant" : "restaurants"}</Text></View>
        <View style={s.stat}><Text style={s.statNumber}>{visits}</Text><Text style={s.statLabel}>{visits === 1 ? "saved visit" : "saved visits"}</Text></View>
    </View>;
}

export function RestaurantRow({ restaurant, onPress, disabled = false, first = false }: {
    restaurant: Pick<GroupRestaurantSummary, "name" | "address" | "cuisine" | "average_rating" | "rated_visit_count" | "total_visit_count">;
    onPress: () => void; disabled?: boolean; first?: boolean;
}) {
    return <Pressable accessibilityRole="button" accessibilityLabel={`${restaurant.name}, ${restaurant.address}, ${visitSummary(restaurant)}`}
        disabled={disabled} onPress={onPress} style={({ pressed }) => [s.row, !first && s.rule, pressed && s.pressed, disabled && { opacity: 0.5 }]}>
        <View style={s.body}>
            <Text style={s.name}>{restaurant.name}</Text>
            <Text style={s.address}>{restaurant.address}</Text>
            <Text style={s.metadata}>{[restaurant.cuisine, `${restaurant.total_visit_count} ${restaurant.total_visit_count === 1 ? "visit" : "visits"}`,
                restaurant.average_rating === null ? "Not rated" : `${restaurant.rated_visit_count} rated`].filter(Boolean).join(" · ")}</Text>
        </View>
        {restaurant.average_rating !== null && <View style={s.score} accessible={false}>
            <Ionicons name="star" size={12} color="#A65A32" accessible={false} />
            <Text style={s.scoreText}>{restaurant.average_rating.toFixed(1)}</Text><Text style={s.scoreCaption}>avg / 5</Text>
        </View>}
        <Ionicons name="chevron-forward" size={16} color="#9B8272" accessible={false} />
    </Pressable>;
}
