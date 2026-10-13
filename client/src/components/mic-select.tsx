import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AudioInputDevice } from "@/hooks/use-audio-devices";

/** Audio input picker; pair with useAudioDevices and pass its value to useDictation. */
export function MicSelect({
  devices,
  value,
  onValueChange,
  disabled,
  className = "w-full text-xs h-9",
}: {
  devices: AudioInputDevice[];
  value: string;
  onValueChange: (deviceId: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className} aria-label="Select audio input device" data-testid="select-microphone">
        <SelectValue placeholder="Select microphone" />
      </SelectTrigger>
      <SelectContent>
        {devices.map((device) => (
          <SelectItem key={device.deviceId} value={device.deviceId} className="text-xs">
            {device.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
