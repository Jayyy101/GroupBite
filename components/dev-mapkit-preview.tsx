import type { AppleSearchLocation } from "@/lib/apple-map-search";
import type { PersonalMapPin } from "@/lib/personal-map";
import { Text } from "react-native";

export default function DevMapKitPreview(_props: { selection: AppleSearchLocation | null; saved: PersonalMapPin | null }) {
    return <Text>Apple search preview is available only on iOS.</Text>;
}
