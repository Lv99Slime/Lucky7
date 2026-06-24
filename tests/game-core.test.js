const assert = require("assert");
const Core = require("../game-core");

function card(type, value) {
  return { id: `${type}-${value}-${Math.random()}`, type, value, label: type === "number" ? String(value) : type === "plus" ? `+${value}` : type === "double" ? "x2" : type };
}

function newState(deck, names = ["A", "B", "C"], options = {}) {
  const state = Core.createGame(names, 200, { teacherControls: true, mode: options.mode });
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

function newVengeanceState(deck, names = ["A", "B", "C"]) {
  return newState(deck, names, { mode: "vengeance" });
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
  assert.strictEqual(state.pendingReveal.card.type, "freeze");
  assert.strictEqual(Core.getPlayer(state, "p1").status, Core.PLAYER_STATUS.ACTIVE);
  assert.strictEqual(state.pendingAutoTarget.targetId, "p1");
  Core.continueAfterReveal(state);
  assert.strictEqual(Core.getPlayer(state, "p1").status, Core.PLAYER_STATUS.FROZEN);
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


function testSingleActiveFreezeTargetsSelf() {
  const state = newState([card("freeze")]);
  Core.getPlayer(state, "p2").status = Core.PLAYER_STATUS.STAYED;
  Core.getPlayer(state, "p3").status = Core.PLAYER_STATUS.BUSTED;
  forceTurn(state, "p1");
  Core.hit(state);
  const player = Core.getPlayer(state, "p1");
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(state.pendingReveal.card.type, "freeze");
  assert.strictEqual(player.status, Core.PLAYER_STATUS.ACTIVE);
  assert.strictEqual(state.pendingTarget, null);
  assert.strictEqual(state.pendingAutoTarget.targetId, "p1");
  Core.continueAfterReveal(state);
  assert.strictEqual(player.status, Core.PLAYER_STATUS.FROZEN);
}

function testSingleActiveFlipThreeTargetsSelf() {
  const state = newState([card("flipThree"), card("number", 2), card("number", 3), card("number", 4)]);
  Core.getPlayer(state, "p2").status = Core.PLAYER_STATUS.STAYED;
  Core.getPlayer(state, "p3").status = Core.PLAYER_STATUS.BUSTED;
  forceTurn(state, "p1");
  Core.hit(state);
  const player = Core.getPlayer(state, "p1");
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(state.pendingReveal.card.type, "flipThree");
  assert.strictEqual(state.pendingTarget, null);
  assert.strictEqual(state.pendingAutoTarget.targetId, "p1");
  Core.continueAfterReveal(state);
  assert.strictEqual(state.flipThree.targetId, "p1");
  assert.strictEqual(state.pendingReveal.card.value, 2);
  Core.continueAfterReveal(state);
  assert.strictEqual(state.pendingReveal.card.value, 3);
  Core.continueAfterReveal(state);
  assert.strictEqual(state.pendingReveal.card.value, 4);
  Core.continueAfterReveal(state);
  assert.strictEqual(player.numberCards.length, 3);
}

function testExistingSecondChanceMustGiftOtherPlayer() {
  const state = newState([card("secondChance")]);
  const source = Core.getPlayer(state, "p1");
  const target = Core.getPlayer(state, "p2");
  source.hasSecondChance = true;
  Core.getPlayer(state, "p3").hasSecondChance = true;
  forceTurn(state, "p1");
  Core.hit(state);
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(state.pendingTarget.kind, "secondChanceGift");
  Core.continueAfterReveal(state);
  assert.strictEqual(state.phase, "selectTarget");
  assert.deepStrictEqual(Core.legalTargets(state).map((player) => player.id), ["p2"]);
  Core.chooseTarget(state, "p2");
  assert.strictEqual(source.hasSecondChance, true);
  assert.strictEqual(target.hasSecondChance, true);
}
function testVengeanceDeckCount() {
  const deck = Core.createDeck("vengeance");
  assert.strictEqual(deck.length, 108);
  assert.strictEqual(deck.filter((c) => c.type === "number").length, 89);
  for (let value = 1; value <= 13; value += 1) {
    const expected = value - (value === 7 || value === 13 ? 1 : 0);
    assert.strictEqual(deck.filter((c) => c.type === "number" && c.value === value).length, expected);
  }
  assert.strictEqual(deck.filter((c) => ["zero", "unlucky7", "lucky13"].includes(c.type)).length, 3);
  assert.strictEqual(deck.filter((c) => ["minus2", "minus4", "minus6", "minus8", "minus10", "divide2"].includes(c.type)).length, 6);
  assert.strictEqual(deck.filter((c) => ["justOneMore", "swap", "steal", "discard", "flipFour"].includes(c.type)).length, 10);
}

function testVengeanceScoreModifiersAndZero() {
  const player = {
    status: Core.PLAYER_STATUS.ACTIVE,
    flip7: false,
    numberCards: [card("number", 10), card("number", 9)],
    modifierCards: [card("divide2", 2), card("minus4", 4)],
  };
  assert.strictEqual(Core.calculateRoundScore(player), 5);
  player.numberCards.push(card("zero", 0));
  assert.strictEqual(Core.calculateRoundScore(player), 0);
  player.flip7 = true;
  assert.strictEqual(Core.calculateRoundScore(player), 20);
}

function testVengeanceUnlucky7ClearsCards() {
  const state = newVengeanceState([card("unlucky7", 7)]);
  const player = Core.getPlayer(state, "p1");
  player.numberCards = [card("number", 3), card("number", 5)];
  player.modifierCards = [card("minus4", 4)];
  forceTurn(state, "p1");
  Core.hit(state);
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(player.status, Core.PLAYER_STATUS.ACTIVE);
  assert.strictEqual(player.numberCards.length, 1);
  assert.strictEqual(player.numberCards[0].type, "unlucky7");
  assert.strictEqual(player.modifierCards.length, 0);
  assert.strictEqual(state.discard.length, 3);
}

function testVengeanceLucky13AllowsSecondOnly() {
  const state = newVengeanceState([card("lucky13", 13), card("number", 13)]);
  const player = Core.getPlayer(state, "p1");
  player.numberCards = [card("number", 13)];
  forceTurn(state, "p1");
  Core.hit(state);
  assert.strictEqual(player.status, Core.PLAYER_STATUS.ACTIVE);
  assert.strictEqual(player.numberCards.length, 2);
  Core.continueAfterReveal(state);
  forceTurn(state, "p1");
  Core.hit(state);
  assert.strictEqual(player.status, Core.PLAYER_STATUS.BUSTED);
}

function testVengeanceModifierCanTargetStayedPlayer() {
  const state = newVengeanceState([card("minus4", 4)]);
  Core.getPlayer(state, "p2").status = Core.PLAYER_STATUS.STAYED;
  forceTurn(state, "p1");
  Core.hit(state);
  assert.strictEqual(state.phase, "reveal");
  Core.continueAfterReveal(state);
  assert.strictEqual(state.phase, "selectTarget");
  assert.ok(Core.legalTargets(state).some((player) => player.id === "p2"));
  Core.chooseTarget(state, "p2");
  assert.strictEqual(Core.getPlayer(state, "p2").modifierCards.length, 1);
}

function testVengeanceOnlyNonBustedAutoTargetsSelf() {
  const state = newVengeanceState([card("minus8", 8)]);
  Core.getPlayer(state, "p2").status = Core.PLAYER_STATUS.BUSTED;
  Core.getPlayer(state, "p3").status = Core.PLAYER_STATUS.BUSTED;
  forceTurn(state, "p1");
  Core.hit(state);
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(state.pendingAutoTarget.targetId, "p1");
  Core.continueAfterReveal(state);
  assert.strictEqual(Core.getPlayer(state, "p1").modifierCards.length, 1);
}

function testVengeanceJustOneMoreForcesStay() {
  const state = newVengeanceState([card("justOneMore"), card("number", 5)]);
  forceTurn(state, "p1");
  Core.hit(state);
  Core.continueAfterReveal(state);
  assert.strictEqual(state.phase, "selectTarget");
  Core.chooseTarget(state, "p2");
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(state.pendingReveal.card.value, 5);
  Core.continueAfterReveal(state);
  const target = Core.getPlayer(state, "p2");
  assert.strictEqual(target.status, Core.PLAYER_STATUS.STAYED);
  assert.strictEqual(target.numberCards.length, 1);
}

function testVengeanceFlipFourQueuesModifier() {
  const state = newVengeanceState([card("flipFour"), card("number", 1), card("minus2", 2), card("number", 2), card("number", 3)]);
  forceTurn(state, "p1");
  Core.hit(state);
  Core.continueAfterReveal(state);
  Core.chooseTarget(state, "p2");
  assert.strictEqual(state.phase, "reveal");
  assert.strictEqual(state.pendingReveal.card.value, 1);
  Core.continueAfterReveal(state);
  assert.strictEqual(state.pendingReveal.card.type, "minus2");
  Core.continueAfterReveal(state);
  assert.strictEqual(state.pendingReveal.card.value, 2);
  Core.continueAfterReveal(state);
  assert.strictEqual(state.pendingReveal.card.value, 3);
  Core.continueAfterReveal(state);
  assert.strictEqual(state.phase, "selectTarget");
  assert.strictEqual(state.pendingTarget.kind, "modifier");
  Core.chooseTarget(state, "p2");
  assert.strictEqual(Core.getPlayer(state, "p2").modifierCards.length, 1);
}

function testVengeanceStealDiscardAndSwap() {
  const stealState = newVengeanceState([card("steal")]);
  Core.getPlayer(stealState, "p2").numberCards = [card("number", 9)];
  forceTurn(stealState, "p1");
  Core.hit(stealState);
  Core.continueAfterReveal(stealState);
  assert.strictEqual(stealState.phase, "selectCard");
  const stealTarget = Core.legalCardTargets(stealState)[0];
  Core.chooseCard(stealState, stealTarget.playerId, stealTarget.zone, stealTarget.cardId);
  assert.strictEqual(Core.getPlayer(stealState, "p1").numberCards.some((c) => c.value === 9), true);
  assert.strictEqual(Core.getPlayer(stealState, "p2").numberCards.length, 0);

  const discardState = newVengeanceState([card("discard")]);
  Core.getPlayer(discardState, "p2").numberCards = [card("number", 4)];
  forceTurn(discardState, "p1");
  Core.hit(discardState);
  Core.continueAfterReveal(discardState);
  const discardTarget = Core.legalCardTargets(discardState)[0];
  Core.chooseCard(discardState, discardTarget.playerId, discardTarget.zone, discardTarget.cardId);
  assert.strictEqual(Core.getPlayer(discardState, "p2").numberCards.length, 0);
  assert.notStrictEqual(discardState.phase, "selectCard");
  assert.strictEqual(discardState.pendingCardPick, null);

  const swapState = newVengeanceState([card("swap")]);
  Core.getPlayer(swapState, "p1").numberCards = [card("number", 1)];
  Core.getPlayer(swapState, "p2").numberCards = [card("number", 8)];
  forceTurn(swapState, "p1");
  Core.hit(swapState);
  Core.continueAfterReveal(swapState);
  const first = Core.legalCardTargets(swapState).find((item) => item.playerId === "p1");
  Core.chooseCard(swapState, first.playerId, first.zone, first.cardId);
  const second = Core.legalCardTargets(swapState).find((item) => item.playerId === "p2");
  Core.chooseCard(swapState, second.playerId, second.zone, second.cardId);
  assert.strictEqual(Core.getPlayer(swapState, "p1").numberCards[0].value, 8);
  assert.strictEqual(Core.getPlayer(swapState, "p2").numberCards[0].value, 1);
}
function run() {
  [
    testDeckCount,
    testVengeanceDeckCount,
    testBustWithoutSecondChance,
    testSecondChancePreventsBust,
    testHitWaitsForRevealBeforeNextPlayer,
    testSpecialHitRevealsBeforeTargetPicker,
    testAutoTargetSpecialStillRevealsBeforeSummary,
    testScoreOrder,
    testFreezeBanksTarget,
    testFlipThreeStopsOnBust,
    testSecondChanceGiftTargeting,
    testSingleActiveFreezeTargetsSelf,
    testSingleActiveFlipThreeTargetsSelf,
    testExistingSecondChanceMustGiftOtherPlayer,
    testStartNextRoundFromSummary,
    testFlip7EndsRoundAndAddsBonus,
    testVengeanceScoreModifiersAndZero,
    testVengeanceUnlucky7ClearsCards,
    testVengeanceLucky13AllowsSecondOnly,
    testVengeanceModifierCanTargetStayedPlayer,
    testVengeanceOnlyNonBustedAutoTargetsSelf,
    testVengeanceJustOneMoreForcesStay,
    testVengeanceFlipFourQueuesModifier,
    testVengeanceStealDiscardAndSwap,
  ].forEach((test) => test());
  console.log("All Lucky 7 core tests passed.");
}

run();
