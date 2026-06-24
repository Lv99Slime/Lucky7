(function (global) {
  "use strict";

  const STORAGE_KEY = "lucky7-classroom-state-v1";
  const MODES = { CLASSIC: "classic", VENGEANCE: "vengeance" };
  const PLAYER_STATUS = { ACTIVE: "Active", STAYED: "Stayed", FROZEN: "Frozen", BUSTED: "Busted", OUT: "Out" };
  const CLASSIC_ACTIONS = ["freeze", "secondChance", "flipThree"];
  const VENGEANCE_ACTIONS = ["justOneMore", "swap", "steal", "discard", "flipFour"];
  const VENGEANCE_MODIFIERS = ["minus2", "minus4", "minus6", "minus8", "minus10", "divide2"];
  const SPECIAL_NUMBERS = ["zero", "unlucky7", "lucky13"];
  const CARD_PICK_ACTIONS = ["swap", "steal", "discard"];

  function cloneState(state) { return JSON.parse(JSON.stringify(state)); }
  function normalizeMode(mode) { return mode === MODES.VENGEANCE ? MODES.VENGEANCE : MODES.CLASSIC; }
  function isVengeance(state) { return normalizeMode(state && state.mode) === MODES.VENGEANCE; }

  function makeCard(type, value, index) {
    const code = value === undefined || value === null ? type : `${type}-${value}`;
    return { id: `${code}-${index}-${Math.random().toString(36).slice(2, 8)}`, type, value, label: labelForCard(type, value) };
  }

  function labelForCard(type, value) {
    if (type === "number") return String(value);
    if (type === "zero") return "0";
    if (type === "unlucky7") return "7";
    if (type === "lucky13") return "13";
    if (type === "plus") return `+${value}`;
    if (type === "double") return "x2";
    if (type && type.startsWith("minus")) return `-${type.replace("minus", "")}`;
    if (type === "divide2") return "÷2";
    if (type === "freeze") return "Freeze";
    if (type === "secondChance") return "Second Chance";
    if (type === "flipThree") return "Flip Three";
    if (type === "justOneMore") return "Just One More";
    if (type === "swap") return "Swap";
    if (type === "steal") return "Steal";
    if (type === "discard") return "Discard";
    if (type === "flipFour") return "Flip Four";
    return "Card";
  }

  function createDeck(mode) { return normalizeMode(mode) === MODES.VENGEANCE ? createVengeanceDeck() : createClassicDeck(); }

  function createClassicDeck() {
    const cards = [];
    let index = 0;
    cards.push(makeCard("number", 0, index++));
    for (let number = 1; number <= 12; number += 1) {
      for (let copy = 0; copy < number; copy += 1) cards.push(makeCard("number", number, index++));
    }
    [2, 4, 6, 8, 10].forEach((value) => cards.push(makeCard("plus", value, index++)));
    cards.push(makeCard("double", 2, index++));
    CLASSIC_ACTIONS.forEach((type) => {
      for (let copy = 0; copy < 3; copy += 1) cards.push(makeCard(type, null, index++));
    });
    return cards;
  }

  function createVengeanceDeck() {
    const cards = [];
    let index = 0;
    for (let number = 1; number <= 13; number += 1) {
      const copies = number - (number === 7 || number === 13 ? 1 : 0);
      for (let copy = 0; copy < copies; copy += 1) cards.push(makeCard("number", number, index++));
    }
    cards.push(makeCard("zero", 0, index++));
    cards.push(makeCard("unlucky7", 7, index++));
    cards.push(makeCard("lucky13", 13, index++));
    VENGEANCE_MODIFIERS.forEach((type) => cards.push(makeCard(type, modifierValue(type), index++)));
    VENGEANCE_ACTIONS.forEach((type) => {
      for (let copy = 0; copy < 2; copy += 1) cards.push(makeCard(type, null, index++));
    });
    return cards;
  }

  function modifierValue(type) {
    if (type === "divide2") return 2;
    if (type && type.startsWith("minus")) return Number(type.replace("minus", ""));
    return 0;
  }

  function shuffle(cards, rng) {
    const random = rng || Math.random;
    const shuffled = cards.slice();
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const temp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = temp;
    }
    return shuffled;
  }

  function createPlayer(name, index) {
    return {
      id: `p${index + 1}`,
      name: name && name.trim() ? name.trim() : `Player ${index + 1}`,
      totalScore: 0,
      roundScore: 0,
      lastRoundScore: 0,
      status: PLAYER_STATUS.OUT,
      numberCards: [],
      modifierCards: [],
      hasSecondChance: false,
      flip7: false,
      roundNote: "",
    };
  }

  function createGame(names, targetScore, options) {
    const safeNames = names.slice(0, 8);
    const mode = normalizeMode(options && options.mode);
    const state = {
      version: 2,
      mode,
      phase: "home",
      players: safeNames.map(createPlayer),
      round: 0,
      targetScore: Number(targetScore) || 200,
      teacherControls: Boolean(options && options.teacherControls),
      deck: shuffle(createDeck(mode)),
      discard: [],
      currentPlayerId: null,
      activePlayerIds: safeNames.map((_, index) => `p${index + 1}`),
      initialDeal: null,
      pendingReveal: null,
      pendingAutoTarget: null,
      pendingTarget: null,
      pendingCardPick: null,
      pendingForcedStay: null,
      flipThree: null,
      actionQueue: [],
      undoState: null,
      log: [],
      lastEvent: "Game ready.",
      roundEndedBy: "",
      tiebreakCandidates: [],
      winnerIds: [],
      gameOverReason: "",
    };
    addLog(state, `New ${mode === MODES.VENGEANCE ? "With Vengeance" : "Classic"} game started. Target score: ${state.targetScore}.`);
    startRound(state, state.activePlayerIds);
    return state;
  }

  function ensureStateShape(state) {
    if (!state) return state;
    state.mode = normalizeMode(state.mode);
    if (state.pendingAutoTarget === undefined) state.pendingAutoTarget = null;
    if (state.pendingCardPick === undefined) state.pendingCardPick = null;
    if (state.pendingForcedStay === undefined) state.pendingForcedStay = null;
    if (state.phase === "selectCard" && !state.pendingCardPick) state.phase = "turn";
    if (state.phase === "selectTarget" && !state.pendingTarget) state.phase = "turn";
    return state;
  }

  function addLog(state, message) {
    const entry = { round: state.round || 0, message, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    state.log.unshift(entry);
    state.log = state.log.slice(0, 80);
    state.lastEvent = message;
  }

  function getPlayer(state, playerId) { return state.players.find((player) => player.id === playerId); }
  function activePlayers(state) { return state.players.filter((player) => state.activePlayerIds.includes(player.id) && player.status === PLAYER_STATUS.ACTIVE); }
  function participatingPlayers(state) { return state.players.filter((player) => state.activePlayerIds.includes(player.id)); }
  function nonBustedPlayers(state) { return participatingPlayers(state).filter((player) => player.status !== PLAYER_STATUS.BUSTED && player.status !== PLAYER_STATUS.OUT); }
  function canReceiveCard(state, player) { return Boolean(player && player.status !== PLAYER_STATUS.BUSTED && player.status !== PLAYER_STATUS.OUT && (isVengeance(state) || player.status === PLAYER_STATUS.ACTIVE)); }

  function resetRoundFields(player, isParticipant) {
    player.roundScore = 0;
    player.lastRoundScore = 0;
    player.status = isParticipant ? PLAYER_STATUS.ACTIVE : PLAYER_STATUS.OUT;
    player.numberCards = [];
    player.modifierCards = [];
    player.hasSecondChance = false;
    player.flip7 = false;
    player.roundNote = "";
  }

  function startRound(state, participantIds) {
    ensureStateShape(state);
    state.round += 1;
    state.activePlayerIds = participantIds && participantIds.length ? participantIds.slice() : state.players.map((p) => p.id);
    state.players.forEach((player) => resetRoundFields(player, state.activePlayerIds.includes(player.id)));
    state.currentPlayerId = state.activePlayerIds[0] || null;
    state.phase = "dealing";
    state.initialDeal = { index: 0 };
    state.pendingReveal = null;
    state.pendingAutoTarget = null;
    state.pendingTarget = null;
    state.pendingCardPick = null;
    state.pendingForcedStay = null;
    state.flipThree = null;
    state.actionQueue = [];
    state.roundEndedBy = "";
    state.tiebreakCandidates = [];
    state.winnerIds = [];
    addLog(state, `Round ${state.round} started.`);
    continueInitialDeal(state);
  }

  function continueInitialDeal(state) {
    if (!state.initialDeal) return;
    while (state.initialDeal.index < state.activePlayerIds.length) {
      const playerId = state.activePlayerIds[state.initialDeal.index];
      const player = getPlayer(state, playerId);
      if (player && player.status === PLAYER_STATUS.ACTIVE) {
        const card = drawCard(state);
        addLog(state, `${player.name} receives starting card ${card.label}.`);
        resolveCard(state, playerId, card, { fromInitialDeal: true });
        if (!state.initialDeal || ["selectTarget", "selectCard", "autoTarget"].includes(state.phase) || isRoundOver(state)) return;
      }
      state.initialDeal.index += 1;
    }
    state.initialDeal = null;
    if (isRoundOver(state)) {
      finalizeRound(state, state.roundEndedBy || "Initial deal ended the round.");
      return;
    }
    state.currentPlayerId = findNextActiveId(state, null);
    state.phase = "pass";
  }

  function drawCard(state) {
    if (!state.deck.length && state.discard.length) {
      state.deck = shuffle(state.discard);
      state.discard = [];
      addLog(state, "Deck was empty. Discard pile reshuffled.");
    }
    if (!state.deck.length) {
      state.deck = shuffle(createDeck(state.mode));
      addLog(state, "A fresh deck was created because no cards were available.");
    }
    return state.deck.shift();
  }

  function saveUndo(state) {
    const snapshot = cloneState(state);
    snapshot.undoState = null;
    state.undoState = snapshot;
  }

  function undo(state) {
    if (!state.undoState) return state;
    const previous = cloneState(state.undoState);
    previous.undoState = null;
    addLog(previous, "Last action undone.");
    return ensureStateShape(previous);
  }

  function beginTurn(state) {
    ensureStateShape(state);
    if (state.phase !== "pass") return;
    state.phase = "turn";
    const player = getPlayer(state, state.currentPlayerId);
    if (player) addLog(state, `${player.name}'s turn.`);
  }

  function hit(state) {
    ensureStateShape(state);
    if (state.phase !== "turn") return;
    saveUndo(state);
    const player = getPlayer(state, state.currentPlayerId);
    if (!player || player.status !== PLAYER_STATUS.ACTIVE) {
      advanceTurn(state);
      return;
    }
    const card = drawCard(state);
    addLog(state, `${player.name} hits and draws ${card.label}.`);
    state.holdAfterHit = true;
    resolveCard(state, player.id, card, { fromTurn: true });
    state.holdAfterHit = false;
    pauseForReveal(state, player.id, card);
  }

  function pauseForReveal(state, playerId, card, forcedNextPhase) {
    const nextPhase = forcedNextPhase || (["selectTarget", "selectCard", "autoTarget", "roundSummary", "gameOver", "tiebreak"].includes(state.phase) ? state.phase : "advanceTurn");
    state.pendingReveal = { playerId, card, nextPhase, message: state.lastEvent };
    state.phase = "reveal";
  }

  function continueAfterReveal(state) {
    ensureStateShape(state);
    if (state.phase !== "reveal" || !state.pendingReveal) return;
    const nextPhase = state.pendingReveal.nextPhase;
    state.pendingReveal = null;
    if (nextPhase === "advanceTurn") { advanceTurn(state); return; }
    if (nextPhase === "flipThreeContinue") { continueFlipThree(state); return; }
    if (nextPhase === "forceStay") { forcePendingStay(state); finishActionResolution(state); return; }
    if (nextPhase === "autoTarget") {
      const pending = state.pendingAutoTarget;
      state.pendingAutoTarget = null;
      if (pending) resolveTargetAction(state, pending.targetId, pending.action);
      return;
    }
    state.phase = nextPhase;
  }

  function stay(state) {
    ensureStateShape(state);
    if (state.phase !== "turn") return;
    saveUndo(state);
    const player = getPlayer(state, state.currentPlayerId);
    if (!player || player.status !== PLAYER_STATUS.ACTIVE) return;
    if (isVengeance(state) && hasZero(player) && !player.flip7) {
      addLog(state, `${player.name} has The Zero and must keep hitting.`);
      return;
    }
    player.status = PLAYER_STATUS.STAYED;
    player.roundScore = calculateRoundScore(player);
    player.roundNote = "Stayed";
    addLog(state, `${player.name} stays with ${player.roundScore} points.`);
    advanceTurn(state);
  }

  function resolveCard(state, playerId, card, context) {
    const player = getPlayer(state, playerId);
    if (!canReceiveCard(state, player)) { state.discard.push(card); return; }
    if (isNumberCard(card)) { resolveNumberCard(state, player, card); return; }
    if (isClassicModifier(card)) {
      player.modifierCards.push(card);
      player.roundScore = calculateRoundScore(player);
      addLog(state, `${player.name} keeps ${card.label}. Current round score: ${player.roundScore}.`);
      return;
    }
    if (isVengeanceModifier(card)) { requestTarget(state, "modifier", player.id, card, context); return; }
    if (card.type === "secondChance") { resolveSecondChance(state, player, card, context || {}); return; }
    if (card.type === "freeze" || card.type === "flipThree" || card.type === "justOneMore" || card.type === "flipFour") { requestTarget(state, card.type, player.id, card, context); return; }
    if (CARD_PICK_ACTIONS.includes(card.type)) requestCardPick(state, card.type, player.id, card, context);
  }

  function isNumberCard(card) { return card && (card.type === "number" || SPECIAL_NUMBERS.includes(card.type)); }
  function isClassicModifier(card) { return card && (card.type === "plus" || card.type === "double"); }
  function isVengeanceModifier(card) { return card && VENGEANCE_MODIFIERS.includes(card.type); }

  function resolveNumberCard(state, player, card) {
    if (!isVengeance(state)) { resolveClassicNumberCard(state, player, card); return; }
    if (card.type === "unlucky7") {
      player.numberCards.forEach((existing) => state.discard.push(existing));
      player.modifierCards.forEach((existing) => state.discard.push(existing));
      player.numberCards = [card];
      player.modifierCards = [];
      player.roundScore = calculateRoundScore(player);
      addLog(state, `${player.name} drew Unlucky 7 and discards all other cards.`);
      checkFlip7(state, player);
      return;
    }
    player.numberCards.push(card);
    validateVengeanceNumbers(state, player, card.value);
    if (player.status === PLAYER_STATUS.BUSTED) return;
    player.roundScore = calculateRoundScore(player);
    addLog(state, `${player.name} keeps ${card.label}. Current round score: ${player.roundScore}.`);
    checkFlip7(state, player);
  }

  function resolveClassicNumberCard(state, player, card) {
    const duplicate = player.numberCards.some((existing) => existing.value === card.value);
    if (duplicate && player.hasSecondChance) {
      player.hasSecondChance = false;
      state.discard.push(card);
      player.roundScore = calculateRoundScore(player);
      player.roundNote = "Second Chance saved a bust";
      addLog(state, `${player.name} drew duplicate ${card.value}, but Second Chance saved them.`);
      return;
    }
    if (duplicate) {
      player.status = PLAYER_STATUS.BUSTED;
      player.roundScore = 0;
      player.roundNote = `Busted on ${card.value}`;
      player.hasSecondChance = false;
      state.discard.push(card);
      addLog(state, `${player.name} busted on duplicate ${card.value}.`);
      if (isRoundOver(state)) finalizeRound(state, "All players are out, stayed, frozen, or busted.");
      return;
    }
    player.numberCards.push(card);
    player.roundScore = calculateRoundScore(player);
    addLog(state, `${player.name} keeps ${card.value}. Current round score: ${player.roundScore}.`);
    checkFlip7(state, player);
  }

  function validateVengeanceNumbers(state, player, triggerValue) {
    if (!isVengeance(state)) return;
    const counts = new Map();
    player.numberCards.forEach((card) => counts.set(card.value, (counts.get(card.value) || 0) + 1));
    for (const [value, count] of counts.entries()) {
      const allowedLucky13 = value === 13 && count <= 2 && player.numberCards.some((card) => card.type === "lucky13");
      if ((count > 1 && !allowedLucky13) || (value === 13 && count > 2)) { bustPlayer(state, player, triggerValue || value); return; }
    }
  }

  function bustPlayer(state, player, value) {
    player.status = PLAYER_STATUS.BUSTED;
    player.roundScore = 0;
    player.roundNote = `Busted on ${value}`;
    player.hasSecondChance = false;
    addLog(state, `${player.name} busted on duplicate ${value}.`);
    if (isRoundOver(state)) finalizeRound(state, "All players are out, stayed, frozen, or busted.");
  }

  function checkFlip7(state, player) {
    if (player.status === PLAYER_STATUS.BUSTED) return;
    if (uniqueNumberCount(player) >= 7) {
      player.flip7 = true;
      player.roundNote = "Lucky 7 bonus";
      player.roundScore = calculateRoundScore(player);
      finalizeRound(state, `${player.name} reached seven different number cards.`);
    }
  }

  function resolveSecondChance(state, player, card, context) {
    if (!player.hasSecondChance) { player.hasSecondChance = true; state.discard.push(card); addLog(state, `${player.name} gains Second Chance.`); return; }
    const eligible = activePlayers(state).filter((candidate) => candidate.id !== player.id && !candidate.hasSecondChance);
    if (!eligible.length) { state.discard.push(card); addLog(state, `${player.name} already has Second Chance, so the extra card is discarded.`); return; }
    if (context && context.fromFlipThree) {
      state.actionQueue.push({ kind: "secondChanceGift", sourcePlayerId: player.id, card, context: { message: `${player.name} already has Second Chance. Choose who gets the extra one.` } });
      addLog(state, `${player.name}'s extra Second Chance is queued until Flip Three finishes.`);
      return;
    }
    state.pendingTarget = { kind: "secondChanceGift", sourcePlayerId: player.id, card, message: `${player.name} already has Second Chance. Choose who gets the extra one.` };
    state.phase = "selectTarget";
  }

  function requestTarget(state, kind, sourcePlayerId, card, context) {
    const eligible = targetsForAction(state, kind, sourcePlayerId);
    if (!eligible.length) { state.discard.push(card); addLog(state, `${labelForActionKind(kind, card)} was discarded because there was no legal target.`); finishActionResolution(state); return; }
    if (eligible.length === 1) {
      const action = { kind, sourcePlayerId, card, auto: true, context: context || {} };
      if (state.holdAfterHit) { state.pendingAutoTarget = { targetId: eligible[0].id, action }; state.phase = "autoTarget"; }
      else resolveTargetAction(state, eligible[0].id, action);
      return;
    }
    state.pendingTarget = { kind, sourcePlayerId, card, message: (context && context.message) || `${labelForActionKind(kind, card)} needs a target.`, context: context || {} };
    state.phase = "selectTarget";
  }

  function requestCardPick(state, kind, sourcePlayerId, card, context) {
    state.pendingCardPick = { kind, sourcePlayerId, card, picks: [], message: (context && context.message) || messageForCardPick(kind), context: context || {} };
    const legal = legalCardTargets(state);
    if ((kind === "swap" && legal.length < 2) || (kind !== "swap" && !legal.length)) {
      state.pendingCardPick = null;
      state.discard.push(card);
      addLog(state, `${labelForActionKind(kind, card)} was discarded because there were no cards to target.`);
      finishActionResolution(state);
      return;
    }
    state.phase = "selectCard";
  }

  function messageForCardPick(kind) {
    if (kind === "swap") return "Choose the first card to swap.";
    if (kind === "steal") return "Choose a card to steal.";
    if (kind === "discard") return "Choose a card to discard.";
    return "Choose a card.";
  }

  function labelForActionKind(kind, card) {
    if (kind === "modifier") return card ? labelForCard(card.type, card.value) : "Modifier";
    if (kind === "freeze") return "Freeze";
    if (kind === "flipThree") return "Flip Three";
    if (kind === "secondChanceGift") return "Second Chance";
    if (kind === "justOneMore") return "Just One More";
    if (kind === "flipFour") return "Flip Four";
    if (kind === "swap") return "Swap";
    if (kind === "steal") return "Steal";
    if (kind === "discard") return "Discard";
    return "Action";
  }

  function legalTargets(state) { ensureStateShape(state); return state.pendingTarget ? targetsForAction(state, state.pendingTarget.kind, state.pendingTarget.sourcePlayerId) : []; }

  function targetsForAction(state, kind, sourcePlayerId) {
    if (kind === "secondChanceGift") return activePlayers(state).filter((player) => player.id !== sourcePlayerId && !player.hasSecondChance);
    if (isVengeance(state) && (kind === "modifier" || kind === "justOneMore" || kind === "flipFour")) return nonBustedPlayers(state);
    return activePlayers(state);
  }

  function chooseTarget(state, targetId) {
    ensureStateShape(state);
    if (!state.pendingTarget) return;
    saveUndo(state);
    const pending = state.pendingTarget;
    state.pendingTarget = null;
    state.phase = "resolving";
    resolveTargetAction(state, targetId, pending);
  }

  function resolveTargetAction(state, targetId, action) {
    const target = getPlayer(state, targetId);
    const source = getPlayer(state, action.sourcePlayerId);
    if (!target || !targetsForAction(state, action.kind, action.sourcePlayerId).some((player) => player.id === targetId)) {
      if (action.card) state.discard.push(action.card);
      addLog(state, "Action discarded because there was no legal target.");
      finishActionResolution(state);
      return;
    }
    if (action.kind === "modifier") {
      target.modifierCards.push(action.card);
      target.roundScore = calculateRoundScore(target);
      addLog(state, `${target.name} receives ${action.card.label} from ${source ? source.name : "a modifier"}.`);
      finishActionResolution(state);
      return;
    }
    if (action.kind === "freeze") {
      target.status = PLAYER_STATUS.FROZEN;
      target.roundScore = calculateRoundScore(target);
      target.roundNote = "Frozen";
      target.hasSecondChance = false;
      state.discard.push(action.card);
      addLog(state, `${target.name} is frozen by ${source ? source.name : "an action"} and banks ${target.roundScore} points.`);
      finishActionResolution(state);
      return;
    }
    if (action.kind === "secondChanceGift") { target.hasSecondChance = true; state.discard.push(action.card); addLog(state, `${target.name} receives the extra Second Chance.`); finishActionResolution(state); return; }
    if (action.kind === "flipThree") { state.discard.push(action.card); addLog(state, `${target.name} must Flip Three.`); startFlipSequence(state, "flipThree", target.id, 3); return; }
    if (action.kind === "justOneMore") { state.discard.push(action.card); addLog(state, `${target.name} must take Just One More card.`); startJustOneMore(state, target.id); return; }
    if (action.kind === "flipFour") { state.discard.push(action.card); addLog(state, `${target.name} must Flip Four.`); startFlipSequence(state, "flipFour", target.id, 4); }
  }

  function startJustOneMore(state, targetId) {
    const target = getPlayer(state, targetId);
    if (!canReceiveCard(state, target)) { finishActionResolution(state); return; }
    state.pendingForcedStay = targetId;
    const card = drawCard(state);
    addLog(state, `${target.name} accepts ${card.label} from Just One More.`);
    resolveCard(state, target.id, card, { fromJustOneMore: true });
    const nextPhase = ["selectTarget", "selectCard", "autoTarget", "roundSummary", "gameOver", "tiebreak"].includes(state.phase) ? state.phase : "forceStay";
    pauseForReveal(state, target.id, card, nextPhase);
  }

  function forcePendingStay(state) {
    if (!state.pendingForcedStay) return;
    const target = getPlayer(state, state.pendingForcedStay);
    state.pendingForcedStay = null;
    if (!target || target.status === PLAYER_STATUS.BUSTED || target.status === PLAYER_STATUS.OUT) return;
    target.status = PLAYER_STATUS.STAYED;
    target.roundScore = calculateRoundScore(target);
    target.roundNote = "Forced to stay";
    addLog(state, `${target.name} must stay after Just One More.`);
  }

  function startFlipSequence(state, kind, targetId, total) { state.flipThree = { kind, targetId, remaining: total, total, drawn: 0, deferred: [] }; drawNextFlipThreeCard(state); }

  function continueFlipThree(state) {
    if (!state.flipThree) { finishActionResolution(state); return; }
    const target = getPlayer(state, state.flipThree.targetId);
    if (!target || !canContinueFlipSequence(state, target) || state.flipThree.remaining <= 0 || isRoundOver(state)) { finishFlipThree(state); return; }
    drawNextFlipThreeCard(state);
  }

  function canContinueFlipSequence(state, target) { return isVengeance(state) ? target.status !== PLAYER_STATUS.BUSTED && target.status !== PLAYER_STATUS.OUT : target.status === PLAYER_STATUS.ACTIVE; }

  function drawNextFlipThreeCard(state) {
    const sequence = state.flipThree;
    const target = sequence ? getPlayer(state, sequence.targetId) : null;
    if (!sequence || !target || !canContinueFlipSequence(state, target) || sequence.remaining <= 0) { finishFlipThree(state); return; }
    sequence.remaining -= 1;
    sequence.drawn += 1;
    const card = drawCard(state);
    addLog(state, `${target.name} flips ${card.label} (${sequence.drawn}/${sequence.total}).`);
    if (shouldDeferInFlipSequence(state, sequence, card)) {
      sequence.deferred.push({ kind: queuedKindForCard(card), sourcePlayerId: target.id, card, context: { fromFlipThree: sequence.kind === "flipThree", fromFlipFour: sequence.kind === "flipFour" } });
      addLog(state, `${card.label} is queued until ${sequence.kind === "flipFour" ? "Flip Four" : "Flip Three"} finishes.`);
    } else {
      resolveCard(state, target.id, card, { fromFlipThree: sequence.kind === "flipThree", fromFlipFour: sequence.kind === "flipFour" });
    }
    const nextPhase = ["roundSummary", "gameOver", "tiebreak"].includes(state.phase) || isRoundOver(state) ? state.phase : "flipThreeContinue";
    pauseForReveal(state, target.id, card, nextPhase);
  }

  function shouldDeferInFlipSequence(state, sequence, card) {
    if (!sequence) return false;
    if (sequence.kind === "flipThree") return card.type === "freeze" || card.type === "flipThree";
    if (sequence.kind === "flipFour") return isVengeanceModifier(card) || VENGEANCE_ACTIONS.includes(card.type);
    return false;
  }

  function queuedKindForCard(card) { return isVengeanceModifier(card) ? "modifier" : card.type; }

  function finishFlipThree(state) {
    const sequence = state.flipThree;
    if (!sequence) { finishActionResolution(state); return; }
    const target = getPlayer(state, sequence.targetId);
    const canQueue = target && (isVengeance(state) ? target.status !== PLAYER_STATUS.BUSTED && target.status !== PLAYER_STATUS.OUT : target.status === PLAYER_STATUS.ACTIVE) && state.phase !== "roundSummary" && state.phase !== "gameOver";
    if (canQueue) state.actionQueue.push(...sequence.deferred);
    else {
      sequence.deferred.forEach((item) => state.discard.push(item.card));
      if (sequence.deferred.length && target) addLog(state, `${target.name}'s queued actions were discarded because they are no longer in play.`);
    }
    state.flipThree = null;
    finishActionResolution(state);
  }

  function finishActionResolution(state) {
    if (state.phase === "selectCard" || state.phase === "selectTarget" || state.phase === "autoTarget") state.phase = "resolving";
    if (state.phase === "roundSummary" || state.phase === "gameOver" || state.phase === "tiebreak") return;
    if (state.pendingForcedStay) forcePendingStay(state);
    if (isRoundOver(state)) { finalizeRound(state, "All players are out, stayed, frozen, or busted."); return; }
    if (state.actionQueue.length) { dispatchQueuedAction(state, state.actionQueue.shift()); return; }
    if (state.initialDeal) { state.initialDeal.index += 1; continueInitialDeal(state); return; }
    if (state.holdAfterHit) { state.phase = "turn"; return; }
    advanceTurn(state);
  }

  function dispatchQueuedAction(state, next) { if (CARD_PICK_ACTIONS.includes(next.kind)) requestCardPick(state, next.kind, next.sourcePlayerId, next.card, next.context); else requestTarget(state, next.kind, next.sourcePlayerId, next.card, next.context); }

  function legalCardTargets(state) {
    ensureStateShape(state);
    const pending = state.pendingCardPick;
    if (!pending) return [];
    const picked = pending.picks || [];
    const cards = faceUpCards(state);
    if (pending.kind === "steal") return cards.filter((item) => item.playerId !== pending.sourcePlayerId);
    if (pending.kind === "swap" && picked.length) {
      const first = picked[0];
      return cards.filter((item) => !(item.playerId === first.playerId && item.zone === first.zone && item.cardId === first.cardId));
    }
    return cards;
  }

  function faceUpCards(state) {
    return nonBustedPlayers(state).flatMap((player) => player.numberCards.map((card) => ({ playerId: player.id, zone: "numberCards", cardId: card.id, card })).concat(player.modifierCards.map((card) => ({ playerId: player.id, zone: "modifierCards", cardId: card.id, card }))));
  }

  function chooseCard(state, playerId, zone, cardId) {
    ensureStateShape(state);
    if (!state.pendingCardPick) return;
    const picked = legalCardTargets(state).find((item) => item.playerId === playerId && item.zone === zone && item.cardId === cardId);
    if (!picked) return;
    if (!state.pendingCardPick.picks.length) saveUndo(state);
    if (state.pendingCardPick.kind === "swap" && state.pendingCardPick.picks.length === 0) {
      state.pendingCardPick.picks.push({ playerId, zone, cardId });
      state.pendingCardPick.message = "Choose the second card to swap.";
      return;
    }
    resolveCardPick(state, picked);
  }

  function resolveCardPick(state, picked) {
    const pending = state.pendingCardPick;
    const source = getPlayer(state, pending.sourcePlayerId);
    if (pending.kind === "steal") {
      const owner = getPlayer(state, picked.playerId);
      const card = removeFaceUpCard(owner, picked.zone, picked.cardId);
      if (card && source) addMovedCard(state, source, card);
      state.discard.push(pending.card);
      state.pendingCardPick = null;
      if (owner) refreshPlayerAfterCardChange(state, owner);
      if (source) refreshPlayerAfterCardChange(state, source);
      addLog(state, `${source ? source.name : "A player"} steals ${card ? card.label : "a card"}.`);
      finishActionResolution(state);
      return;
    }
    if (pending.kind === "discard") {
      const owner = getPlayer(state, picked.playerId);
      const card = removeFaceUpCard(owner, picked.zone, picked.cardId);
      if (card) state.discard.push(card);
      state.discard.push(pending.card);
      state.pendingCardPick = null;
      if (owner) refreshPlayerAfterCardChange(state, owner);
      addLog(state, `${owner ? owner.name : "A player"} discards ${card ? card.label : "a card"}.`);
      finishActionResolution(state);
      return;
    }
    if (pending.kind === "swap") {
      const first = pending.picks[0];
      const ownerA = getPlayer(state, first.playerId);
      const ownerB = getPlayer(state, picked.playerId);
      const cardA = removeFaceUpCard(ownerA, first.zone, first.cardId);
      const cardB = removeFaceUpCard(ownerB, picked.zone, picked.cardId);
      if (cardA && ownerB) addMovedCard(state, ownerB, cardA);
      if (cardB && ownerA) addMovedCard(state, ownerA, cardB);
      state.discard.push(pending.card);
      state.pendingCardPick = null;
      if (ownerA) refreshPlayerAfterCardChange(state, ownerA);
      if (ownerB && ownerB !== ownerA) refreshPlayerAfterCardChange(state, ownerB);
      addLog(state, "Two face-up cards were swapped.");
      finishActionResolution(state);
    }
  }

  function removeFaceUpCard(player, zone, cardId) { if (!player || !Array.isArray(player[zone])) return null; const index = player[zone].findIndex((card) => card.id === cardId); return index < 0 ? null : player[zone].splice(index, 1)[0]; }

  function addMovedCard(state, player, card) {
    if (isNumberCard(card)) {
      if (card.type === "unlucky7") {
        player.numberCards.forEach((existing) => state.discard.push(existing));
        player.modifierCards.forEach((existing) => state.discard.push(existing));
        player.numberCards = [card];
        player.modifierCards = [];
      } else player.numberCards.push(card);
    } else if (isClassicModifier(card) || isVengeanceModifier(card)) player.modifierCards.push(card);
  }

  function refreshPlayerAfterCardChange(state, player) {
    if (!player || player.status === PLAYER_STATUS.BUSTED || player.status === PLAYER_STATUS.OUT) return;
    validateVengeanceNumbers(state, player);
    if (player.status !== PLAYER_STATUS.BUSTED) { player.roundScore = calculateRoundScore(player); checkFlip7(state, player); }
  }

  function advanceTurn(state) {
    if (["selectTarget", "selectCard", "roundSummary", "gameOver", "tiebreak"].includes(state.phase)) return;
    if (isRoundOver(state)) { finalizeRound(state, "All players are out, stayed, frozen, or busted."); return; }
    state.currentPlayerId = findNextActiveId(state, state.currentPlayerId);
    state.phase = "pass";
  }

  function findNextActiveId(state, afterPlayerId) {
    const ids = state.activePlayerIds;
    if (!ids.length) return null;
    let start = afterPlayerId ? ids.indexOf(afterPlayerId) + 1 : 0;
    if (start < 0) start = 0;
    for (let offset = 0; offset < ids.length; offset += 1) {
      const id = ids[(start + offset) % ids.length];
      const player = getPlayer(state, id);
      if (player && player.status === PLAYER_STATUS.ACTIVE) return id;
    }
    return null;
  }

  function uniqueNumberCount(player) { return new Set(player.numberCards.map((card) => card.value)).size; }
  function hasZero(player) { return player.numberCards.some((card) => card.type === "zero"); }

  function calculateRoundScore(player) {
    if (player.status === PLAYER_STATUS.BUSTED) return 0;
    if (hasZero(player) && !player.flip7) return 0;
    const numberTotal = player.numberCards.reduce((sum, card) => sum + Number(card.value || 0), 0);
    const hasDouble = player.modifierCards.some((card) => card.type === "double");
    const hasDivide = player.modifierCards.some((card) => card.type === "divide2");
    const plusTotal = player.modifierCards.filter((card) => card.type === "plus").reduce((sum, card) => sum + Number(card.value || 0), 0);
    const minusTotal = player.modifierCards.filter((card) => card.type && card.type.startsWith("minus")).reduce((sum, card) => sum + Number(card.value || modifierValue(card.type)), 0);
    let score = hasDouble ? numberTotal * 2 : numberTotal;
    if (hasDivide) score = Math.floor(score / 2);
    score += plusTotal;
    score -= minusTotal;
    score = Math.max(0, score);
    return score + (player.flip7 ? 15 : 0);
  }

  function isRoundOver(state) { if (state.phase === "roundSummary" || state.phase === "gameOver" || state.phase === "tiebreak") return true; if (participatingPlayers(state).some((player) => player.flip7)) return true; return activePlayers(state).length === 0; }

  function finalizeRound(state, reason) {
    state.roundEndedBy = reason;
    participatingPlayers(state).forEach((player) => {
      player.lastRoundScore = calculateRoundScore(player);
      player.roundScore = player.lastRoundScore;
      player.totalScore += player.lastRoundScore;
      player.hasSecondChance = false;
      player.numberCards.forEach((card) => state.discard.push(card));
      player.modifierCards.forEach((card) => state.discard.push(card));
    });
    state.currentPlayerId = null;
    state.pendingTarget = null;
    state.pendingAutoTarget = null;
    state.pendingCardPick = null;
    state.pendingForcedStay = null;
    state.actionQueue = [];
    addLog(state, `Round ${state.round} ended. ${reason}`);
    const reached = state.players.filter((player) => player.totalScore >= state.targetScore);
    if (reached.length) {
      const highest = Math.max(...state.players.map((player) => player.totalScore));
      const leaders = state.players.filter((player) => player.totalScore === highest);
      if (leaders.length === 1) { state.winnerIds = [leaders[0].id]; state.gameOverReason = `${leaders[0].name} wins with ${leaders[0].totalScore} points.`; state.phase = "gameOver"; addLog(state, state.gameOverReason); }
      else { state.tiebreakCandidates = leaders.map((player) => player.id); state.phase = "tiebreak"; addLog(state, `Tie at ${highest}. Tiebreak round needed.`); }
      return;
    }
    state.phase = "roundSummary";
  }

  function startNextRound(state) { ensureStateShape(state); if (state.phase !== "roundSummary") return; saveUndo(state); startRound(state, state.players.map((player) => player.id)); }
  function startTiebreak(state) { ensureStateShape(state); if (state.phase !== "tiebreak") return; saveUndo(state); startRound(state, state.tiebreakCandidates.slice()); }
  function teacherEndRound(state) { ensureStateShape(state); if (!state.teacherControls) return; saveUndo(state); finalizeRound(state, "Teacher ended the round."); }
  function setPlayerScore(state, playerId, score) { ensureStateShape(state); if (!state.teacherControls) return; const player = getPlayer(state, playerId); if (!player) return; saveUndo(state); player.totalScore = Math.max(0, Number(score) || 0); addLog(state, `${player.name}'s total score was set to ${player.totalScore}.`); }

  function samePlayersNewGame(state) {
    ensureStateShape(state);
    return createGame(state.players.map((player) => player.name), state.targetScore, { teacherControls: state.teacherControls, mode: state.mode });
  }

  const api = { STORAGE_KEY, MODES, PLAYER_STATUS, createDeck, shuffle, createGame, beginTurn, hit, continueAfterReveal, stay, chooseTarget, legalTargets, chooseCard, legalCardTargets, startNextRound, startTiebreak, undo, teacherEndRound, setPlayerScore, samePlayersNewGame, calculateRoundScore, cloneState, getPlayer, addLog, ensureStateShape };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.Lucky7Core = api;
})(typeof window !== "undefined" ? window : globalThis);
