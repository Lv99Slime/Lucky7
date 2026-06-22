const assert = require("assert");
const Core = require("../game-core");

function card(type, value) {
  return { id: `${type}-${value}-${Math.random()}`, type, value, label: type === "number" ? String(value) : type === "plus" ? `+${value}` : type === "double" ? "x2" : type };
}

function newState(deck, names = ["A", "B", "C"]) {
  const state = Core.createGame(names, 200, { teacherControls: true });
  state.deck = deck.slice();
  state.discard = [];
  state.log = [];
  state.undoState = null;
  state.initialDeal = null;
  state.pendingTarget = null;
  state.actionQueue = [];
  state.phase = "pass";
  state.players.forEach((player) => {
    player.roundScore = 0;
    player.lastRoundScore = 0;
    player.status = Core.PLAYER_STATUS.ACTIVE;
    player.numberCards = [];
    player.modifierCards = [];
    player.hasSecondChance = false;
    player.flip7 = false;
    player.roundNote = "";
  });
  return state;
}

function forceTurn(state, playerId) {
  state.phase = "turn";
  state.currentPlayerId = playerId;
}

function testDeckCount() {
  const deck = Core.createDeck();
  assert.strictEqual(deck.length, 94);
  assert.strictEqual(deck.filter((c) => c.type === "number").length, 79);
  assert.strictEqual(deck.filter((c) => c.type === "plus" || c.type === "double").length, 6);
  assert.strictEqual(deck.filter((c) => ["freeze", "secondChance", "flipThree"].includes(c.type)).length, 9);
}

function testBustWithoutSecondChance() {
  const state = newState([]);
  const player = Core.getPlayer(state, "p1");
  player.numberCards = [card("number", 5)];
  forceTurn(state, "p1");
  state.deck = [card("number", 5)];
  Core.hit(state);
  assert.strictEqual(player.status, Core.PLAYER_STATUS.BUSTED);
  assert.strictEqual(player.roundScore, 0);
}

function testSecondChancePreventsBust() {
  const state = newState([]);
  const player = Core.getPlayer(state, "p1");
  player.numberCards = [card("number", 5)];
  player.hasSecondChance = true;
  forceTurn(state, "p1");
  state.deck = [card("number", 5)];
  Core.hit(state);
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(player.status, Core.PLAYER_STATUS.ACTIVE);
  assert.strictEqual(player.hasSecondChance, false);
  assert.strictEqual(player.numberCards.length, 1);
}

function testHitWaitsForRevealBeforeNextPlayer() {
  const state = newState([card("number", 9)]);
  forceTurn(state, "p1");
  Core.hit(state);
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(state.currentPlayerId, "p1");
  assert.strictEqual(state.pendingReveal.card.value, 9);
  Core.continueAfterReveal(state);
  assert.strictEqual(state.phase, "pass");
  assert.strictEqual(state.currentPlayerId, "p2");
}

function testSpecialHitRevealsBeforeTargetPicker() {
  const state = newState([card("freeze")]);
  forceTurn(state, "p1");
  Core.hit(state);
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(state.pendingReveal.card.type, "freeze");
  assert.strictEqual(state.pendingTarget.kind, "freeze");
  Core.continueAfterReveal(state);
  assert.strictEqual(state.phase, "selectTarget");
}

function testAutoTargetSpecialStillRevealsBeforeSummary() {
  const state = newState([card("freeze")], ["A"]);
  forceTurn(state, "p1");
  Core.hit(state);
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(Core.getPlayer(state, "p1").status, Core.PLAYER_STATUS.FROZEN);
  Core.continueAfterReveal(state);
  assert.strictEqual(state.phase, "roundSummary");
}

function testScoreOrder() {
  const player = {
    status: Core.PLAYER_STATUS.ACTIVE,
    flip7: false,
    numberCards: [card("number", 10), card("number", 3)],
    modifierCards: [card("plus", 6), card("double", 2), card("plus", 4)],
  };
  assert.strictEqual(Core.calculateRoundScore(player), 36);
}

function testFreezeBanksTarget() {
  const state = newState([]);
  const target = Core.getPlayer(state, "p2");
  target.numberCards = [card("number", 8), card("number", 2)];
  target.roundScore = 10;
  state.pendingTarget = { kind: "freeze", sourcePlayerId: "p1", card: card("freeze") };
  state.phase = "selectTarget";
  Core.chooseTarget(state, "p2");
  assert.strictEqual(target.status, Core.PLAYER_STATUS.FROZEN);
  assert.strictEqual(target.roundScore, 10);
}

function testFlipThreeStopsOnBust() {
  const state = newState([]);
  const target = Core.getPlayer(state, "p2");
  target.numberCards = [card("number", 4)];
  state.pendingTarget = { kind: "flipThree", sourcePlayerId: "p1", card: card("flipThree") };
  state.phase = "selectTarget";
  state.deck = [card("number", 2), card("number", 4), card("number", 9)];
  Core.chooseTarget(state, "p2");
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(state.pendingReveal.card.value, 2);
  assert.strictEqual(target.status, Core.PLAYER_STATUS.ACTIVE);
  assert.strictEqual(target.numberCards.length, 2);
  Core.continueAfterReveal(state);
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(state.pendingReveal.card.value, 4);
  assert.strictEqual(target.status, Core.PLAYER_STATUS.BUSTED);
  assert.strictEqual(target.numberCards.length, 2);
  Core.continueAfterReveal(state);
  assert.notStrictEqual(state.pendingReveal?.card.value, 9);
}

function testSecondChanceGiftTargeting() {
  const state = newState([]);
  const source = Core.getPlayer(state, "p1");
  const target = Core.getPlayer(state, "p2");
  source.hasSecondChance = true;
  state.pendingTarget = null;
  state.phase = "turn";
  state.currentPlayerId = "p1";
  state.deck = [card("secondChance")];
  Core.hit(state);
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(state.pendingTarget.kind, "secondChanceGift");
  Core.continueAfterReveal(state);
  assert.strictEqual(state.phase, "selectTarget");
  Core.chooseTarget(state, "p2");
  assert.strictEqual(target.hasSecondChance, true);
}

function testStartNextRoundFromSummary() {
  const state = newState([]);
  Core.getPlayer(state, "p1").status = Core.PLAYER_STATUS.STAYED;
  Core.getPlayer(state, "p2").status = Core.PLAYER_STATUS.STAYED;
  Core.getPlayer(state, "p3").status = Core.PLAYER_STATUS.STAYED;
  state.phase = "roundSummary";
  const oldRound = state.round;
  Core.startNextRound(state);
  assert.strictEqual(state.round, oldRound + 1);
  assert.strictEqual(state.phase === "pass" || state.phase === "selectTarget" || state.phase === "reveal", true);
  assert.strictEqual(Core.getPlayer(state, "p1").status, Core.PLAYER_STATUS.ACTIVE);
}

function testFlip7EndsRoundAndAddsBonus() {
  const state = newState([]);
  const player = Core.getPlayer(state, "p1");
  player.numberCards = [1, 2, 3, 4, 5, 6].map((n) => card("number", n));
  forceTurn(state, "p1");
  state.deck = [card("number", 7)];
  Core.hit(state);
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(player.flip7, true);
  assert.strictEqual(player.lastRoundScore, 43);
  Core.continueAfterReveal(state);
  assert.strictEqual(state.phase === "roundSummary" || state.phase === "gameOver" || state.phase === "tiebreak", true);
}

function run() {
  [
    testDeckCount,
    testBustWithoutSecondChance,
    testSecondChancePreventsBust,
    testHitWaitsForRevealBeforeNextPlayer,
    testSpecialHitRevealsBeforeTargetPicker,
    testAutoTargetSpecialStillRevealsBeforeSummary,
    testScoreOrder,
    testFreezeBanksTarget,
    testFlipThreeStopsOnBust,
    testSecondChanceGiftTargeting,
    testStartNextRoundFromSummary,
    testFlip7EndsRoundAndAddsBonus,
  ].forEach((test) => test());
  console.log("All Lucky 7 core tests passed.");
}

run();
