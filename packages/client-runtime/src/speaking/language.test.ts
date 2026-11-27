import { describe, expect, it } from "vite-plus/test";

import { detectSpeechLanguage, pickSpeechLanguage } from "./language.ts";
import { VOICE_CATALOG } from "./voiceCatalog.ts";

const supported = VOICE_CATALOG.languages;

describe("speech language", () => {
  it.each([
    ["en", "The meeting is on Thursday and you have not replied to the invitation."],
    ["fr", "La réunion est jeudi et vous n'avez pas encore répondu à cette invitation."],
    ["es", "La reunión es el jueves y no has respondido a la invitación para los clientes."],
    ["de", "Das Treffen ist am Donnerstag und ich habe die Einladung nicht beantwortet."],
    [
      "it",
      "La riunione è giovedì e non hai risposto per il momento, sono in attesa della conferma.",
    ],
    ["pt", "A reunião é na quinta e você não respondeu, isso está na agenda com os clientes."],
    ["ru", "Встреча в четверг, и вы ещё не ответили на приглашение."],
    ["uk", "Зустріч у четвер, і ви ще не відповіли на запрошення її учасників."],
    ["ja", "会議は木曜日です。まだ招待に返信していません。"],
    ["ko", "회의는 목요일이며 아직 초대에 답하지 않았습니다."],
    ["ar", "الاجتماع يوم الخميس ولم ترد على الدعوة بعد."],
  ])("hears %s", (language, text) => {
    expect(detectSpeechLanguage(text, supported)).toBe(language);
  });

  it("follows the reply, not the app", () => {
    expect(
      pickSpeechLanguage(
        "Voici la liste des fichiers que nous avons dans le dossier.",
        "en",
        supported,
      ),
    ).toBe("fr");
  });

  it("falls back to the app language when the text does not say", () => {
    expect(pickSpeechLanguage("OK.", "fr-FR", supported)).toBe("fr");
    expect(pickSpeechLanguage("42", "de", supported)).toBe("de");
  });

  it("falls back to English when the app language has no voice", () => {
    expect(pickSpeechLanguage("OK.", "zh-CN", supported)).toBe("en");
  });

  it("never picks a language the voice does not speak", () => {
    expect(detectSpeechLanguage("会議は木曜日です。", ["en", "fr"])).toBeNull();
  });
});
