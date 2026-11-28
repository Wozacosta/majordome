import { View } from "react-native";

import { AppText as Text } from "../components/ui/AppText";

/** One numbered thing to do. */
export function Step(props: {
  readonly number: number;
  readonly text: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <View className="flex-row gap-4">
      <View className="size-8 items-center justify-center rounded-full bg-primary/10">
        <Text className="font-t3-bold text-primary-text">{props.number}</Text>
      </View>
      <View className="min-w-0 flex-1 gap-3 pt-1">
        <Text className="text-foreground">{props.text}</Text>
        {props.children}
      </View>
    </View>
  );
}
