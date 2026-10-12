import type { PersonalMapPin } from "@/lib/personal-map";
import { useRef } from "react";
import { StyleSheet } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";

export default function DevAppleMap({ pins }: { pins: PersonalMapPin[] }) {
    const map = useRef<MapView>(null);
    if (pins.length === 0) return null;
    return (
        <MapView
            ref={map}
            style={styles.map}
            // The default iOS provider is Apple's native MapKit.
            provider={PROVIDER_DEFAULT}
            initialRegion={{ latitude: pins[0].latitude, longitude: pins[0].longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
            onMapReady={() => map.current?.fitToCoordinates(pins.map(({ latitude, longitude }) => ({ latitude, longitude })), {
                edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false,
            })}
            scrollEnabled
            zoomEnabled
            showsUserLocation={false}
            showsMyLocationButton={false}
        >
            {pins.map(pin => <Marker key={pin.id} identifier={pin.id} coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
                title={pin.name} description={pin.address} />)}
        </MapView>
    );
}

const styles = StyleSheet.create({ map: { flex: 1 } });
