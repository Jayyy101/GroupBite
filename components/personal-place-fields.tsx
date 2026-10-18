import { AddressAutocomplete } from "@/components/address-autocomplete";
import type { AddressSearchBinding } from "@/hooks/use-address-search";
import type { AddressSuggestion } from "@/lib/address-search";
import { backendStyles as styles } from "@/styles/backend";
import type { PersonalPlaceFields as Fields } from "@/types/database";
import { Text, TextInput, View } from "react-native";

// Restaurant facts only. Independent memories are edited in personal history.
export function PersonalPlaceFields({ value, onChange, busy, addressSelection, onAddressChange, autocomplete }: {
    autocomplete?: AddressSearchBinding;
    value: Fields; onChange: (value: Fields) => void; busy: boolean;
    addressSelection: AddressSuggestion | null;
    onAddressChange: (address: string, selection: AddressSuggestion | null) => void;
}) {
    function change<K extends keyof Fields>(key: K, next: Fields[K]) { onChange({ ...value, [key]: next }); }
    return (
        <View>
            <Text style={styles.label}>Restaurant name</Text>
            <TextInput accessibilityLabel="Restaurant name" value={value.name} onChangeText={text => change("name", text)} maxLength={100} editable={!busy} placeholder="Restaurant name" placeholderTextColor="#79665E" style={styles.input} />
            <Text style={styles.label}>Address</Text>
            <AddressAutocomplete {...autocomplete} value={value.address} selection={addressSelection} onChange={onAddressChange} editable={!busy} />
            <Text style={styles.label}>Cuisine (optional)</Text>
            <TextInput accessibilityLabel="Cuisine" value={value.cuisine ?? ""} onChangeText={text => change("cuisine", text)} maxLength={100} editable={!busy} placeholder="Cuisine" placeholderTextColor="#79665E" style={styles.input} />
        </View>
    );
}
