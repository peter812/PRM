import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "prm_audio_input_device_id";

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export function useAudioDevices() {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY) || "default";
    }
    return "default";
  });

  const setSelectedDeviceId = useCallback((deviceId: string) => {
    const val = deviceId || "default";
    setSelectedDeviceIdState(val);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, val);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices
        .filter((d) => d.kind === "audioinput")
        .map((d, index) => {
          const deviceId = d.deviceId || (index === 0 ? "default" : `device-${index}`);
          const label = d.label || (index === 0 ? "Default Microphone" : `Microphone ${index + 1}`);
          return { deviceId, label };
        });

      if (audioInputs.length === 0) {
        setDevices([{ deviceId: "default", label: "Default Microphone" }]);
        return;
      }

      setDevices(audioInputs);

      // Verify that current selectedDeviceId still exists in the list
      setSelectedDeviceIdState((current) => {
        if (!current || current === "default") return "default";
        const exists = audioInputs.some((d) => d.deviceId === current);
        return exists ? current : "default";
      });
    } catch (err) {
      console.error("Failed to enumerate audio devices:", err);
    }
  }, []);

  useEffect(() => {
    refreshDevices();

    const handleDeviceChange = () => {
      refreshDevices();
    };

    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshDevices]);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    refreshDevices,
  };
}
