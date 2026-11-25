import type { ColorValue } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);
const ThemedRect = withUniwind(Rect);

// The 16px-grid cloche from assets/brand/cloche-small.svg; the knob keeps the brand's live green.
export function MajordomeCloche(props: {
  readonly size: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg height={props.size} width={props.size} viewBox="0 0 16 16">
      <ThemedPath
        d="M3 11a5 5 0 0 1 10 0Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
      <ThemedRect
        x="2"
        y="12"
        width="12"
        height="2"
        rx="1"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
      <Circle cx="8" cy="3" r="2" fill="#3ddc84" />
    </Svg>
  );
}
