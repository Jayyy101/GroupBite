import type { PersonalMapPin } from "@/lib/personal-map";
import { Text } from "react-native";

// Metro selects dev-apple-map.ios.tsx on iOS. Other platforms never load MapKit.
export default function DevAppleMap(_props: { pins: PersonalMapPin[] }) {
    return <Text>This development proof of concept is available only on iOS.</Text>;
}
