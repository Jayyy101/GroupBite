import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function AddPlaceScreen() {
    const router = useRouter();

    return (
        <View style={{ paddingTop: 60, paddingHorizontal: 24 }}>
            <Pressable onPress={() => router.back()}>
                <Text>Back</Text>
            </Pressable>

            <Text>Add a Place</Text>
        </View>
    );
}
