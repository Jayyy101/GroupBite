import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function SavedPlacesScreen() {
    const router = useRouter();

    return (
        <View style={{ paddingTop: 60, paddingHorizontal: 24 }}>
            <Pressable onPress={() => router.back()}>
                <Text>Back</Text>
            </Pressable>

            <Text>Saved Places</Text>
        </View>
    );
}
