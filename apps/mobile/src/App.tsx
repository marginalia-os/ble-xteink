import { BLE_TRANSFER_SERVICE_UUID } from "@workspace/ble-protocol"
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native"

export function App() {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>BLE companion</Text>
        <Text style={styles.title}>BLE Xteink</Text>
        <Text style={styles.body}>
          Native BLE support uses the same transfer protocol package as the web
          client.
        </Text>
        <Text style={styles.mono}>{BLE_TRANSFER_SERVICE_UUID}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f8f5ee",
  },
  panel: {
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  eyebrow: {
    color: "#6f695d",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    color: "#181713",
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 0,
  },
  body: {
    color: "#332f28",
    fontSize: 17,
    lineHeight: 24,
  },
  mono: {
    color: "#6f695d",
    fontFamily: "monospace",
    fontSize: 12,
  },
})
