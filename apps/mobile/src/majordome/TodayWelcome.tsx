import {
  WELCOME_DONE_LABEL,
  WELCOME_NAME_PLACEHOLDER,
  WELCOME_NEXT_LABEL,
  WELCOME_SKIP_LABEL,
  welcomeCards,
} from "@t3tools/shared/majordomeWelcome";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/cn";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { majordomeEnvironment } from "./state";

/**
 * The welcome of a new notes folder, at the top of Today: what to call its owner, then three
 * cards on how Majordome works. Shown once per folder, whichever device finishes it.
 */
export function TodayWelcome(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const { environmentId, projectId } = props;
  const welcome = useEnvironmentQuery(
    majordomeEnvironment.welcome({ environmentId, input: { projectId } }),
  );
  const finish = useAtomCommand(majordomeEnvironment.finishWelcome, { reportFailure: false });
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [left, setLeft] = useState(false);
  if (left || !welcome.isSuccess || welcome.data?.pending !== true) return null;

  const cards = welcomeCards(welcome.data.name);
  const card = cards[Math.min(step, cards.length - 1)];
  if (card === undefined) return null;
  const last = step >= cards.length - 1;
  const end = () => {
    setLeft(true);
    void finish({ environmentId, input: { projectId, name: name.trim() === "" ? null : name } });
  };
  const next = () => (last ? end() : setStep(step + 1));

  return (
    <View
      accessibilityLabel="Welcome"
      className="gap-3 rounded-2xl border border-border bg-card p-4"
    >
      <View className="gap-1">
        <Text textRole="headline" className="text-foreground">
          {card.title}
        </Text>
        <Text className="text-foreground-secondary">{card.body}</Text>
      </View>
      {card.key === "name" ? (
        <TextInput
          accessibilityLabel={card.title}
          placeholder={WELCOME_NAME_PLACEHOLDER}
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
          maxLength={80}
          value={name}
          onChangeText={setName}
          onSubmitEditing={next}
        />
      ) : null}
      <View className="flex-row items-center gap-2">
        <View
          className="flex-1 flex-row items-center gap-1.5"
          accessibilityLabel={`Step ${step + 1} of ${cards.length}`}
        >
          {cards.map((each, index) => (
            <View
              key={each.key}
              className={cn(
                "size-1.5 rounded-full",
                index === step ? "bg-primary" : "bg-foreground-muted opacity-40",
              )}
            />
          ))}
        </View>
        {last ? null : (
          <Button label={WELCOME_SKIP_LABEL} tone="text" size="compact" onPress={end} />
        )}
        <Button
          label={last ? WELCOME_DONE_LABEL : WELCOME_NEXT_LABEL}
          tone="primary"
          size="compact"
          onPress={next}
        />
      </View>
    </View>
  );
}
