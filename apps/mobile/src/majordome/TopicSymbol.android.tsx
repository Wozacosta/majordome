import IconArrowUpCircle from "@tabler/icons-react-native/IconArrowUpCircle";
import IconBarbell from "@tabler/icons-react-native/IconBarbell";
import IconBook from "@tabler/icons-react-native/IconBook";
import IconBriefcase from "@tabler/icons-react-native/IconBriefcase";
import IconBulb from "@tabler/icons-react-native/IconBulb";
import IconCar from "@tabler/icons-react-native/IconCar";
import IconChevronDown from "@tabler/icons-react-native/IconChevronDown";
import IconChevronUp from "@tabler/icons-react-native/IconChevronUp";
import IconCode from "@tabler/icons-react-native/IconCode";
import IconCreditCard from "@tabler/icons-react-native/IconCreditCard";
import IconCurrencyBitcoin from "@tabler/icons-react-native/IconCurrencyBitcoin";
import IconDots from "@tabler/icons-react-native/IconDots";
import IconEdit from "@tabler/icons-react-native/IconEdit";
import IconHash from "@tabler/icons-react-native/IconHash";
import IconHeartbeat from "@tabler/icons-react-native/IconHeartbeat";
import IconHome from "@tabler/icons-react-native/IconHome";
import IconLanguage from "@tabler/icons-react-native/IconLanguage";
import IconLeaf from "@tabler/icons-react-native/IconLeaf";
import IconMessageCircle from "@tabler/icons-react-native/IconMessageCircle";
import IconMusic from "@tabler/icons-react-native/IconMusic";
import IconPencil from "@tabler/icons-react-native/IconPencil";
import IconPlane from "@tabler/icons-react-native/IconPlane";
import IconReceipt from "@tabler/icons-react-native/IconReceipt";
import IconRefresh from "@tabler/icons-react-native/IconRefresh";
import IconToolsKitchen2 from "@tabler/icons-react-native/IconToolsKitchen2";
import IconUsers from "@tabler/icons-react-native/IconUsers";
import IconWalk from "@tabler/icons-react-native/IconWalk";
import type { Icon } from "@tabler/icons-react-native/types";
import type { SFSymbol, SymbolViewProps } from "expo-symbols";
import { withUniwind } from "uniwind";

// Android has no system symbols: each name a chat row or topic wears is drawn by its own icon.
const ICONS: Partial<Record<SFSymbol, Icon>> = {
  number: IconHash,
  "dumbbell.fill": IconBarbell,
  "figure.walk": IconWalk,
  "creditcard.fill": IconCreditCard,
  "doc.text.fill": IconReceipt,
  "bitcoinsign.circle.fill": IconCurrencyBitcoin,
  airplane: IconPlane,
  "heart.fill": IconHeartbeat,
  "book.fill": IconBook,
  "character.bubble.fill": IconLanguage,
  "briefcase.fill": IconBriefcase,
  "house.fill": IconHome,
  "fork.knife": IconToolsKitchen2,
  "music.note": IconMusic,
  "chevron.left.forwardslash.chevron.right": IconCode,
  "pencil.line": IconPencil,
  "person.2.fill": IconUsers,
  "leaf.fill": IconLeaf,
  "car.fill": IconCar,
  "lightbulb.fill": IconBulb,
  ellipsis: IconDots,
  "arrow.triangle.2.circlepath": IconRefresh,
  "bubble.left.fill": IconMessageCircle,
  "square.and.pencil": IconEdit,
  "arrow.up.circle": IconArrowUpCircle,
  "chevron.up": IconChevronUp,
  "chevron.down": IconChevronDown,
};

function TopicSymbol(props: SymbolViewProps) {
  const name = typeof props.name === "string" ? props.name : props.name.ios;
  const AndroidIcon = (name ? ICONS[name] : undefined) ?? IconHash;
  return (
    <AndroidIcon
      color={props.tintColor}
      size={props.size}
      strokeWidth={2}
      style={props.style}
      testID={props.testID}
    />
  );
}

export const TopicSymbolView = withUniwind(TopicSymbol);
