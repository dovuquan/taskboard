import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Toast, ToastView } from "./Toast";

describe("ToastView", () => {
  it("renders nothing without a message", () => {
    expect(renderToString(<ToastView message={null} />)).toBe("");
  });

  it("renders only the message by default", () => {
    expect(renderToString(<ToastView message="Saved" />)).toBe(
      '<div class="toast" role="status"><span>Saved</span></div>',
    );
  });

  it("adds an Undo button when there is something to undo", () => {
    expect(renderToString(<ToastView message="Archived Doing." onUndo={() => {}} />)).toBe(
      '<div class="toast" role="status"><span>Archived Doing.</span><button type="button">Undo</button></div>',
    );
  });
});

describe("Toast", () => {
  it("renders the same markup where there is no document to put it on", () => {
    // In the browser it is placed on document.body, outside the inert #root (not checkable here).
    expect(renderToString(<Toast message="Saved" />)).toBe(
      '<div class="toast" role="status"><span>Saved</span></div>',
    );
    expect(renderToString(<Toast message={null} />)).toBe("");
  });
});
