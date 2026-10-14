import { Image } from "react-native";
import { DEEPSEEK_ICON_DATA_URI } from "./deepseek-icon-data.js";

/**
 * The DeepSeek mark for this plugin's own sidebar row.
 *
 * Paseo renders a plugin's SVG only for provider and usage-source branding; a contributed
 * `SidebarRow` icon is a Lucide name or a component, and the plugin client runtime has no SVG
 * renderer and no image loader. So the source `icon.svg` is rasterised into a data URI that
 * `Image` can tint, which behaves the same on web and native. `npm run icon` refreshes it.
 */
export function DeepSeekIcon({ size, color }: { size: number; color: string }) {
  return (
    <Image
      source={{ uri: DEEPSEEK_ICON_DATA_URI }}
      resizeMode="contain"
      tintColor={color}
      accessible={false}
      style={{ width: size, height: size }}
    />
  );
}
