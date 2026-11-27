import { describe, expect, it } from "vitest";

import { setHandoff, takeHandoff } from "./handoff";

describe("handoff", () => {
  it("is empty until something is set", () => {
    expect(takeHandoff()).toBeNull();
  });

  it("hands the toast over once", () => {
    setHandoff({ text: "Archived Q4. Nothing is deleted.", undoBoardId: 7 });
    expect(takeHandoff()).toEqual({ text: "Archived Q4. Nothing is deleted.", undoBoardId: 7 });
    expect(takeHandoff()).toBeNull();
  });

  it("keeps only the newest", () => {
    setHandoff({ text: "a", undoBoardId: 1 });
    setHandoff({ text: "b", undoBoardId: 2 });
    expect(takeHandoff()).toEqual({ text: "b", undoBoardId: 2 });
  });
});
