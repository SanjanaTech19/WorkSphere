import { renderHook, act } from "@testing-library/react";
import {
  useSpeechSynthesis,
  splitTextIntoSentences,
} from "@/hooks/useSpeechSynthesis";

describe("splitTextIntoSentences", () => {
  it("splits text into sentences by punctuation boundaries", () => {
    const text = "Hello world! This is a test. How are you doing today?";
    const sentences = splitTextIntoSentences(text);
    expect(sentences).toEqual([
      "Hello world!",
      "This is a test.",
      "How are you doing today?",
    ]);
  });

  it("strips UI components from text before splitting", () => {
    const text =
      "Found 3 cafes.<ui-component name=\"Map\" props='{}' /> 1. Cafe Central is quiet.";
    const sentences = splitTextIntoSentences(text);
    expect(sentences).toEqual(["Found 3 cafes.", "1. Cafe Central is quiet."]);
  });
});

describe("useSpeechSynthesis", () => {
  let mockSpeak: jest.Mock;
  let mockCancel: jest.Mock;

  beforeEach(() => {
    mockSpeak = jest.fn();
    mockCancel = jest.fn();

    // Mock window.speechSynthesis & SpeechSynthesisUtterance
    Object.defineProperty(window, "speechSynthesis", {
      writable: true,
      value: {
        speak: mockSpeak,
        cancel: mockCancel,
      },
    });

    (global as any).SpeechSynthesisUtterance = jest
      .fn()
      .mockImplementation((text) => ({
        text,
        onstart: null,
        onend: null,
        onerror: null,
      }));
  });

  it("detects SpeechSynthesis support and handles play/stop flow", () => {
    const { result } = renderHook(() => useSpeechSynthesis());
    expect(result.current.isSupported).toBe(true);

    act(() => {
      result.current.speakMessage("msg-1", "First sentence. Second sentence.");
    });

    expect(mockCancel).toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.stopSpeech();
    });

    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(result.current.speakingMessageId).toBeNull();
  });
});
