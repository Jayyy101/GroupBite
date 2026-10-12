import type { AppleSearchLocation } from "@/lib/apple-map-search";
import type { PersonalMapPin } from "@/lib/personal-map";
import { useRef } from "react";
import { StyleSheet } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";

export type PreviewProps = { selection: AppleSearchLocation | null; saved: PersonalMapPin | null };
export default function DevMapKitPreview({ selection, saved }: PreviewProps) {
    const map = useRef<MapView>(null), ready = useRef(false), center = selection ?? saved;
    if (!center) return null;
    const coordinates = [selection, saved].filter((pin): pin is AppleSearchLocation | PersonalMapPin => pin !== null)
        .map(({ latitude, longitude }) => ({ latitude, longitude }));
    const fit = () => {
        if (ready.current) map.current?.fitToCoordinates(coordinates, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false });
    };
    return <MapView ref={map} style={styles.map} provider={PROVIDER_DEFAULT}
        initialRegion={{ latitude: center.latitude, longitude: center.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 }}
        onMapReady={() => { ready.current = true; fit(); }} onLayout={fit}
        scrollEnabled zoomEnabled showsUserLocation={false} showsMyLocationButton={false}>
        {saved && <Marker coordinate={{ latitude: saved.latitude, longitude: saved.longitude }} title={`Saved Geoapify: ${saved.name}`}
            description={saved.address} pinColor="red" draggable={false} />}
        {selection && <Marker coordinate={{ latitude: selection.latitude, longitude: selection.longitude }} title={`Apple: ${selection.name}`}
            description={selection.address} pinColor="blue" draggable={false} />}
    </MapView>;
}
const styles = StyleSheet.create({ map: { flex: 1, minHeight: 240 } });
