import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MessageRenderer } from "@/components/chat/GenerativeUI";

describe("MessageRenderer sentence highlighting (#863)", () => {
  it("renders plain text without highlights when speakingSentenceIndex is null", () => {
    render(
      <MessageRenderer
        content="First sentence. Second sentence."
        speakingSentenceIndex={null}
      />,
    );
    expect(
      screen.getByText("First sentence. Second sentence."),
    ).toBeInTheDocument();
  });

  it("highlights sentence matching speakingSentenceIndex", () => {
    const { container } = render(
      <MessageRenderer
        content="First sentence. Second sentence."
        speakingSentenceIndex={1}
      />,
    );

    const mark = container.querySelector("mark");
    expect(mark).toBeInTheDocument();
    expect(mark?.textContent).toBe("Second sentence.");
  });
});
