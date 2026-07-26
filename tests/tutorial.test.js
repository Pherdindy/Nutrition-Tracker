const test = require("node:test");
const assert = require("node:assert");
const Tut = require("../www/tutorial.js");

test("slideCount is 6 and SLIDES has 6 entries", () => {
  assert.equal(Tut.slideCount(), 6);
  assert.equal(Tut.SLIDES.length, 6);
});

test("every slide has non-empty id, title, caption, art strings", () => {
  const arts = [];
  for (const s of Tut.SLIDES) {
    assert.ok(s.id && typeof s.id === "string", "id");
    assert.ok(s.title && typeof s.title === "string", "title");
    assert.ok(s.caption && typeof s.caption === "string", "caption");
    assert.ok(s.art && typeof s.art === "string", "art");
    arts.push(s.art);
  }
  assert.deepEqual(arts, ["welcome", "food", "days", "targets", "assess", "done"]);
});

test("clampIndex bounds the index into range", () => {
  assert.equal(Tut.clampIndex(-3), 0);
  assert.equal(Tut.clampIndex(0), 0);
  assert.equal(Tut.clampIndex(3), 3);
  assert.equal(Tut.clampIndex(5), 5);
  assert.equal(Tut.clampIndex(99), 5);
  assert.equal(Tut.clampIndex(2.9), 2);
  assert.equal(Tut.clampIndex(NaN), 0);
  assert.equal(Tut.clampIndex(undefined), 0);
});

test("next and prev clamp at the ends", () => {
  assert.equal(Tut.next(0), 1);
  assert.equal(Tut.next(5), 5);
  assert.equal(Tut.prev(5), 4);
  assert.equal(Tut.prev(0), 0);
});

test("isFirst and isLast at boundaries and middle", () => {
  assert.equal(Tut.isFirst(0), true);
  assert.equal(Tut.isFirst(1), false);
  assert.equal(Tut.isLast(5), true);
  assert.equal(Tut.isLast(4), false);
});

test("shouldAutoShow is true only when the flag is falsy/absent", () => {
  assert.equal(Tut.shouldAutoShow(null), true);
  assert.equal(Tut.shouldAutoShow(undefined), true);
  assert.equal(Tut.shouldAutoShow(""), true);
  assert.equal(Tut.shouldAutoShow("1"), false);
  assert.equal(Tut.shouldAutoShow("anything"), false);
});
