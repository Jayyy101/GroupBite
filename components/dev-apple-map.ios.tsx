import { StyleSheet } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";

const sampleLocation = { latitude: 37.7955, longitude: -122.3937 };

export default function DevAppleMap() {
    return (
        <MapView
            style={styles.map}
            // The default iOS provider is Apple's native MapKit.
            provider={PROVIDER_DEFAULT}
            initialRegion={{ ...sampleLocation, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
            scrollEnabled
            zoomEnabled
        >
            <Marker coordinate={sampleLocation} title="Sample: San Francisco Ferry Building" />
        </MapView>
    );
}

const styles = StyleSheet.create({ map: { flex: 1 } });
