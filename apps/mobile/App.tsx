import { CameraView, useCameraPermissions } from "expo-camera";
import * as ScreenOrientation from "expo-screen-orientation";
import { useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

const lockFromUrl = async (url: string): Promise<void> => {
  const lock = new URL(url).searchParams.get("orientation") || "";
  if (url.includes("orientation=landscape") || lock === "landscape") {
    await ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE
    );
    return;
  }
  await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
};

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [playUrl, setPlayUrl] = useState<string | null>(null);

  if (!permission) {
    return <View />;
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera is required to scan the lab QR.</Text>
        <Button title="Allow camera" onPress={() => void requestPermission()} />
      </View>
    );
  }

  if (playUrl) {
    return (
      <WebView
        source={{ uri: playUrl }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        style={styles.flex}
      />
    );
  }

  return (
    <View style={styles.flex}>
      <CameraView
        style={styles.flex}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(result) => {
          if (!result.data || playUrl) {
            return;
          }
          setPlayUrl(result.data);
          void lockFromUrl(result.data);
        }}
      />
      <Text style={styles.hint}>Scan the Playable Lab QR from the PC console.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  text: { color: "#e5e7eb", marginBottom: 12, textAlign: "center" },
  hint: {
    position: "absolute",
    bottom: 36,
    alignSelf: "center",
    color: "#fff",
    backgroundColor: "#00000099",
    padding: 8,
  },
});
