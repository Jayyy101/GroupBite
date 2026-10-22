import type { MapCanvasHandle, MapCanvasProps } from "@/types/saved-map";
import { forwardRef } from "react";
import { Text } from "react-native";
export default forwardRef<MapCanvasHandle, MapCanvasProps>(function SavedMapCanvas(_props, _ref) {
    return <Text>Saved Map is available in the iOS development build.</Text>;
});
