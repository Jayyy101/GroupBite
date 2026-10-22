import type { MapCanvasHandle, MapCanvasProps, MapCoordinate, MapRegion } from "@/types/saved-map";
import Ionicons from "@expo/vector-icons/Ionicons";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";

export default forwardRef<MapCanvasHandle, MapCanvasProps>(function SavedMapCanvas(props, ref) {
    const map = useRef<MapView>(null), ready = useRef(false);
    const region = useRef<MapRegion | null>(props.initialRegion);
    const focus = (point: MapCoordinate) => map.current?.animateToRegion({ ...point, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 350);
    const fit = () => {
        if (!ready.current) return;
        const coordinates = props.restaurants.flatMap(r => r.coordinate ? [r.coordinate] : []);
        if (coordinates.length === 1) focus(coordinates[0]);
        // MapKit already applies mapPadding as layout margins. Reapplying the
        // full overlay insets here doubles them and frames far too much area.
        else if (coordinates.length) map.current?.fitToCoordinates(coordinates, { edgePadding: { top: 20, right: 20, bottom: 20, left: 20 }, animated: true });
    };
    useImperativeHandle(ref, () => ({ fit, focus, zoom: direction => {
        const current = region.current;
        if (current) map.current?.animateToRegion({ ...current,
            latitudeDelta: Math.min(160, Math.max(0.0005, current.latitudeDelta * (direction === 1 ? 0.5 : 2))),
            longitudeDelta: Math.min(360, Math.max(0.0005, current.longitudeDelta * (direction === 1 ? 0.5 : 2))) }, 250);
    } }));
    return <MapView ref={map} style={StyleSheet.absoluteFill} provider={PROVIDER_DEFAULT} mapType="mutedStandard" userInterfaceStyle="light"
        initialRegion={props.initialRegion ?? { latitude: 20, longitude: 0, latitudeDelta: 100, longitudeDelta: 160 }}
        mapPadding={props.padding} scrollEnabled zoomEnabled rotateEnabled pitchEnabled showsCompass showsScale
        showsPointsOfInterest={false} showsUserLocation={props.showUser} showsMyLocationButton={false}
        onMapReady={() => { ready.current = true; if (!props.initialRegion) fit(); }}
        onRegionChangeComplete={value => { region.current = value; props.onRegion(value); }} onPress={props.onDismiss}>
        {props.restaurants.flatMap(r => r.coordinate ? [<Marker key={r.key} identifier={r.key} coordinate={r.coordinate}
            accessibilityLabel={`${r.name}, ${r.sources.map(s => s.label).join(", ")}`}
            centerOffset={{ x: 0, y: -23 }} zIndex={props.selected === r.key ? 10 : 1}
            onPress={event => { event.stopPropagation(); props.onSelect(r.key); }}>
            <View collapsable={false} style={s.marker}>
                <View style={[s.bubble, props.selected === r.key && s.selected]}>
                    <Ionicons name="restaurant" size={22} color={props.selected === r.key ? "#FFFFFF" : "#A33720"} accessible={false} />
                </View><View style={[s.tip, props.selected === r.key && s.selectedTip]} />
            </View>
        </Marker>] : [])}
    </MapView>;
});

const s = StyleSheet.create({
    marker: { width: 48, height: 56, alignItems: "center", paddingTop: 2 },
    bubble: { width: 43, height: 43, borderRadius: 17, backgroundColor: "#FFEFDC", borderWidth: 2.5, borderColor: "#AB3B22",
        alignItems: "center", justifyContent: "center", shadowColor: "#352219", shadowOpacity: 0.28, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } },
    selected: { backgroundColor: "#A33720", borderColor: "#FFFFFF", borderWidth: 3 },
    tip: { width: 10, height: 10, backgroundColor: "#AB3B22", transform: [{ rotate: "45deg" }], marginTop: -5, zIndex: -1 },
    selectedTip: { backgroundColor: "#FFFFFF" },
});
