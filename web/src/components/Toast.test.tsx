import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Toast } from "./Toast";

describe("Toast", () => {
  it("renders nothing without a message", () => {
    expect(renderToString(<Toast message={null} />)).toBe("");
  });

  it("renders only the message by default", () => {
    expect(renderToString(<Toast message="Saved" />)).toBe(
      '<div class="toast" role="status"><span>Saved</span></div>',
    );
  });

  it("adds an Undo button when there is something to undo", () => {
    expect(renderToString(<Toast message="Archived Doing." onUndo={() => {}} />)).toBe(
      '<div class="toast" role="status"><span>Archived Doing.</span><button type="button">Undo</button></div>',
    );
  });
});
