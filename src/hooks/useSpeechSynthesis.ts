"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export function splitTextIntoSentences(text: string): string[] {
  if (!text) return [];
  // Strip UI components <ui-component ... />
  const cleanText = text
    .replace(/<ui-component\s+name="[^"]+"\s+props='[^']+'\s*\/>/g, "")
    .trim();
  if (!cleanText) return [];

  // Split on sentence boundaries (. ! ?) avoiding numbered list prefixes like "1."
  const sentences = cleanText.split(/(?<=[!?])\s+|(?<=(?<!\b\d+)\.)\s+/g);
  return sentences.length > 0 ? sentences : [cleanText];
}

export interface UseSpeechSynthesisReturn {
  isSupported: boolean;
  speakingMessageId: string | null;
  speakingSentenceIndex: number | null;
  speakMessage: (messageId: string, text: string) => void;
  stopSpeech: () => void;
}

export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(
    null,
  );
  const [speakingSentenceIndex, setSpeakingSentenceIndex] = useState<
    number | null
  >(null);

  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      setIsSupported(true);
    } else {
      setIsSupported(false);
    }
  }, []);

  const stopSpeech = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    utterancesRef.current = [];
    setSpeakingMessageId(null);
    setSpeakingSentenceIndex(null);
  }, []);

  const speakMessage = useCallback(
    (messageId: string, text: string) => {
      stopSpeech();

      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }

      const sentences = splitTextIntoSentences(text);
      if (sentences.length === 0) return;

      const utterances: SpeechSynthesisUtterance[] = [];

      sentences.forEach((sentenceText, idx) => {
        const utterance = new SpeechSynthesisUtterance(sentenceText.trim());
        utterance.onstart = () => {
          setSpeakingMessageId(messageId);
          setSpeakingSentenceIndex(idx);
        };
        utterance.onend = () => {
          if (idx === sentences.length - 1) {
            setSpeakingMessageId(null);
            setSpeakingSentenceIndex(null);
          }
        };
        utterance.onerror = () => {
          setSpeakingMessageId(null);
          setSpeakingSentenceIndex(null);
        };
        utterances.push(utterance);
      });

      utterancesRef.current = utterances;
      utterances.forEach((u) => window.speechSynthesis.speak(u));
    },
    [stopSpeech],
  );

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    isSupported,
    speakingMessageId,
    speakingSentenceIndex,
    speakMessage,
    stopSpeech,
  };
}
